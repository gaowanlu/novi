const HOST = 'http://mfavant.xyz:3000';
const LOGIN = `/api/auth/login`;
const SIGNUP = `/api/user`;
const LOGOUT = `/api/auth/logout`;
const GETFRIEND = `/api/friend`;

const ApiMacro = {
    HOST,
    LOGIN: `${HOST}${LOGIN}`,
    SIGNUP: `${HOST}${SIGNUP}`,
    LOGOUT: `${HOST}${LOGOUT}`,
    GETFRIEND: `${HOST}${GETFRIEND}`
};

export { ApiMacro };