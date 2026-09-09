import {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import {
    vaultStatus,
    setupVault,
    unlockVault,
    changeVaultPassword,
    lockVault,
    type VaultStatus,
} from '@/crypto/vault';
import { hasPlaintextKeys, migratePlaintextKeys } from '@/crypto/keyStore';

interface VaultContextType {
    status: VaultStatus;
    /** vault 是否存在用户设置的密码（无密码 = 仅本浏览器内加密，刷新后无需再输密码） */
    hasPassword: boolean;
    /** 启动引导是否已完成（自动建箱/迁移均为异步，完成前 ProtectedRoute 显示加载态） */
    booting: boolean;
    unlock: (password: string) => Promise<boolean>;
    setup: (password: string) => Promise<void>;
    changePassword: (oldPw: string, newPw: string) => Promise<void>;
    lock: () => void;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider = ({ children }: { children: ReactNode }) => {
    const { user, tokenVerified } = useAuth();
    const myId = user?.userId ?? null;

    const [status, setStatus] = useState<VaultStatus>(
        myId ? vaultStatus(myId) : 'none'
    );
    const [hasPassword, setHasPassword] = useState(false);
    /** 启动引导是否已完成（自动建箱/迁移均为异步，完成前 ProtectedRoute 显示加载态） */
    const [booting, setBooting] = useState(true);

    // 账号切换时立即纠正状态（同一会话内换号登录的场景）
    useEffect(() => {
        if (!myId) {
            setStatus('none');
            setHasPassword(false);
            setBooting(true);
            return;
        }
        setStatus(vaultStatus(myId));
        setBooting(true);
    }, [myId]);

    useEffect(() => {
        if (!myId || !tokenVerified) return;
        let cancelled = false;

        (async () => {
            const s = vaultStatus(myId);
            setStatus(s);

            if (s === 'locked') {
                // 上次已设过密码 → 本轮刷新后需重新输入（由 gate 引导）
                setHasPassword(true);
                setBooting(false);
                return;
            }

            // 无 vault：
            //  - 有明文私钥 → 无密码自动建箱 + 迁移，全程静默（用户从未设过密码，无可输）
            //  - 无明文私钥 → 首次使用，引导用户设置密码
            if (hasPlaintextKeys(myId)) {
                await setupVault(myId, '');
                await migratePlaintextKeys(myId);
                if (cancelled) return;
                setHasPassword(false);
                setStatus('unlocked');
                setBooting(false);
                return;
            }

            setHasPassword(false);
            setBooting(false);
        })().catch(() => {
            if (!cancelled) setBooting(false);
        });

        return () => { cancelled = true; };
    }, [myId, tokenVerified]);

    const unlock = useCallback(async (password: string) => {
        if (!myId) return false;
        const ok = await unlockVault(myId, password);
        if (ok) {
            setHasPassword(true);
            setStatus('unlocked');
        }
        return ok;
    }, [myId]);

    const setup = useCallback(async (password: string) => {
        if (!myId) return;
        await setupVault(myId, password);
        if (hasPlaintextKeys(myId)) {
            await migratePlaintextKeys(myId);
        }
        setHasPassword(password !== '');
        setStatus('unlocked');
    }, [myId]);

    const changePassword = useCallback(async (oldPw: string, newPw: string) => {
        if (!myId) return;
        await changeVaultPassword(myId, oldPw, newPw);
        setHasPassword(newPw !== '');
        setStatus('unlocked');
    }, [myId]);

    const lock = useCallback(() => {
        lockVault();
        setStatus(myId ? vaultStatus(myId) : 'none');
    }, [myId]);

    return (
        <VaultContext.Provider value={{ status, hasPassword, booting, unlock, setup, changePassword, lock }}>
            {children}
        </VaultContext.Provider>
    );
};

export const useVault = () => {
    const context = useContext(VaultContext);
    if (!context) throw new Error('useVault must be used within VaultProvider');
    return context;
};
