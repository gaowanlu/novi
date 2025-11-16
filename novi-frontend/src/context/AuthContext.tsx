import {
    createContext,
    useContext,
    useState,
    type ReactNode,   // ← 只改这里，加 type
} from 'react';

interface AuthContextType {
    token: string | null;
    user: any;
    login: (token: string, user: any) => void;
    logout: () => void;
    updateEmailAndUserName: (email: string, userName: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [token, setToken] = useState<string | null>(localStorage.getItem('jwtToken'));
    const [user, setUser] = useState<any>(JSON.parse(localStorage.getItem('userInfo') || 'null'));

    const login = (newToken: string, userInfo: any) => {
        setToken(newToken);
        setUser(userInfo);
        localStorage.setItem('jwtToken', newToken);
        localStorage.setItem('userInfo', JSON.stringify(userInfo));
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userInfo');
        window.location.href = '/signin';
    };

    const updateEmailAndUserName = (email: string, userName: string) => {
        const newUserInfo = { ...user };
        newUserInfo.email = email;
        newUserInfo.userName = userName;
        setUser(newUserInfo);
        localStorage.setItem('userInfo', JSON.stringify(newUserInfo));
    }

    return (
        <AuthContext.Provider value={{ token, user, login, logout, updateEmailAndUserName }}>
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