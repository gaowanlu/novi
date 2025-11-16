const HOST = 'http://mfavant.xyz:3000';
const LOGIN = `/api/auth/login`;
const SIGNUP = `/api/user`;
const LOGOUT = `/api/auth/logout`;
const GETFRIEND = `/api/friend`;
const PUTUSER = `/api/user`;

const APIMacro = {
    HOST,
    LOGIN: `${HOST}${LOGIN}`,
    SIGNUP: `${HOST}${SIGNUP}`,
    LOGOUT: `${HOST}${LOGOUT}`,
    GETFRIEND: `${HOST}${GETFRIEND}`,
    PUTUSER: `${HOST}${PUTUSER}`
};

export { APIMacro };