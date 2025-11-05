import mongoose from "mongoose";

// Schema=>用户集合 user
const userSchema = new mongoose.Schema({
    userName: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.index({ userName: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('user', userSchema);

// Schema=>好友请求 friendRequest
const friendRequestSchema = new mongoose.Schema({
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
}, { timestamps: true });
friendRequestSchema.index({ requester: 1, receiver: 1 });
const FriendRequest = mongoose.model('friendRequest', friendRequestSchema);

// Schema=>好友消息 friendMessage
const friendMessageSchema = new mongoose.Schema({
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
    receivedAt: { // 接收者首次拉取消息的时间
        type: Date,
        default: null,
    },
    readAt: { // 接收者确认已读时间
        type: Date,
        default: null,
    },
}, { timestamps: true });
friendMessageSchema.index({ sender: 1, receiver: 1, sentAt: -1 });
const FriendMessage = mongoose.model('friendMessage', friendMessageSchema);

const onMongoConnected = () => {
    User.syncIndexes();
    FriendRequest.syncIndexes();
    FriendMessage.syncIndexes();
};

export { User, FriendRequest, FriendMessage, onMongoConnected };
