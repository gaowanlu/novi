import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { IRequest } from '../comm/request.js';
import { User, FriendRequest, FriendMessage, buildPairKey } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';
import type { PipelineStage } from 'mongoose';
import { pushToUsers, logPushError } from '../comm/push.js';
import { isDuplicateKeyError } from '../models/mongoConstants.js';

const router = Router();

// 新增好友申请
// POST friend/request
const postFriendRequest = Joi.object({
    targetUserId: Joi.string().trim().min(10).max(100).required(),
    // 发起方公钥（base64 JWK），建立友谊时的密钥交换；服务器只透传，不持有私钥
    publicKey: Joi.string().trim().max(2048).optional().allow('')
});
const postFriendRequestHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id;
    const targetUserId = req.body.targetUserId;
    const publicKey = (req.body.publicKey as string) || undefined;
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

        // 规范化无序对键：A→B 与 B→A 同键，countDocuments 按该键统计双方全部历史代次。
        const myUserIdStr = myUserId as string;
        const pairKey = buildPairKey(myUserIdStr, targetUserId);

        // 分配关系代次（novicode）：统计该无序对的全部历史记录数 + 1。
        // 记录只翻转状态、从不硬删 → 计数单调递增：首次添加 = "1"，删除后重新添加 = "2"…
        // 客户端从新鲜 GET 预推导同值；不一致（并发竞态）时客户端按服务器值 relabel 自愈。
        // 并发兜底：pairKey+novicode 唯一索引（见 mongoModel）拦截跨节点 lost-update，
        // 撞 E11000 则重读计数重试（好友申请为低频操作，重试风暴可忽略）。
        const MAX_RETRY = 5;
        let saveNewFriendRequest: InstanceType<typeof FriendRequest> | null = null;
        for (let attempt = 0; attempt < MAX_RETRY && !saveNewFriendRequest; attempt++) {
            const novicode = String(
                (await FriendRequest.countDocuments({ pairKey })) + 1
            );
            try {
                const newFriendRequest = new FriendRequest({
                    requester: myUserId,
                    receiver: targetUserId,
                    status: 'pending',
                    publicKey,
                    novicode,
                    pairKey
                });
                saveNewFriendRequest = await newFriendRequest.save();
            } catch (saveErr: unknown) {
                // 唯一索引冲突（E11000）→ 并发竞态，重读计数重试；其它错误直接抛出
                if (isDuplicateKeyError(saveErr)) continue;
                throw saveErr;
            }
        }
        if (!saveNewFriendRequest) {
            res.status(409).json({ message: '好友关系代次冲突，请重试' });
            return
        }

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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
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
    // 发起方公钥（base64 JWK），客户端据此补齐与好友的 5 元组
    publicKey: string | null
    // 接收方公钥（base64 JWK），接受申请时写入；离线方上线拉取时据此补齐 5 元组
    receiverPublicKey: string | null
    // 关系代次（版本号），服务器分配：好友删除后重新添加 +1
    novicode: string | null
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
const buildFriendRequestPipeline = (myUserId: string, status?: string): PipelineStage[] => {
    const myObjectId = mongoose.Types.ObjectId.createFromHexString(myUserId);
    const matchStage: Record<string, unknown> = {
        $or: [
            { requester: myObjectId },
            { receiver: myObjectId }
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
                publicKey: { $ifNull: ['$publicKey', null] },
                receiverPublicKey: { $ifNull: ['$receiverPublicKey', null] },
                novicode: { $ifNull: ['$novicode', null] },
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
        return
    }
};

router.get('/request', middlewareAuth, getFriendRequestHandler);

// 更新好友申请状态
// PUT friend/request
const putFriendRequest = Joi.object({
    friendRequestId: Joi.string().trim().min(10).max(100).required(),
    status: Joi.string().trim().valid('accepted', 'rejected').required(),
    // 接收方（B）接受时带上自己的公钥（base64 JWK），完成密钥交换
    publicKey: Joi.string().trim().max(2048).optional().allow('')
});
const putFriendRequestHandler: RequestHandler = async (
    req: IRequest,
    res: Response
): Promise<void> => {
    const myUserId = req.noviUser?._id as string;
    const { friendRequestId, status } = req.body;
    const acceptPublicKey = (req.body.publicKey as string) || undefined;

    try {
        let friendRequestById = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status publicKey novicode');
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

        // 接受时把接收方公钥落库：发起方若离线（错过 WS 推送），上线后 GET 也能拉到，补齐 5 元组。
        // 公钥只是交换材料，落库不违背「服务器不持有私钥」不变量。
        await FriendRequest.updateOne({ _id: friendRequestById._id },
            {
                $set: {
                    status: status,
                    respondedAt: new Date(),
                    receiverPublicKey: status === 'accepted' ? (acceptPublicKey ?? null) : null
                }
            }
        );

        let friendRequestByIdUpdated = await FriendRequest.findOne({ _id: friendRequestId }).
            select('_id requester receiver status publicKey novicode');

        // 密钥交换：接受时把双方公钥都带出去，让 A、B 各自补齐 5 元组。
        // requesterPublicKey = 发起方(A)公钥（申请时已存）；receiverPublicKey = 接收方(B)公钥（本次带入）
        const requesterPublicKey = friendRequestByIdUpdated?.publicKey ?? null;
        const receiverPublicKey = status === 'accepted' ? (acceptPublicKey ?? null) : null;

        // 好友申请状态更新后马上通知给自己和对方（带双方公钥，离线方上线拉取也能拿到）
        if (friendRequestByIdUpdated) {
            try {
                const pushPayload: Record<string, unknown> = {
                    _id: friendRequestByIdUpdated._id,
                    requester: friendRequestByIdUpdated.requester,
                    receiver: friendRequestByIdUpdated.receiver,
                    status: friendRequestByIdUpdated.status,
                    respondedAt: friendRequestByIdUpdated.respondedAt,
                    requesterPublicKey,
                    receiverPublicKey,
                    novicode: friendRequestByIdUpdated.novicode ?? null
                };
                await pushToUsers(
                    [friendRequestByIdUpdated.receiver.toString(), friendRequestByIdUpdated.requester.toString()],
                    'novi_friend_request_processed',
                    pushPayload
                );
            } catch (err) {
                logPushError('novi_friend_request_processed', err);
            }
        }

        res.status(200).json({
            ...friendRequestByIdUpdated,
            requesterPublicKey,
            receiverPublicKey
        });
        return
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
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

        // plan.md：删除好友同时删除「当前代次」的聊天记录（无痕）——旧代次密文用新密钥无法解密，
        // 留在库里会污染新友谊的未读汇总 / 拉取窗口。
        // 只删当前代次（novicode）的消息：更老的代次在历次删除时已被级联清除，不会残留到此处。
        const curNovicode = targetFriendRequest.novicode ?? "1";
        await FriendMessage.deleteMany({
            noviCode: curNovicode,
            $or: [
                { sender: myUserId, receiver: targetUserId },
                { sender: targetUserId, receiver: myUserId }
            ]
        });

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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
        return
    }
};
router.get('/', middlewareAuth, getFriendListHandler);

export default router;
