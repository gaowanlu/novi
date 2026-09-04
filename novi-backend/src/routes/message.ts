import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { IRequest } from '../comm/request.js';
import { FriendRequest, FriendMessage } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';
import { pushToUsers, logPushError } from '../comm/push.js';

const router = Router();

// 向目标好友发送新消息
// POST message/
const postFriendMessage = Joi.object({
    noviCode: Joi.string().trim().min(1).max(10).required(),
    receiver: Joi.string().trim().min(10).max(100).required(),
    // 当前明文阶段上限 200；E2E 落地后 content 变为密文，上限需随之放大
    content: Joi.string().trim().min(1).max(65535).required()
});
const postFriendMessagHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const myUserId = req.noviUser?._id as string;

    const { noviCode, receiver, content } = req.body;
    if (receiver === myUserId) {
        res.status(400).json({ message: '无法向自己发送消息' });
        return
    }

    try {
        // 检查二人是否为好友关系
        const friendRequest = await FriendRequest.findOne({
            $or: [
                { requester: myUserId, receiver: receiver },
                { requester: receiver, receiver: myUserId }
            ],
            status: {
                $in: ['accepted']
            }
        });
        if (!friendRequest) {
            res.status(400).json({ message: '不能向非好友用户发送消息' });
            return
        }

        // 新增一条消息
        const newFriendMessage = new FriendMessage({
            noviCode: noviCode,
            sender: myUserId,
            receiver: receiver,
            content: content,
            sentAt: new Date(),
        });
        const saveNewFriendMessage = await newFriendMessage.save();

        // 消息发送后马上通知给自己和对方
        if (saveNewFriendMessage) {
            try {
                await pushToUsers(
                    [saveNewFriendMessage.sender.toString(), saveNewFriendMessage.receiver.toString()],
                    'novi_friend_message_comming',
                    saveNewFriendMessage
                );
            } catch (err) {
                logPushError('novi_friend_message_comming', err);
            }
        }

        res.status(200).json(saveNewFriendMessage);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
        return
    }
};

router.post('/', middlewareAuth, middlewareValidate(postFriendMessage), postFriendMessagHandler);

// 拉取与全部好友的消息未读情况
// GET message/allfriend
const getMessageAllFriendHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const myUserId = req.noviUser?._id as string;

    try {
        const unreadMessages = await FriendMessage.aggregate([
            {
                $match: {
                    receiver: mongoose.Types.ObjectId.createFromHexString(myUserId),
                    readAt: null
                }
            },
            {
                $sort: { sentAt: -1 } // 先按时间倒序
            },
            {
                $group: {
                    _id: "$sender", // 按发送者分组
                    latestMessage: { $first: "$$ROOT" }, // 取每组的第一条（最新）
                    unreadCount: { $sum: 1 } // 统计未读数量
                }
            },
            {
                $lookup: { // 关联发送者用户信息
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "senderInfo"
                }
            },
            {
                $unwind: {
                    path: "$senderInfo",
                    // 发送者账号已被删除时保留该记录，避免未读汇总被静默丢弃
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 0,
                    sender: "$_id",
                    unreadCount: 1, // 未读条数
                    content: "$latestMessage.content",
                    sentAt: "$latestMessage.sentAt",
                    lastMessageID: "$latestMessage._id",
                    noviCode: "$latestMessage.noviCode",
                    // 发送者已注销时兜底显示
                    senderInfo: {
                        _id: { $ifNull: ["$senderInfo._id", null] },
                        userName: { $ifNull: ["$senderInfo.userName", "对方账号已注销"] }
                    }
                }
            },
            {
                $sort: { sentAt: -1 } // 按最新消息时间倒序排列发送者
            }
        ]);
        res.status(200).json(unreadMessages);
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
    }
};
router.get('/allfriend', middlewareAuth, getMessageAllFriendHandler);

// GET message/pull/unread/byfriend
const getMessagePullUnreadByFriend = Joi.object({
    sender: Joi.string().trim().min(10).max(100).required(),
    before: Joi.date().optional(), // 拉取指定时间及其之前的30条
    after: Joi.date().optional(), // 拉取指定时间及其之后的30条
});
const getMessagePullUnreadByFriendHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const myUserId = req.noviUser?._id as string;

        const queryObj = req.query as { sender: string, before: string, after: string };

        const senderId = mongoose.Types.ObjectId.createFromHexString(queryObj.sender);
        const myObjectId = mongoose.Types.ObjectId.createFromHexString(myUserId);

        // 会话是双向的：既要「对方发给我」，也要「我发给对方」。
        // 参数名 sender 实际指「会话对端」，这里统一用 $or 覆盖两个方向。
        const conversationFilter = {
            $or: [
                { sender: senderId, receiver: myObjectId },
                { sender: myObjectId, receiver: senderId }
            ]
        };

        // 如果指定了before,则直接拉取历史消息
        if (queryObj.before) {
            const beforeTime = new Date(queryObj.before);
            const messages = await FriendMessage.find({
                ...conversationFilter,
                sentAt: { $lte: beforeTime }
            }).sort({ sentAt: -1, _id: -1 }).limit(30).lean();

            // 正序返回
            res.status(200).json(messages.reverse());
            return
        }

        // 如果指定了after,则直接拉取及其之后的30条
        if (queryObj.after) {
            const afterTime = new Date(queryObj.after);
            const messages = await FriendMessage.find({
                ...conversationFilter,
                sentAt: { $gte: afterTime }
            }).sort({ sentAt: 1, _id: 1 }).limit(30).lean();
            res.status(200).json(messages);
            return
        }

        // 找第一条未读消息（未读只可能是对方发给我的）
        const firstUnread = await FriendMessage.findOne({
            sender: senderId,
            receiver: myObjectId,
            readAt: null
        }).sort({ sentAt: 1 }).lean(); // 第一条未读

        // 没有未读消息，取最新10条消息
        if (!firstUnread) {
            const latest = await FriendMessage.find({
                ...conversationFilter,
            }).sort({ sentAt: -1, _id: -1 }).limit(10).lean();

            res.status(200).json(latest);
            return
        }

        // 拉取 firstUnread之前的最多30条（用于上下文），注意先按倒序取 limit 再反转为正序
        const prevRaw = await FriendMessage.find({
            ...conversationFilter,
            sentAt: { $lt: firstUnread.sentAt }
        }).sort({ sentAt: -1, _id: -1 }).limit(30).lean();
        const previous = prevRaw.reverse();

        // 拉取从firstUnread开始的最多30条，包含 firstUnread
        const afterUnread = await FriendMessage.find({
            ...conversationFilter,
            sentAt: { $gte: firstUnread.sentAt }
        }).sort({ sentAt: 1, _id: 1 }).limit(30).lean();

        // 组合：前30升序+后30升序
        const all = [...previous, ...afterUnread];

        res.status(200).json(all);
        return
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
    }
};

router.get('/pull/unread/byfriend',
    middlewareAuth,
    middlewareValidate(getMessagePullUnreadByFriend, 'query'),
    getMessagePullUnreadByFriendHandler
);

// 提供一个数组提交消息ID用于确认消息消息已读
// PUT message/markreaded
const markMessageReadedScheme = Joi.object({
    messageIds: Joi.array().items(Joi.string().length(24)).min(1).required()
});

const putMessageMarkreadedHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const myUserId = req.noviUser?._id as string;
        const messageIds = req.body.messageIds as string[];
        const objectIds = messageIds.map((id: string) => mongoose.Types.ObjectId.createFromHexString(id));

        // 找出哪些消息确实属于当前用户且未读
        const unreadMessages = await FriendMessage.find({
            _id: { $in: objectIds },
            receiver: mongoose.Types.ObjectId.createFromHexString(myUserId),
            readAt: null
        }).select('_id sender receiver').lean();

        if (unreadMessages.length === 0) {
            res.status(200).json({
                message: '没有可标记的未读消息',
                updatedIds: []
            });
            return
        }

        // 执行批量更新：过滤条件与上面的 find 完全一致，保证原子且无并发竞态
        const result = await FriendMessage.updateMany(
            { _id: { $in: objectIds }, receiver: mongoose.Types.ObjectId.createFromHexString(myUserId), readAt: null },
            { $set: { readAt: new Date() } }
        );

        // 消息已读状态更新后马上通知给自己和对方（fire-and-forget，不阻塞响应）
        if (unreadMessages.length !== 0) {
            void pushToUsers(
                unreadMessages.flatMap(m => [m.sender.toString(), m.receiver.toString()]),
                'novi_friend_message_readed',
                unreadMessages
            ).catch((err) => logPushError('novi_friend_message_readed', err));
        }

        res.status(200).json({
            message: '消息已标记为已读',
            modifiedCount: result.modifiedCount,
            unreadMessages: unreadMessages
        });
        return
    } catch (err: any) {
        logger.error(`markreaded error: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
};
router.put('/markreaded',
    middlewareAuth,
    middlewareValidate(markMessageReadedScheme, 'body'),
    putMessageMarkreadedHandler
);

// 接收者确认消息解密成功
// PUT message/crypto/ack
const messageCryptoAckScheme = Joi.object({
    messageIds: Joi.array().items(Joi.string().length(24)).min(1).required()
});
const putMessageCryptoAckHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const myUserId = req.noviUser?._id as string;
        const messageIds = req.body.messageIds as string[];
        const objectIds = messageIds.map((id: string) => mongoose.Types.ObjectId.createFromHexString(id));

        // 找出哪些消息确实属于当前用户且未读
        const unAckMessages = await FriendMessage.find({
            _id: { $in: objectIds },
            receiver: mongoose.Types.ObjectId.createFromHexString(myUserId),
            cryptoAckAt: null
        }).select('_id sender receiver').lean();

        if (unAckMessages.length === 0) {
            res.status(200).json({
                message: '没有可确认解密的消息',
                updatedIds: []
            });
            return
        }

        // 执行批量更新：过滤条件与上面的 find 完全一致，保证原子且无并发竞态
        const result = await FriendMessage.updateMany(
            { _id: { $in: objectIds }, receiver: mongoose.Types.ObjectId.createFromHexString(myUserId), cryptoAckAt: null },
            { $set: { cryptoAckAt: new Date() } }
        );

        // 消息解密确认状态更新后马上通知给自己和对方（fire-and-forget，不阻塞响应）
        if (unAckMessages.length !== 0) {
            void pushToUsers(
                unAckMessages.flatMap(m => [m.sender.toString(), m.receiver.toString()]),
                'novi_friend_message_crypto_ack',
                unAckMessages
            ).catch((err) => logPushError('novi_friend_message_crypto_ack', err));
        }

        res.status(200).json({
            message: '消息已标记为已解密',
            modifiedCount: result.modifiedCount,
            unAckMessages: unAckMessages
        });
        return
    } catch (err: any) {
        logger.error(`markreaded error: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
};
router.put('/crypto/ack',
    middlewareAuth,
    middlewareValidate(messageCryptoAckScheme, 'body'),
    putMessageCryptoAckHandler
);

export default router;
