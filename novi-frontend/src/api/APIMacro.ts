const HOST = 'http://mfavant.xyz:3000';
const LOGIN = `/api/auth/login`;
const SIGNUP = `/api/user`;
const LOGOUT = `/api/auth/logout`;
const GETFRIEND = `/api/friend`;
const PUTUSER = `/api/user`;
const USERFIND = `/api/user/find`;
const POSTFRIENDREQUEST = `/api/friend/request`;
const GETFRIENDREQUEST = `/api/friend/request`;
const DELETEFRIEND = `/api/friend`;
const DELETEFRIENDREQUEST = `/api/friend/request`;
const PUTFRIENDREQUEST = `/api/friend/request`;

const APIMacro = {
    HOST, // 服务地址
    LOGIN: `${HOST}${LOGIN}`, // 登录
    SIGNUP: `${HOST}${SIGNUP}`, // 注册
    LOGOUT: `${HOST}${LOGOUT}`, // 登出
    GETFRIEND: `${HOST}${GETFRIEND}`, // 获取好友列表
    PUTUSER: `${HOST}${PUTUSER}`, // 修改个人信息
    USERFIND: `${HOST}${USERFIND}`, // 搜索用户
    POSTFRIENDREQUEST: `${HOST}${POSTFRIENDREQUEST}`, // 申请添加新好友
    GETFRIENDREQUEST: `${HOST}${GETFRIENDREQUEST}`, // 获取自己相关的好友关系申请列表
    DELETEFRIEND: `${HOST}${DELETEFRIEND}`, // 删除好友
    DELETEFRIENDREQUEST: `${HOST}${DELETEFRIENDREQUEST}`, // 撤回自己发起的好友申请
    PUTFRIENDREQUEST: `${HOST}${PUTFRIENDREQUEST}` // 拒绝或同意添加好友
};

export { APIMacro };