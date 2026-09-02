import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import { apiFetch } from '@/api/request';
import { APIMacro } from '@/api/APIMacro';

// 会话中保存的用户信息（登录接口返回）
export interface SessionUser {
    userId: string;
    userName: string;
    email: string;
}

interface AuthContextType {
    token: string | null;
    user: SessionUser | null;
    /** 本地 token 是否已通过服务端校验（刷新页面后初始为 false） */
    tokenVerified: boolean;
    login: (token: string, user: SessionUser) => void;
    logout: () => void;
    updateEmailAndUserName: (email: string, userName: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 心跳间隔：后端 token TTL 的 1/3 左右，保持在线不被动登出
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [token, setToken] = useState<string | null>(localStorage.getItem('jwtToken'));
    const [user, setUser] = useState<SessionUser | null>(JSON.parse(localStorage.getItem('userInfo') || 'null'));
    const [tokenVerified, setTokenVerified] = useState(false);

    const clearSession = () => {
        setToken(null);
        setUser(null);
        setTokenVerified(false);
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userInfo');
    };

    const login = (newToken: string, userInfo: SessionUser) => {
        setToken(newToken);
        setUser(userInfo);
        setTokenVerified(true);
        localStorage.setItem('jwtToken', newToken);
        localStorage.setItem('userInfo', JSON.stringify(userInfo));
    };

    const logout = () => {
        clearSession();
        window.location.href = '/signin';
    };

    const updateEmailAndUserName = (email: string, userName: string) => {
        if (!user) return;
        const newUserInfo: SessionUser = { ...user, email, userName };
        setUser(newUserInfo);
        localStorage.setItem('userInfo', JSON.stringify(newUserInfo));
    };

    // 刷新页面后用本地 token 向服务端验证一次：失效则自动回到登录页
    useEffect(() => {
        if (!token || tokenVerified) return;
        let cancelled = false;

        (async () => {
            try {
                const res = await apiFetch(APIMacro.TOKEN_VERIFY, { method: 'GET' });
                if (cancelled) return;
                if (res.ok) {
                    setTokenVerified(true);
                } else {
                    clearSession();
                    window.location.href = '/signin';
                }
            } catch {
                // 网络错误不登出，等待下次心跳/请求重试
            }
        })();

        return () => { cancelled = true; };
    }, [token]);

    // 心跳续费：只要页面开着，token 就不会过期
    useEffect(() => {
        if (!token || !tokenVerified) return;
        const beat = async () => {
            try {
                const res = await apiFetch(APIMacro.HEARTBEAT, { method: 'GET' });
                if (res.status === 401) {
                    clearSession();
                    window.location.href = '/signin';
                }
            } catch {
                // 网络抖动忽略，下次心跳再试
            }
        };
        const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [token, tokenVerified]);

    return (
        <AuthContext.Provider value={{ token, user, tokenVerified, login, logout, updateEmailAndUserName }}>
            {children}
        </AuthContext.Provider>
    );
};

// 自定义 hook
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

// 需要当前登录用户的页面用这个：未登录直接抛错（这些页面本就不允许未登录访问）
export const useSessionUser = (): SessionUser => {
    const { user } = useAuth();
    if (!user) throw new Error('useSessionUser 需要在已登录状态下使用');
    return user;
};
