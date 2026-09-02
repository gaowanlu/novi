// 本地开发可通过 .env 的 VITE_NOVI_HOST 指向本地后端，例如 http://127.0.0.1:3000
const HOST = import.meta.env.VITE_NOVI_HOST ?? 'http://mfavant.xyz:3000';

const LOGIN = `/api/auth/login`;
const LOGOUT = `/api/auth/logout`;
const HEARTBEAT = `/api/auth/heartbeat`;
const TOKEN_VERIFY = `/api/auth/token/verify`;
const SIGNUP = `/api/user`;
const PUTUSER = `/api/user`;
const USERFIND = `/api/user/find`;
const GETFRIEND = `/api/friend`;
const FRIEND_REQUEST = `/api/friend/request`;
const MESSAGE = `/api/message`;
const MESSAGE_PULL = `/api/message/pull/unread/byfriend`;
const MESSAGE_ALLFRIEND = `/api/message/allfriend`;
const MESSAGE_MARKREADED = `/api/message/markreaded`;

const APIMacro = {
    HOST, // 服务地址
    LOGIN: `${HOST}${LOGIN}`, // 登录
    LOGOUT: `${HOST}${LOGOUT}`, // 登出
    HEARTBEAT: `${HOST}${HEARTBEAT}`, // 心跳续费 token
    TOKEN_VERIFY: `${HOST}${TOKEN_VERIFY}`, // 校验本地 token 是否仍有效
    SIGNUP: `${HOST}${SIGNUP}`, // 注册
    PUTUSER: `${HOST}${PUTUSER}`, // 修改个人信息
    USERFIND: `${HOST}${USERFIND}`, // 搜索用户
    GETFRIEND: `${HOST}${GETFRIEND}`, // 获取好友列表
    POSTFRIENDREQUEST: `${HOST}${FRIEND_REQUEST}`, // 申请添加新好友
    GETFRIENDREQUEST: `${HOST}${FRIEND_REQUEST}`, // 获取自己相关的好友关系申请列表
    DELETEFRIENDREQUEST: `${HOST}${FRIEND_REQUEST}`, // 撤回自己发起的好友申请
    PUTFRIENDREQUEST: `${HOST}${FRIEND_REQUEST}`, // 拒绝或同意添加好友
    DELETEFRIEND: `${HOST}${GETFRIEND}`, // 删除好友
    POSTMESSAGE: `${HOST}${MESSAGE}`, // 发送消息
    GETMESSAGE_PULL: `${HOST}${MESSAGE_PULL}`, // 拉取与某好友的会话（未读/历史）
    GETMESSAGE_ALLFRIEND: `${HOST}${MESSAGE_ALLFRIEND}`, // 拉取全部好友未读汇总
    PUTMESSAGE_MARKREADED: `${HOST}${MESSAGE_MARKREADED}`, // 标记消息已读
};

export { APIMacro };
