import mongoose from "mongoose";
import type { Document, Model } from "mongoose";

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

const onMongoConnected = async (): Promise<void> => {
    try {
        await User.syncIndexes();
        await FriendRequest.syncIndexes();
        await FriendMessage.syncIndexes();

        // 回填存量好友申请记录的关系代次（修复前文档无该字段、改 schema 后新文档默认 null）：
        // 存量记录统一视为第 "1" 代，与客户端 DEFAULT_NOVI_CODE 一致
        await FriendRequest.updateMany(
            { $or: [{ novicode: { $exists: false } }, { novicode: null }] },
            { $set: { novicode: "1" } }
        );
    } catch (err) {
        const e = err as Error;
        console.error(`${e.message}`);
    }
};

export { User, FriendRequest, FriendMessage, onMongoConnected };
export type { IUser, IFriendRequest, IFriendMessage };
