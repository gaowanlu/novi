import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { IRequest } from '../comm/request.js';
import { User, FriendRequest } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';
import { pushToUsers, logPushError } from '../comm/push.js';

const router = Router();

// 新增好友申请
// POST friend/request
const postFriendRequest = Joi.object({
    targetUserId: Joi.string().trim().min(10).max(100).required()
});
const postFriendRequestHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id;
    const targetUserId = req.body.targetUserId;
    if (myUserId === targetUserId) {
        res.status(400).json({ message: '不能添加自己为好友' });
        return
    }

    try {
        // 搜索目标好友用户是否存在
        const targetUser = await User.findOne({ _id: targetUserId }).select('_id');
        if (!targetUser) {
            res.status(400).json({ message: '目标用户不存在' });
            return
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
            res.status(200).json(existFriendRequest);
            return
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
                await pushToUsers(
                    [myUserId as string, targetUserId],
                    'novi_friend_request_comming',
                    saveNewFriendRequest
                );
            } catch (err) {
                logPushError('novi_friend_request_comming', err);
            }
        }

        res.status(200).json(saveNewFriendRequest);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};

router.post(
    '/request',
    middlewareAuth,
    middlewareValidate(postFriendRequest),
    postFriendRequestHandler
);

// 获取自己相关的好友申请列表
// GET friend/request
interface FriendRequestResponse {
    friendRequestId: mongoose.Types.ObjectId
    status: string
    createdAt: Date
    requester: {
        userId: mongoose.Types.ObjectId
        userName: string
    }
    receiver: {
        userId: mongoose.Types.ObjectId
        userName: string
    }
}

// 构建「与我相关的好友申请/好友」聚合流水线，供 GET /request 与 GET / 复用。
// status 传入时（如 'accepted'）只返回该状态的记录；不传则返回全部历史。
const buildFriendRequestPipeline = (myUserId: string, status?: string) => {
    const matchStage: Record<string, any> = {
        $or: [
            { requester: mongoose.Types.ObjectId.createFromHexString(myUserId) },
            { receiver: mongoose.Types.ObjectId.createFromHexString(myUserId) }
        ]
    };
    if (status) {
        matchStage.status = status;
    }

    return [
        { $match: matchStage },
        // 合并 requester 信息（对方账号已删时保留记录，避免被 $unwind 静默丢弃）
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
        { $unwind: { path: '$requester', preserveNullAndEmptyArrays: true } },

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
        { $unwind: { path: '$receiver', preserveNullAndEmptyArrays: true } },

        // 最终输出
        {
            $project: {
                _id: 0,
                friendRequestId: '$_id',
                status: 1,
                createdAt: 1,
                'requester.userId': '$requester._id',
                'requester.userName': { $ifNull: ['$requester.userName', '对方账号已注销'] },
                'receiver.userId': '$receiver._id',
                'receiver.userName': { $ifNull: ['$receiver.userName', '对方账号已注销'] }
            }
        }
    ];
};

const getFriendRequestHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const myUserId = req.noviUser?._id as string;

    try {
        const friendRequests = await FriendRequest.aggregate<FriendRequestResponse>(
            buildFriendRequestPipeline(myUserId)
        );

        res.status(200).json(friendRequests);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};

router.get('/request', middlewareAuth, getFriendRequestHandler);

// 更新好友申请状态
// PUT friend/request
const putFriendRequest = Joi.object({
    friendRequestId: Joi.string().trim().min(10).max(100).required(),
    status: Joi.string().trim().valid('accepted', 'rejected').required()
});
const putFriendRequestHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id as string;
    const { friendRequestId, status } = req.body;

    try {
        let friendRequestById = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status');
        if (!friendRequestById) {
            res.status(400).json({ message: '未找到目标申请记录' });
            return
        }

        if (myUserId !== friendRequestById.receiver.toString()) {
            res.status(400).json({ message: '这不是向您发起的好友申请' });
            return
        }

        if ('pending' !== friendRequestById.status) {
            res.status(400).json({ message: '无法重复处理目标好友申请' });
            return
        }

        if ('accepted' !== status && 'rejected' !== status) {
            res.status(400).json({ message: '指定status不符合要求 必须是 accepted or rejected' });
            return
        }

        await FriendRequest.updateOne({ _id: friendRequestById._id },
            {
                $set: { status: status, respondedAt: new Date() }
            }
        );

        let friendRequestByIdUpdated = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status');

        // 好友申请状态更新后马上通知给自己和对方
        if (friendRequestByIdUpdated) {
            try {
                await pushToUsers(
                    [friendRequestByIdUpdated.receiver.toString(), friendRequestByIdUpdated.requester.toString()],
                    'novi_friend_request_processed',
                    friendRequestByIdUpdated
                );
            } catch (err) {
                logPushError('novi_friend_request_processed', err);
            }
        }

        res.status(200).json(friendRequestByIdUpdated);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};
router.put('/request',
    middlewareAuth,
    middlewareValidate(putFriendRequest),
    putFriendRequestHandler);

// 删除好友关系
// DELETE friend/
const deleteFriend = Joi.object({
    targetUserId: Joi.string().trim().max(100).required(),
    friendRequestId: Joi.string().trim().max(100).required(),
});
const deleteFriendHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id as string;
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
            res.status(400).json({ message: '在非好友状态下无法解除好友关系' });
            return
        }

        const markDeletedResult = await FriendRequest.updateOne({ _id: targetFriendRequest._id },
            {
                $set: { status: 'deleted' }
            }
        );
        if (markDeletedResult.matchedCount !== 1 || markDeletedResult.modifiedCount !== 1) {
            res.status(500).json({ message: '标记解除好友关系异常' });
            return
        }

        const deletedFriendRequest = await FriendRequest.findOne({ _id: targetFriendRequest._id });

        // 好友删除后更新后马上通知给自己和对方
        if (deletedFriendRequest) {
            try {
                await pushToUsers(
                    [deletedFriendRequest.requester.toString(), deletedFriendRequest.receiver.toString()],
                    'novi_friend_friend_deleted',
                    deletedFriendRequest
                );
            } catch (err) {
                logPushError('novi_friend_friend_deleted', err);
            }
        }

        res.status(200).json(deletedFriendRequest);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};
router.delete('/',
    middlewareAuth,
    middlewareValidate(deleteFriend, 'query'),
    deleteFriendHandler);

// 取消好友申请,在发出好友申请后但是接收者还暂未回复时，发起者可以删掉申请，停止加好友流程
// DELETE friend/request
const deleteFriendRequest = Joi.object({
    friendRequestId: Joi.string().trim().max(100).required()
});
const deleteFriendRequestHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id as string;
    const { friendRequestId } = req.query;

    try {
        const targetFriendRequest = await FriendRequest.findOne({
            _id: friendRequestId,
            requester: myUserId,
            status: 'pending'
        });
        if (!targetFriendRequest) {
            res.status(400).json({ message: '找不到符合要求的好友申请' });
            return
        }

        const markDeletedResult = await FriendRequest.updateOne({ _id: targetFriendRequest._id },
            {
                $set: { status: 'canceled' }
            }
        );
        if (markDeletedResult.matchedCount !== 1 || markDeletedResult.modifiedCount !== 1) {
            res.status(500).json({ message: '取消好友申请失败' });
            return
        }

        const deletedFriendRequest = await FriendRequest.findOne({ _id: targetFriendRequest._id });

        // 撤回申请后马上通知给自己和对方，双方列表保持同步
        if (deletedFriendRequest) {
            try {
                await pushToUsers(
                    [deletedFriendRequest.requester.toString(), deletedFriendRequest.receiver.toString()],
                    'novi_friend_request_comming',
                    deletedFriendRequest
                );
            } catch (err) {
                logPushError('novi_friend_request_comming', err);
            }
        }

        res.status(200).json(deletedFriendRequest);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};
router.delete('/request',
    middlewareAuth,
    middlewareValidate(deleteFriendRequest, 'query'),
    deleteFriendRequestHandler);

// 获取自己的所有好友，仅获取目前还是好友关系状态的
// GET friend/
const getFriendListHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id as string;

    try {
        const friendRequests = await FriendRequest.aggregate<FriendRequestResponse>(
            buildFriendRequestPipeline(myUserId, 'accepted')
        );

        res.status(200).json(friendRequests);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};
router.get('/', middlewareAuth, getFriendListHandler);

export default router;
