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
    content: string
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
        content: { // 用户之间自己发的消息内容主体
            type: String,
            required: true,
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
const FriendMessage: Model<IFriendMessage> = mongoose.model<IFriendMessage>(
    'friendMessage',
    friendMessageSchema
);

const onMongoConnected = async (): Promise<void> => {
    try {
        await User.syncIndexes();
        await FriendRequest.syncIndexes();
        await FriendMessage.syncIndexes();
    } catch (err) {
        const e = err as Error;
        console.error(`${e.message}`);
    }
};

export { User, FriendRequest, FriendMessage, onMongoConnected };
export type { IUser, IFriendRequest, IFriendMessage };
