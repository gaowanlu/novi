import { Router } from 'express';
import { User, FriendRequest } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';
import { noviNodeIPC } from '../mq/noviNodeIPC.js';
import { redisClient } from "../db/dbRedis.js";

const router = Router();

// 新增好友申请
// POST friend/request
const postFriendRequest = Joi.object({
    targetUserId: Joi.string().trim().min(10).max(100).required()
});
router.post(
    '/request',
    middlewareAuth,
    middlewareValidate(postFriendRequest),
    async (req, res) => {
        const myUserId = req.noviUser._id;
        const targetUserId = req.body.targetUserId;
        if (myUserId === targetUserId) {
            return res.status(400).json({ message: '不能添加自己为好友' });
        }

        try {
            // 搜索目标好友用户是否存在
            const targetUser = await User.findOne({ _id: targetUserId }).select('_id');
            if (!targetUser) {
                return res.status(400).json({ message: '目标用户不存在' });
            }

            // 检查是否已经为好友关系了 没有确认的好友申请记录
            const existFriendRequest = await FriendRequest.findOne({
                $or: [
                    { requester: myUserId, receiver: targetUserId },
                    { requester: targetUserId, receiver: myUserId }
                ],
                status: {
                    $in: ['accepted', 'pending']
                }
            });
            if (existFriendRequest) {
                return res.status(200).json(existFriendRequest);
            }
            // 没有的话就增加一条请求记录
            const newFriendRequest = new FriendRequest({
                requester: myUserId,
                receiver: targetUserId,
                status: 'pending'
            });
            const saveNewFriendRequest = await newFriendRequest.save();

            // 新增记录成功了则将好友申请同时推给自己和对方
            if (saveNewFriendRequest) {
                try {
                    const myOnlineNode = await redisClient.get(`user:online:${myUserId}`);
                    if (myOnlineNode) {
                        noviNodeIPC.sendToNode(myOnlineNode,
                            noviNodeIPC.createNewMessage('novi_friend_request_comming', saveNewFriendRequest));
                    }
                    const targetUserOnlineNode = await redisClient.get(`user:online:${targetUserId}`);
                    if (targetUserOnlineNode) {
                        noviNodeIPC.sendToNode(targetUserOnlineNode,
                            noviNodeIPC.createNewMessage('novi_friend_request_comming', saveNewFriendRequest));
                    }
                } catch (err) {
                    logger.error(`${err.message}`);
                }
            }

            return res.status(200).json(saveNewFriendRequest);
        } catch (err) {
            logger.error(`${err.message}`);
            return res.status(500).json({ message: err.message });
        }
    }
);

// 获取自己相关的好友申请列表
// GET friend/request
router.get('/request', middlewareAuth, async (req, res) => {
    const myUserId = req.noviUser._id;

    try {
        const friendRequests = await FriendRequest.aggregate([
            {
                $match: {
                    $or: [
                        { requester: mongoose.Types.ObjectId.createFromHexString(myUserId) },
                        { receiver: mongoose.Types.ObjectId.createFromHexString(myUserId) }
                    ]
                }
            },
            // 合并 requester 信息
            {
                $lookup: {
                    from: 'users',
                    let: { requesterId: '$requester' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$_id', '$$requesterId'] } } },
                        { $project: { _id: 1, userName: 1 } } // 只取必要字段
                    ],
                    as: 'requester'
                }
            },
            { $unwind: '$requester' },

            // 合并 receiver 信息
            {
                $lookup: {
                    from: 'users',
                    let: { receiverId: '$receiver' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$_id', '$$receiverId'] } } },
                        { $project: { _id: 1, userName: 1 } }
                    ],
                    as: 'receiver'
                }
            },
            { $unwind: '$receiver' },

            // 最终输出
            {
                $project: {
                    _id: 0,
                    friendRequestId: '$_id',
                    status: 1,
                    createdAt: 1,
                    'requester.userId': '$requester._id',
                    'requester.userName': '$requester.userName',
                    'receiver.userId': '$receiver._id',
                    'receiver.userName': '$receiver.userName'
                }
            }
        ]);

        return res.status(200).json(friendRequests);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

// 更新好友申请状态
// PUT friend/request
const putFriendRequest = Joi.object({
    friendRequestId: Joi.string().trim().min(10).max(100).required(),
    status: Joi.string().trim().valid('accepted', 'rejected').required()
});
router.put('/request', middlewareAuth, middlewareValidate(putFriendRequest), async (req, res) => {
    const myUserId = req.noviUser._id;
    const { friendRequestId, status } = req.body;

    try {
        let friendRequestById = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status');
        if (!friendRequestById) {
            return res.status(400).json({ message: '未找到目标申请记录' });
        }

        if (myUserId !== friendRequestById.receiver.toString()) {
            return res.status(400).json({ message: '这不是向您发起的好友申请' });
        }

        if ('pending' !== friendRequestById.status) {
            return res.status(400).json({ message: '无法重复处理目标好友申请' });
        }

        if ('accepted' !== status && 'rejected' !== status) {
            return res.status(400).json({ message: '指定status不符合要求 必须是 accepted or rejected' });
        }

        await FriendRequest.updateOne({ _id: friendRequestById._id },
            {
                $set: { status: status, respondedAt: new Date() }
            }
        );

        friendRequestById = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status');

        // 好友申请状态更新后马上通知给自己和对方
        if (friendRequestById) {
            try {
                const myOnlineNode = await redisClient.get(`user:online:${friendRequestById.receiver.toString()}`);
                if (myOnlineNode) {
                    noviNodeIPC.sendToNode(myOnlineNode,
                        noviNodeIPC.createNewMessage('novi_friend_request_processed', friendRequestById));
                }
                const targetUserOnlineNode = await redisClient.get(`user:online:${friendRequestById.requester.toString()}`);
                if (targetUserOnlineNode) {
                    noviNodeIPC.sendToNode(targetUserOnlineNode,
                        noviNodeIPC.createNewMessage('novi_friend_request_processed', friendRequestById));
                }
            } catch (err) {
                logger.error(`${err.message}`);
            }
        }

        return res.status(200).json(friendRequestById);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

// 删除好友关系
// DELETE friend/
const deleteFriend = Joi.object({
    targetUserId: Joi.string().trim().max(100).required(),
    friendRequestId: Joi.string().trim().max(100).required(),
});
router.delete('/', middlewareAuth, middlewareValidate(deleteFriend, 'query'), async (req, res) => {
    const myUserId = req.noviUser._id;
    const { targetUserId, friendRequestId } = req.query;

    try {
        const targetFriendRequest = await FriendRequest.findOne({
            status: 'accepted',
            $or: [
                { _id: friendRequestId },
                { requester: myUserId, receiver: targetUserId },
                { requester: targetUserId, receiver: myUserId }
            ]
        });
        if (!targetFriendRequest) {
            return res.status(400).json({ message: '在非好友状态下无法解除好友关系' });
        }

        const markDeletedResult = await FriendRequest.updateOne({ _id: targetFriendRequest._id },
            {
                $set: { status: 'deleted' }
            }
        );
        if (markDeletedResult.matchedCount !== 1 || markDeletedResult.modifiedCount !== 1) {
            return res.status(500).json({ message: '标记解除好友关系异常' });
        }

        const deletedFriendRequest = await FriendRequest.findOne({ _id: targetFriendRequest._id });

        // 好友删除后更新后马上通知给自己和对方
        if (deletedFriendRequest) {
            try {
                const requesterOnlineNode = await redisClient.get(`user:online:${deletedFriendRequest.requester.toString()}`);
                if (requesterOnlineNode) {
                    noviNodeIPC.sendToNode(requesterOnlineNode,
                        noviNodeIPC.createNewMessage('novi_friend_friend_deleted', deletedFriendRequest));
                }
                const receiverOnlineNode = await redisClient.get(`user:online:${deletedFriendRequest.receiver.toString()}`);
                if (receiverOnlineNode) {
                    noviNodeIPC.sendToNode(receiverOnlineNode,
                        noviNodeIPC.createNewMessage('novi_friend_friend_deleted', deletedFriendRequest));
                }
            } catch (err) {
                logger.error(`${err.message}`);
            }
        }

        return res.status(200).json(deletedFriendRequest);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

// 取消好友申请,在发出好友申请后但是接收者还暂未回复时，发起者可以删掉申请，停止加好友流程
// DELETE friend/request
const deleteFriendRequest = Joi.object({
    friendRequestId: Joi.string().trim().max(100).required()
});
router.delete('/request', middlewareAuth, middlewareValidate(deleteFriendRequest, 'query'), async (req, res) => {
    const myUserId = req.noviUser._id;
    const { friendRequestId } = req.query;

    try {
        const targetFriendRequest = await FriendRequest.findOne({
            _id: friendRequestId,
            requester: myUserId,
            status: 'pending'
        });
        if (!targetFriendRequest) {
            return res.status(400).json({ message: '找不到符合要求的好友申请' });
        }

        const markDeletedResult = await FriendRequest.updateOne({ _id: targetFriendRequest._id },
            {
                $set: { status: 'canceled' }
            }
        );
        if (markDeletedResult.matchedCount !== 1 || markDeletedResult.modifiedCount !== 1) {
            return res.status(500).json({ message: '取消好友申请失败' });
        }

        const deletedFriendRequest = await FriendRequest.findOne({ _id: targetFriendRequest._id });

        return res.status(200).json(deletedFriendRequest);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

// 获取自己的所有好友，仅获取目前还是好友关系状态的
// GET friend/
router.get('/', middlewareAuth, async (req, res) => {
    const myUserId = req.noviUser._id;

    try {
        const friendRequests = await FriendRequest.aggregate([
            {
                $match: {
                    $or: [
                        { requester: mongoose.Types.ObjectId.createFromHexString(myUserId) },
                        { receiver: mongoose.Types.ObjectId.createFromHexString(myUserId) }
                    ],
                    status: 'accepted',
                }
            },
            // 合并 requester 信息
            {
                $lookup: {
                    from: 'users',
                    let: { requesterId: '$requester' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$_id', '$$requesterId'] } } },
                        { $project: { _id: 1, userName: 1 } } // 只取必要字段
                    ],
                    as: 'requester'
                }
            },
            { $unwind: '$requester' },

            // 合并 receiver 信息
            {
                $lookup: {
                    from: 'users',
                    let: { receiverId: '$receiver' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$_id', '$$receiverId'] } } },
                        { $project: { _id: 1, userName: 1 } }
                    ],
                    as: 'receiver'
                }
            },
            { $unwind: '$receiver' },

            // 最终输出
            {
                $project: {
                    _id: 0,
                    friendRequestId: '$_id',
                    status: 1,
                    createdAt: 1,
                    'requester.userId': '$requester._id',
                    'requester.userName': '$requester.userName',
                    'receiver.userId': '$receiver._id',
                    'receiver.userName': '$receiver.userName'
                }
            }
        ]);

        return res.status(200).json(friendRequests);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

export default router;
