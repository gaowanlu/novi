// 与后端接口对齐的共享类型

// 登录成功返回
export interface LoginResult {
    jwtToken: string;
    userId: string;
    userName: string;
    email: string;
}

// 注册成功返回（不含 token，需再走登录）
export interface SignupResult {
    _id: string;
    userName: string;
    email: string;
}

// 用户搜索结果
export interface UserBrief {
    _id: string;
    userName: string;
}

// 好友申请 / 好友列表聚合结果
export interface FriendParty {
    userId: string | null;
    userName: string;
}

export interface FriendRequestItem {
    friendRequestId: string;
    status: 'pending' | 'accepted' | 'rejected' | 'deleted' | 'canceled';
    createdAt: string;
    respondedAt?: string | null;
    // 发起方公钥（base64 JWK），用于建立友谊时的密钥交换
    publicKey?: string | null;
    // 接收方公钥（base64 JWK），接受申请时落库；离线方上线拉取时据此补齐 5 元组
    receiverPublicKey?: string | null;
    // 关系代次（版本号），服务器分配：好友删除后重新添加会 +1
    novicode?: string | null;
    requester: FriendParty;
    receiver: FriendParty;
}

// 消息（E2E：content 为密文 base64，附 iv/wrappedKey/sig/链 hash/序号）
export interface FriendMessageItem {
    _id: string;
    noviCode: string;
    sender: string;
    receiver: string;
    content: string;      // 密文 base64
    iv?: string | null;       // AES-GCM IV base64
    wrappedKey?: string | null; // 用接收方公钥包装的数据密钥 base64
    wrappedKeySelf?: string | null; // 用发送方自己公钥包装的同一数据密钥 base64（供发送方回读自己历史消息）
    sig?: string | null;      // 发送方 RSA-PSS 签名 base64
    preHash?: string | null;  // 上一条 currHash hex（链式）
    currHash?: string | null; // 本条 currHash hex（链式）
    seq?: number | null;      // 每 (sender,receiver,noviCode) 序号
    sentAt: string;
    readAt?: string | null;
    cryptoAckAt?: string | null;
}

// 各好友未读汇总
export interface UnreadSummary {
    sender: string;
    unreadCount: number;
    content: string;
    sentAt: string;
    lastMessageID: string;
    noviCode: string;
    senderInfo: {
        _id: string | null;
        userName: string;
    };
}

// 后端统一错误体
export interface ApiError {
    message?: string;
}

// 会话/聊天选中项（FunctionalPage 与 FriendPanel 共用）
export interface SelectedFriend {
    userId: string;
    userName: string;
    /** 关系代次（版本号），来自好友申请记录；删除后重新添加会 +1 */
    novicode?: string | null;
}

// 消息面板当前用户（MessagePanel 用，userId 即可定位身份）
export interface ChatUser {
    userId: string;
}
