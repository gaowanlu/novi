import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface VaultGateProps {
    mode: 'unlock' | 'setup';
    /** vault 是否已有用户密码（决定解锁框文案 / setup 是否允许留空） */
    hasPassword: boolean;
    onUnlock: (password: string) => Promise<boolean>;
    onSetup: (password: string) => Promise<void>;
}

export function VaultGate({ mode, hasPassword, onUnlock, onSetup }: VaultGateProps) {
    const [password, setPassword] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const isSetup = mode === 'setup';
    // setup 模式且 vault 已有密码（补设密码场景）→ 新密码必填
    const passwordRequired = isSetup && hasPassword;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);

        if (passwordRequired && password.length < 8) {
            setError('密码至少 8 个字符');
            return;
        }
        if (isSetup && password !== confirmPw) {
            setError('两次输入的密码不一致');
            return;
        }

        setBusy(true);
        try {
            if (isSetup) {
                await onSetup(password);
            } else {
                const ok = await onUnlock(password);
                if (!ok) {
                    setError('密码不正确');
                    setPassword('');
                }
            }
        } catch {
            setError('操作失败，请重试');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-dvh items-center justify-center bg-background">
            <div className="w-full max-w-sm px-4">
                <div className="flex flex-col items-center gap-6">
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                            {isSetup
                                ? <ShieldCheck className="size-7 text-primary" />
                                : <KeyRound className="size-7 text-primary" />}
                        </div>
                        <div className="text-center">
                            <h1 className="text-lg font-semibold tracking-tight">
                                {isSetup ? '设置保险箱密码' : '解锁保险箱'}
                            </h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {isSetup
                                    ? (hasPassword
                                        ? '设置密码后，私钥将以密码加密保存，刷新页面需重新输入密码。'
                                        : '私钥在本浏览器内加密保存。设置密码后刷新页面需重新输入，并可通过备份跨设备迁移；留空则每次打开均免密。')
                                    : '输入密码以解锁你的端到端加密密钥'}
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="vault-pw" className="sr-only">保险箱密码</Label>
                            <Input
                                id="vault-pw"
                                type="password"
                                placeholder={isSetup ? (hasPassword ? '新密码（至少 8 位）' : '设置密码（至少 8 位，可留空）') : '输入保险箱密码'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoFocus
                                className="text-center tracking-widest"
                            />
                        </div>

                        {isSetup && (
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="vault-pw-confirm" className="sr-only">确认密码</Label>
                                <Input
                                    id="vault-pw-confirm"
                                    type="password"
                                    placeholder={password ? '再次输入密码' : '留空则免密'}
                                    value={confirmPw}
                                    onChange={e => setConfirmPw(e.target.value)}
                                    className="text-center tracking-widest"
                                />
                            </div>
                        )}

                        {error && (
                            <p className="text-center text-sm text-destructive">{error}</p>
                        )}

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={busy}
                        >
                            {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
                            {busy
                                ? (isSetup ? '加密中…' : '解锁中…')
                                : (isSetup ? '设置密码' : '解锁')}
                        </Button>
                    </form>

                    <p className="text-center text-xs leading-relaxed text-muted-foreground">
                        密码仅用于在本浏览器内加密/解密你的私钥，
                        不会上传到任何服务器。
                        <br />
                        {hasPassword
                            ? '遗忘密码将无法解密历史消息，请牢记。'
                            : '设置密码后，遗忘密码将无法解密历史消息，请牢记。'}
                    </p>
                </div>
            </div>
        </div>
    );
}
