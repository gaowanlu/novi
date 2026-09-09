import mongoose from "mongoose";
import type { Document, Model } from "mongoose";
import logger from "../logger.js";
import { redisClient } from "../db/dbRedis.js";

// 用户文档接口
interface IUser extends Document {
    userName: string
    email: string
    password: string
    passwordSalt: string
    createdAt: Date
    updatedAt: Date
}

// 用户集合 Schema
const userSchema = new mongoose.Schema<IUser>(
    {
        userName: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        passwordSalt: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
    },
    {
        timestamps: true
    }
);

userSchema.index({ userName: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

const User: Model<IUser> = mongoose.model<IUser>('user', userSchema);


// 好友请求文档接口
interface IFriendRequest extends Document {
    requester: mongoose.Types.ObjectId
    receiver: mongoose.Types.ObjectId
    status: 'pending' | 'accepted' | 'rejected' | 'deleted' | 'canceled'
    publicKey?: string
    receiverPublicKey?: string
    novicode?: string // 关系代次（版本号），服务器分配：好友删除后重新添加 +1
    pairKey?: string // 规范化无序对（min\0max）
    createdAt: Date
    respondedAt?: Date
    updatedAt: Date
}

// 好友请求集团 Schema
const friendRequestSchema = new mongoose.Schema<IFriendRequest>(
    {
        requester: { // 请求发起者
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true
        },
        receiver: { // 请求接收者
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true
        },
        status: { // 好友验证状态
            type: String,
            enum: ['pending', 'accepted', 'rejected', 'deleted', 'canceled'],
            default: 'pending'
        },
        publicKey: { // 发起方公钥（base64 JWK），用于建立友谊时的密钥交换，服务器不持有私钥
            type: String,
            default: null
        },
        receiverPublicKey: { // 接收方公钥（base64 JWK），接受申请时写入；仅用于密钥交换回传，服务器不持有私钥
            type: String,
            default: null
        },
        novicode: { // 关系代次（版本号），服务器分配：好友删除后重新添加 +1；消息/密钥按代次隔离
            type: String,
            default: null
        },
        pairKey: { // 规范化无序对（min\0max），A→B 与 B→A 同键；用于 novicode 唯一约束
            type: String,
            default: null
        },
        createdAt: { // 请求发出时间
            type: Date,
            default: Date.now,
        },
        respondedAt: { // 接收者确认/拒绝时间
            type: Date,
        }
    },
    {
        timestamps: true
    }
);

friendRequestSchema.index({ requester: 1, receiver: 1 });
// 唯一约束（partial）：同一无序对在同一代次下唯一。partial 过滤双重条件：
//   1) status ∈ {pending, accepted}：已删除/取消/拒绝的历史记录不占位，
//      这样「删除后重新添加」才能拿到下一个 novicode；
//   2) pairKey 是 string（$type）：排除 pairKey=null/缺失的存量记录——它们不参与唯一性，
//      否则多节点 syncIndexes 在「同对多条存量记录都 pairKey=null」时建索引会撞 E11000。
// 该约束拦截跨节点并发创建同一好友关系时的 lost-update（两节点都读到 count=N 都写 N+1 → 重复代次）。
friendRequestSchema.index(
    { pairKey: 1, novicode: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ['pending', 'accepted'] }, pairKey: { $type: 'string' } } }
);
const FriendRequest: Model<IFriendRequest> = mongoose.model<IFriendRequest>(
    'friendRequest',
    friendRequestSchema
);

// 好友消息文档接口
interface IFriendMessage extends Document {
    noviCode: string
    sender: mongoose.Types.ObjectId
    receiver: mongoose.Types.ObjectId
    content: string      // 密文（base64），服务器永远拿不到明文
    iv?: string          // AES-GCM 初始化向量（base64）
    wrappedKey?: string  // 用接收方公钥 RSA-OAEP 包装的数据密钥（base64）
    wrappedKeySelf?: string // 用发送方自己公钥 RSA-OAEP 包装的同一数据密钥（base64），供发送方回读自己历史消息
    sig?: string         // 发送方 RSA-PSS 数字签名（base64）
    preHash?: string     // 上一条消息的 currHash（hex），链式串联；首条为创世 64 个 0
    currHash?: string    // 本条消息的 hash（hex）= sha256(canon(P) || sig)
    seq?: number         // 每 (sender,receiver,noviCode) 递增序号，并发/重复防护
    sentAt: Date
    cryptoAckAt?: Date
    readAt?: Date
    updatedAt: Date
}

// 好友消息集合 Schema
const friendMessageSchema = new mongoose.Schema<IFriendMessage>(
    {
        noviCode: { // 用于追踪双方密钥版本同步
            type: String,
            required: true
        },
        sender: { // 发出者
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true,
        },
        receiver: { // 接收者
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true,
        },
        content: { // 用户之间自己发的消息内容主体（E2E 落地后为密文 base64）
            type: String,
            required: true,
        },
        iv: { // AES-GCM 初始化向量
            type: String,
            default: null,
        },
        wrappedKey: { // 用接收方公钥包装的数据密钥（接收方解包用）
            type: String,
            default: null,
        },
        wrappedKeySelf: { // 用发送方自己公钥包装的同一数据密钥（发送方回读自己历史消息用）
            type: String,
            default: null,
        },
        sig: { // 发送方数字签名
            type: String,
            default: null,
        },
        preHash: { // 上一条 currHash（链式）
            type: String,
            default: null,
        },
        currHash: { // 本条 currHash（链式）
            type: String,
            default: null,
        },
        seq: { // 每 (sender,receiver,noviCode) 递增序号，后端分配
            type: Number,
            default: null,
        },
        sentAt: { // 发送时间
            type: Date,
            default: Date.now,
        },
        cryptoAckAt: { // 接收者解密确认时间
            type: Date,
            default: null,
        },
        readAt: { // 接收者确认已读时间
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true
    }
);

friendMessageSchema.index({ sender: 1, receiver: 1, sentAt: -1 });
friendMessageSchema.index({ receiver: 1, readAt: 1, sentAt: -1 });
// 唯一索引：防止同一 (发送者,接收者,密钥版本) 下重复序号，并发写入冲突时重试。
// 部分索引（仅覆盖有 seq 的文档）：历史明文消息 seq=null，Mongo 唯一索引中 null 会互相冲突，
// 全量唯一索引无法在已有数据上建成。部分索引不支持 $ne，用 $type 表达"seq 是数字"。
friendMessageSchema.index(
    { sender: 1, receiver: 1, noviCode: 1, seq: 1 },
    { unique: true, partialFilterExpression: { seq: { $type: 'number' } } }
);
const FriendMessage: Model<IFriendMessage> = mongoose.model<IFriendMessage>(
    'friendMessage',
    friendMessageSchema
);

// 消息序号计数器文档接口
interface IMsgSeqCounter extends Document {
    sender: mongoose.Types.ObjectId
    receiver: mongoose.Types.ObjectId
    noviCode: string
    seq: number
    updatedAt: Date
}

// 消息序号计数器集合 Schema：每 (sender, receiver, noviCode) 一个计数器。
// 用 findOneAndUpdate $inc 原子分配 seq，替代「读 max + 1」的读后写（热会话并发下会 thundering-herd 撞唯一索引）。
// 与消息唯一索引 {sender,receiver,noviCode,seq} 配合：$inc 保证不冲突，唯一索引作最后兜底。
const msgSeqCounterSchema = new mongoose.Schema<IMsgSeqCounter>(
    {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
        receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
        noviCode: { type: String, required: true },
        seq: { type: Number, default: 0 },
    },
    { timestamps: true }
);
msgSeqCounterSchema.index({ sender: 1, receiver: 1, noviCode: 1 }, { unique: true });
const MsgSeqCounter: Model<IMsgSeqCounter> = mongoose.model<IMsgSeqCounter>('msgSeqCounter', msgSeqCounterSchema);

// 规范化无序对键：min\0max。A→B 与 B→A 落到同一键，用于 novicode 的唯一约束、计数与 pairKey 回填。
export const buildPairKey = (a: string, b: string): string => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

// 启动互斥锁：多节点同时启动时只让一个做索引同步 + 回填，避免 N 倍启动写风暴。
// 锁在 Redis（符合「无内存跨节点状态」不变量）；持有者为 NOVI_NODE，10 分钟 TTL 兜底
// （进程崩溃未 DEL 时自动过期）。syncIndexes/回填均幂等，跳过者无正确性风险。
const BOOTSTRAP_LOCK_KEY = 'novi:bootstrap:lock';
const BOOTSTRAP_LOCK_TTL_SEC = 60 * 10;
const NOVI_NODE = process.env.NOVI_NODE ?? 'unknown-node';

const onMongoConnected = async (): Promise<void> => {
    // 1) 抢锁（SET NX）：未抢到说明其它节点正在初始化，跳过本节点的重活。
    const claimed = await redisClient.set(BOOTSTRAP_LOCK_KEY, NOVI_NODE, { NX: true, EX: BOOTSTRAP_LOCK_TTL_SEC });
    if (claimed !== 'OK') {
        logger.info(`onMongoConnected: 其它节点持启动锁（${await redisClient.get(BOOTSTRAP_LOCK_KEY) ?? '?'}），本节点跳过 syncIndexes/回填`);
        return;
    }

    try {
        await User.syncIndexes();
        await FriendRequest.syncIndexes();
        await FriendMessage.syncIndexes();
        await MsgSeqCounter.syncIndexes();

        // 回填走原生 collection 的 find/updateMany/bulkWrite，不用 aggregate + $merge：
        // node driver 在当前环境下 $merge 行为异常（不写入目标集合），改用显式 find + 批量写更稳。
        // 幂等：novicode/pairKey 用 $set 固定值或 buildPairKey，重复跑收敛到同一结果。
        const frColl = FriendRequest.collection;

        // 1) 回填关系代次：存量（修复前）记录无 novicode，统一视为第 "1" 代（= 客户端 DEFAULT_NOVI_CODE）。
        await frColl.updateMany(
            { $or: [{ novicode: { $exists: false } }, { novicode: null }] },
            { $set: { novicode: "1" } }
        );

        // 2) 回填 pairKey（规范化无序对，供 novicode 唯一约束在已有数据上生效）。
        //    逐条 buildPairKey（应用层）后 bulkWrite upsert；独立 try，撞唯一索引也不影响其它回填。
        try {
            const nullPairDocs = await frColl.find(
                { $or: [{ pairKey: { $exists: false } }, { pairKey: null }] },
                { projection: { _id: 1, requester: 1, receiver: 1 } }
            ).toArray();
            if (nullPairDocs.length > 0) {
                const ops = nullPairDocs.map((d: any) => ({
                    updateOne: {
                        filter: { _id: d._id },
                        update: { $set: { pairKey: buildPairKey(d.requester.toString(), d.receiver.toString()) } },
                        upsert: false,
                    },
                }));
                await frColl.bulkWrite(ops, { ordered: false });
            }
        } catch (pairErr: unknown) {
            const pe = pairErr instanceof Error ? pairErr.message : String(pairErr);
            logger.error(`pairKey 回填失败（不影响 novicode/seq）: ${pe}`);
        }

        // 3) 回填消息会话序号计数器：每个 (sender,receiver,noviCode) 取各会话最大 seq。
        //    find 出有 seq 的消息 → 按会话归并取 max → bulkWrite upsert 到 msgSeqCounter。
        //    幂等：每次启动重算各会话真实 max，收敛到正确水位。
        const msgDocs = await FriendMessage.collection
            .find({ seq: { $type: 'number' } }, { projection: { sender: 1, receiver: 1, noviCode: 1, seq: 1 } })
            .toArray();
        if (msgDocs.length > 0) {
            const byConv = new Map<string, { sender: string; receiver: string; noviCode: string; seq: number }>();
            for (const m of msgDocs) {
                const key = `${m.sender}\u0000${m.receiver}\u0000${m.noviCode}`;
                const cur = byConv.get(key);
                if (!cur) byConv.set(key, { sender: m.sender.toString(), receiver: m.receiver.toString(), noviCode: m.noviCode, seq: m.seq });
                else if (m.seq > cur.seq) cur.seq = m.seq;
            }
            const ops = Array.from(byConv.values()).map((c) => ({
                updateOne: {
                    filter: { sender: c.sender, receiver: c.receiver, noviCode: c.noviCode },
                    update: { $set: { sender: c.sender, receiver: c.receiver, noviCode: c.noviCode, seq: c.seq } },
                    upsert: true,
                },
            }));
            await MsgSeqCounter.collection.bulkWrite(ops, { ordered: false });
        }
    } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        logger.error(`onMongoConnected 失败: ${e.message}`);
    } finally {
        // 释放锁：仅当锁仍属于本节点才 DEL（Lua 原子检查+删，避免误删其它节点的锁）。
        // 失败不致命：EX 10 分钟会让残留锁自动过期，下次启动可重试。
        try {
            const script = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
            await redisClient.eval(script, { keys: [BOOTSTRAP_LOCK_KEY], arguments: [NOVI_NODE] });
        } catch (delErr: unknown) {
            const de = delErr instanceof Error ? delErr.message : String(delErr);
            logger.error(`onMongoConnected 释放锁失败（将靠 TTL 过期）: ${de}`);
        }
    }
};

export { User, FriendRequest, FriendMessage, MsgSeqCounter, onMongoConnected };
export type { IUser, IFriendRequest, IFriendMessage, IMsgSeqCounter };
