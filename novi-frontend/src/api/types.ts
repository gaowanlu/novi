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
    requester: FriendParty;
    receiver: FriendParty;
}

// 消息
export interface FriendMessageItem {
    _id: string;
    noviCode: string;
    sender: string;
    receiver: string;
    content: string;
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
