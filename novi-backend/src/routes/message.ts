import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { IRequest } from '../comm/request.js';
import { FriendRequest, FriendMessage, MsgSeqCounter } from '../models/mongoModel.js';
import type { IFriendMessage } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';
import { pushToUsers, logPushError } from '../comm/push.js';
import { isDuplicateKeyError } from '../models/mongoConstants.js';

const router = Router();

// 向目标好友发送新消息（E2E：content 为密文，服务器不持有密钥、不解密、不校验签名/hash）
// POST message/
const postFriendMessage = Joi.object({
    noviCode: Joi.string().trim().min(1).max(10).required(),
    receiver: Joi.string().trim().min(10).max(100).required(),
    // 密文（base64），上限放大以容纳 AES-GCM 密文
    content: Joi.string().trim().min(1).max(65535).required(),
    iv: Joi.string().trim().max(256).required(),
    wrappedKey: Joi.string().trim().max(2048).required(),
    // 用发送方自己公钥包装的同一数据密钥（供其回读自己历史消息）。
    // 用 .optional()：兼容尚未升级的旧客户端（不发该字段），新文档缺该字段时发送方无法自解密，属可接受的退化
    wrappedKeySelf: Joi.string().trim().max(2048).optional(),
    sig: Joi.string().trim().max(2048).required(),
    preHash: Joi.string().trim().hex().length(64).required(),
    currHash: Joi.string().trim().hex().length(64).required(),
});
const postFriendMessagHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const myUserId = req.noviUser?._id as string;

    const { noviCode, receiver, content, iv, wrappedKey, wrappedKeySelf, sig, preHash, currHash } = req.body;
    if (receiver === myUserId) {
        res.status(400).json({ message: '无法向自己发送消息' });
        return
    }

    try {
        // 检查二人是否为好友关系，且 novicode 必须是「当前」代次
        // 按 createdAt 降序取最新的 accepted 记录（删除后重新添加会产生新代次），
        // 防止旧代次 novicode 写入消息（违反代次隔离不变量）
        const friendRequest = await FriendRequest.findOne({
            $or: [
                { requester: myUserId, receiver: receiver },
                { requester: receiver, receiver: myUserId }
            ],
            status: {
                $in: ['accepted']
            }
        }).sort({ createdAt: -1 });
        if (!friendRequest) {
            res.status(400).json({ message: '不能向非好友用户发送消息' });
            return
        }
        if (friendRequest.novicode !== noviCode) {
            res.status(400).json({ message: '消息代次与当前好友关系不匹配，请刷新后重试' });
            return
        }

        // 后端原子分配 seq：对 (sender,receiver,noviCode) 计数器文档 findOneAndUpdate $inc。
        // $inc 是单条原子命令，热会话并发下不再「读 max + 1」后撞唯一索引（thundering-herd）。
        // 计数器文档在启动回填时已建立（seq = 各会话 max）；新会话首次 $inc upsert 时
        // seq 由 schema default(0) 提供，$inc 后得 1（与旧行为「max(空)+1」一致）。
        // 注：$inc 与 $setOnInsert 不能作用于同一字段（Mongo 报 ConflictingUpdateOperators），
        // 故 upsert 时只 $inc，seq 初始值交给 schema default。
        const counter = await MsgSeqCounter.findOneAndUpdate(
            { sender: myUserId, receiver, noviCode },
            { $inc: { seq: 1 } },
            { upsert: true, new: true }
        );
        let nextSeq = counter.seq;

        // 保留唯一索引 (sender,receiver,noviCode,seq) 作最后兜底（理论上不再触发冲突）。
        // 极小概率下计数器被外部改动导致 E11000，重读计数器重试一次。
        const MAX_RETRY = 5;
        let savedMessage: IFriendMessage | null = null;
        for (let attempt = 0; attempt < MAX_RETRY && !savedMessage; attempt++) {
            try {
                const newFriendMessage = new FriendMessage({
                    noviCode,
                    sender: myUserId,
                    receiver,
                    content,
                    iv,
                    wrappedKey,
                    wrappedKeySelf,
                    sig,
                    preHash,
                    currHash,
                    seq: nextSeq,
                    sentAt: new Date(),
                });
                savedMessage = await newFriendMessage.save();
            } catch (saveErr: unknown) {
                // 唯一索引冲突（E11000）→ 重读计数器重试；其它错误直接抛出
                if (isDuplicateKeyError(saveErr)) {
                    const retryCounter = await MsgSeqCounter.findOneAndUpdate(
                        { sender: myUserId, receiver, noviCode },
                        { $inc: { seq: 1 } },
                        { new: true }
                    );
                    if (retryCounter) nextSeq = retryCounter.seq;
                    continue;
                }
                throw saveErr;
            }
        }

        if (!savedMessage) {
            res.status(409).json({ message: '消息序号冲突，请重试' });
            return
        }

        // 消息发送后马上通知给自己和对方（payload 含完整密文对象，接收方 WS 收到后本地解密）
        try {
            await pushToUsers(
                [savedMessage.sender.toString(), savedMessage.receiver.toString()],
                'novi_friend_message_comming',
                savedMessage
            );
        } catch (err) {
            logPushError('novi_friend_message_comming', err);
        }

        res.status(200).json(savedMessage);
        return
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
        return
    }
};

router.post('/', middlewareAuth, middlewareValidate(postFriendMessage), postFriendMessagHandler);

// 拉取与全部好友的消息未读情况
// GET message/allfriend
const getMessageAllFriendHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const myUserId = req.noviUser?._id as string;

    try {
        const myObjectId = mongoose.Types.ObjectId.createFromHexString(myUserId);
        const unreadMessages = await FriendMessage.aggregate([
            {
                $match: {
                    receiver: myObjectId,
                    readAt: null
                }
            },
            {
                $sort: { sentAt: -1 } // 先按时间倒序
            },
            {
                // 代次隔离：只保留「当前」好友关系代次的消息（删除后重新添加时，
                // 旧代次密文用新密钥无法解密；留在汇总里会虚增未读数与预览）
                $lookup: {
                    from: 'friendRequests',
                    // sid = 消息的发送者（对方账号），与 myId 一起用于匹配「我」与该 sender 之间的当前好友申请。
                    // 之前误用 '$_id'（消息自身 _id）导致 $expr $eq 永远不成立、代次隔离过滤失效。
                    let: { sid: '$sender', myId: myObjectId },
                    pipeline: [
                        {
                            $match: {
                                status: 'accepted',
                                $or: [
                                    { $and: [{ $expr: { $eq: ['$requester', '$sid'] } }, { $expr: { $eq: ['$receiver', '$myId'] } }] },
                                    { $and: [{ $expr: { $eq: ['$requester', '$myId'] } }, { $expr: { $eq: ['$receiver', '$sid'] } }] }
                                ]
                            }
                        },
                        // 同一对好友可能存在多条 accepted 记录（如删除后重新添加），显式取最新一条，
                        // 保证代次隔离取到的是「当前」代次，避免 $limit 隐式顺序导致的偶发误判
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                        { $project: { _id: 0, novicode: 1 } }
                    ],
                    as: 'curReq'
                }
            },
            { $unwind: { path: '$curReq', preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    $expr: {
                        $and: [
                            { $ne: ['$curReq.novicode', null] },
                            { $eq: ['$novicode', '$curReq.novicode'] }
                        ]
                    }
                }
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
                    // 密文配套字段：客户端列表摘要需本地解密出明文预览（服务器只透传，不解密）
                    iv: { $ifNull: ["$latestMessage.iv", null] },
                    wrappedKey: { $ifNull: ["$latestMessage.wrappedKey", null] },
                    wrappedKeySelf: { $ifNull: ["$latestMessage.wrappedKeySelf", null] },
                    sig: { $ifNull: ["$latestMessage.sig", null] },
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
    }
};
router.get('/allfriend', middlewareAuth, getMessageAllFriendHandler);

// GET message/pull/unread/byfriend
const getMessagePullUnreadByFriend = Joi.object({
    sender: Joi.string().trim().min(10).max(100).required(),
    before: Joi.date().optional(), // 拉取指定时间及其之前的30条
    after: Joi.date().optional(), // 拉取指定时间及其之后的30条
    novicode: Joi.string().trim().max(10).optional(), // 关系代次：只拉取指定代次的消息（删除后重新添加时旧代次密文不可解）
});
const getMessagePullUnreadByFriendHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const myUserId = req.noviUser?._id as string;

        const queryObj = req.query as { sender: string, before: string, after: string, novicode?: string };

        const senderId = mongoose.Types.ObjectId.createFromHexString(queryObj.sender);
        const myObjectId = mongoose.Types.ObjectId.createFromHexString(myUserId);

        // 会话是双向的：既要「对方发给我」，也要「我发给对方」。
        // 参数名 sender 实际指「会话对端」，这里统一用 $or 覆盖两个方向。
        type ConversationFilter = {
            $or: { sender: mongoose.Types.ObjectId; receiver: mongoose.Types.ObjectId }[];
            noviCode?: string;
        };
        const conversationFilter: ConversationFilter = {
            $or: [
                { sender: senderId, receiver: myObjectId },
                { sender: myObjectId, receiver: senderId }
            ]
        };

        // 关系代次过滤（与 $or 隐式 AND）：删除后重新添加时客户端只拉当前代次消息
        if (queryObj.novicode) conversationFilter.noviCode = queryObj.novicode;

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
            readAt: null,
            ...(queryObj.novicode ? { noviCode: queryObj.novicode } : {})
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
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
    // .max(200)：单次批量上限，防无界 $in + 无界推送扇出（DoS 面）。
    // 与前端「每次拉 30 条」对齐；超限返回 400，客户端应分批提交。
    messageIds: Joi.array().items(Joi.string().length(24)).min(1).max(200).required()
});

const putMessageMarkreadedHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const myUserId = req.noviUser?._id as string;
        const messageIds = req.body.messageIds as string[];
        const objectIds = messageIds.map((id: string) => mongoose.Types.ObjectId.createFromHexString(id));

        // 找出哪些消息确实属于当前用户、未读、且已解密确认（cryptoAckAt 已置）。
        // 已读依赖解密成功：未 ack 的消息不允许标已读（前端也只在解密成功后才提交）。
        const unreadMessages = await FriendMessage.find({
            _id: { $in: objectIds },
            receiver: mongoose.Types.ObjectId.createFromHexString(myUserId),
            readAt: null,
            cryptoAckAt: { $ne: null }
        }).select('_id sender receiver').lean();

        if (unreadMessages.length === 0) {
            res.status(200).json({
                message: '没有可标记的未读消息（需先解密确认）',
                updatedIds: []
            });
            return
        }

        // 执行批量更新：过滤条件与上面的 find 完全一致，保证原子且无并发竞态
        const result = await FriendMessage.updateMany(
            { _id: { $in: objectIds }, receiver: mongoose.Types.ObjectId.createFromHexString(myUserId), readAt: null, cryptoAckAt: { $ne: null } },
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`markreaded error: ${e}`);
        res.status(500).json({ message: '内部错误' });
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
    // .max(200)：单次批量上限，防无界 $in + 无界推送扇出（DoS 面）。
    messageIds: Joi.array().items(Joi.string().length(24)).min(1).max(200).required()
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
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`markreaded error: ${e}`);
        res.status(500).json({ message: '内部错误' });
    }
};
router.put('/crypto/ack',
    middlewareAuth,
    middlewareValidate(messageCryptoAckScheme, 'body'),
    putMessageCryptoAckHandler
);

export default router;
