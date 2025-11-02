import { Router } from 'express';
import { User, FriendRequest } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';

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
                status: {
                    $in: ['accepted', 'pending']
                },
                $or: [
                    { requester: myUserId, receiver: targetUserId },
                    { requester: targetUserId, receiver: myUserId }
                ]
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

            return res.status(200).json(saveNewFriendRequest);
        } catch (err) {
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

        await FriendRequest.updateOne({ _id: friendRequestById._id },
            {
                $set: { status: status, respondedAt: new Date() }
            }
        );

        friendRequestById = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status');

        return res.status(200).json(friendRequestById);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// 删除好友关系
// DELETE friend/

// 取消好友申请
// DELETE friend/request

// 获取自己的所有好友
// GET friend/

export default router;
