import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    Loader2,
    User as UserIcon,
    Mail,
    Hash,
    Download,
    Upload,
    ShieldCheck,
    KeyRound,
    ChevronRight,
    Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { APIMacro } from '../api/APIMacro';
import { apiFetch, parseJson, errorText } from '../api/request';
import type { ApiError } from '../api/types';
import { useAuth, useSessionUser } from '../context/AuthContext';
import { useVault } from '../context/VaultContext';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { clearKeys, downloadKeysBackup, importKeysBackup, parseKeysBackup } from '@/crypto/keyStore';

function UserInfoPage() {
    const [loading, setLoading] = useState(false);
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const [clearOpen, setClearOpen] = useState(false);
    const importFileRef = useRef<HTMLInputElement>(null);

    const { updateEmailAndUserName } = useAuth();
    const { status: vaultStatus, hasPassword, changePassword, lock } = useVault();
    const user = useSessionUser();

    const [changePwOpen, setChangePwOpen] = useState(false);
    const [oldPw, setOldPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [pwBusy, setPwBusy] = useState(false);

    const handleImportKeys = () => importFileRef.current?.click();

    const handleClearKeys = () => {
        clearKeys(user.userId);
        setClearOpen(false);
        toast.success('本地密钥已清空', { description: '与该好友的历史消息将无法解密' });
    };

    const handleLockVault = () => {
        lock();
        toast.success('保险箱已锁定');
    };

    const handleChangePw = async () => {
        if (newPw.length < 8) {
            toast.error('新密码至少 8 个字符');
            return;
        }
        if (newPw !== confirmPw) {
            toast.error('两次输入的新密码不一致');
            return;
        }
        setPwBusy(true);
        try {
            await changePassword(oldPw, newPw);
            setChangePwOpen(false);
            setOldPw('');
            setNewPw('');
            setConfirmPw('');
            toast.success('保险箱密码已更新');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? (err.message || '修改失败') : '修改失败');
        } finally {
            setPwBusy(false);
        }
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const bundle = parseKeysBackup(text);
            if (bundle.myId !== user.userId) {
                toast.error('备份不属于当前账号', { description: '请导入你自己导出的密钥文件' });
                return;
            }
            await importKeysBackup(bundle);
            toast.success('密钥已导入', { description: '历史消息现在可重新解密' });
        } catch (err: unknown) {
            toast.error('导入失败', { description: err instanceof Error ? (err.message || '文件格式不正确') : '文件格式不正确' });
        } finally {
            if (importFileRef.current) importFileRef.current.value = '';
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await apiFetch(APIMacro.PUTUSER, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    _id: user.userId,
                    userName,
                    email,
                })
            });

            const raw = await parseJson(res);

            if (res.ok) {
                const data = raw as { email: string; userName: string };
                toast.success('修改成功', { description: '你的资料已更新' });
                updateEmailAndUserName(data.email, data.userName);
            } else {
                toast.error('修改失败', { description: errorText(res, raw as ApiError | null) });
            }
        } catch (err: unknown) {
            toast.error('网络错误', { description: err instanceof Error ? err.message : undefined });
        } finally {
            setLoading(false);
        }
    };

    const initials = user.userName?.trim()?.slice(0, 2) || '?';

    return (
        <PageShell>
            <div className="flex flex-col">
                {/* 头像区 */}
                <div className="flex flex-col items-center gap-3">
                    <Avatar className="size-24 shadow-md">
                        <AvatarFallback className="bg-primary text-3xl font-semibold text-primary-foreground">
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-center gap-0.5 text-center">
                        <span className="text-lg font-semibold tracking-tight">{user.userName}</span>
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Mail data-icon="inline-start" className="size-3.5" />
                            {user.email}
                        </span>
                    </div>
                </div>

                {/* 编辑资料 */}
                <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-1">
                    <div className="flex flex-col gap-1 pb-1">
                        <span className="text-xs font-medium text-muted-foreground">个人资料</span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <UserIcon className="size-3.5" />
                            用户名
                        </span>
                        <Input
                            id="newUserName"
                            type="text"
                            placeholder="新的用户名"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="h-px bg-border/60" />

                    <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Mail className="size-3.5" />
                            邮箱
                        </span>
                        <Input
                            id="newEmail"
                            type="email"
                            placeholder="新的邮箱"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <Button
                        type="submit"
                        className="mt-3 w-full"
                        disabled={loading}
                    >
                        {loading && <Loader2 data-icon="inline-start" className="animate-spin" />}
                        {loading ? '保存中…' : '保存修改'}
                    </Button>
                </form>

                {vaultStatus !== 'none' && (
                    <>
                    {/* 端到端加密密钥 */}
                    <div className="mt-6 flex flex-col gap-1">
                    <div className="flex items-center gap-2 pb-1">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">端到端加密密钥</span>
                    </div>

                    <button
                        type="button"
                        onClick={async () => { await downloadKeysBackup(user.userId); toast.success('密钥已导出'); }}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:border-ring outline-none"
                    >
                        <Download data-icon="inline-start" className="size-5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">导出密钥备份</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <div className="h-px bg-border/60" />

                    <button
                        type="button"
                        onClick={handleImportKeys}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:border-ring outline-none"
                    >
                        <Upload data-icon="inline-start" className="size-5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">导入密钥备份</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <div className="h-px bg-border/60" />

                    <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
                        <button
                            type="button"
                            onClick={() => setClearOpen(true)}
                            className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:border-ring outline-none"
                        >
                            <Trash2 data-icon="inline-start" className="size-5 shrink-0 text-destructive" />
                            <span className="flex-1 text-sm text-destructive">清空本地密钥</span>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>清空本地密钥？</AlertDialogTitle>
                                <AlertDialogDescription>
                                    将删除保存在本浏览器中的全部端到端密钥与消息链头。
                                    删除后与该好友的历史消息将无法解密，且无法恢复。
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                    variant="destructive"
                                    onClick={handleClearKeys}
                                >
                                    确认清空
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        私钥只保存在本浏览器，平台永不接触。一旦丢失将无法解密与该好友的历史消息，
                        请定期导出备份并妥善保管（备份文件含私钥，切勿分享给他人）。
                    </p>
                </div>

                {/* 保险箱密码 */}
                <div className="mt-6 flex flex-col gap-1">
                    <div className="flex items-center gap-2 pb-1">
                        <KeyRound className="size-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">保险箱密码</span>
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            vaultStatus === 'unlocked' || !hasPassword
                                ? 'bg-primary/10 text-primary'
                                : 'bg-muted text-muted-foreground'
                        }`}>
                            {vaultStatus === 'unlocked' || !hasPassword ? '已解锁' : '已锁定'}
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={() => setChangePwOpen(true)}
                        disabled={vaultStatus !== 'unlocked'}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:border-ring outline-none disabled:opacity-50 disabled:pointer-events-none"
                    >
                        <KeyRound data-icon="inline-start" className="size-5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">修改保险箱密码</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <div className="h-px bg-border/60" />

                    <button
                        type="button"
                        onClick={handleLockVault}
                        disabled={vaultStatus !== 'unlocked'}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:border-ring outline-none disabled:opacity-50 disabled:pointer-events-none"
                    >
                        <ShieldCheck data-icon="inline-start" className="size-5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">锁定保险箱</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {hasPassword
                            ? '保险箱密码用于在本浏览器内加密私钥。锁定或刷新页面后需重新输入密码才能使用密钥。密码不会上传到服务器，遗忘后无法恢复。'
                            : '当前未设置保险箱密码：私钥仅在本浏览器内加密保存，刷新后无需再输密码，但换浏览器/设备将无法解密。建议设置密码以便跨设备迁移。'}
                    </p>
                    </div>

                    {/* 修改密码对话框 */}
                    <AlertDialog open={changePwOpen} onOpenChange={setChangePwOpen}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>修改保险箱密码</AlertDialogTitle>
                                <AlertDialogDescription>
                                    请输入当前密码和新密码。新密码将重新加密所有私钥。
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="flex flex-col gap-3 py-2">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="vault-old-pw">当前密码</Label>
                                    <Input
                                        id="vault-old-pw"
                                        type="password"
                                        value={oldPw}
                                        onChange={e => setOldPw(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="vault-new-pw">新密码（至少 8 位）</Label>
                                    <Input
                                        id="vault-new-pw"
                                        type="password"
                                        value={newPw}
                                        onChange={e => setNewPw(e.target.value)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="vault-confirm-pw">确认新密码</Label>
                                    <Input
                                        id="vault-confirm-pw"
                                        type="password"
                                        value={confirmPw}
                                        onChange={e => setConfirmPw(e.target.value)}
                                    />
                                </div>
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <Button onClick={handleChangePw} disabled={pwBusy}>
                                    {pwBusy && <Loader2 data-icon="inline-start" className="animate-spin" />}
                                    {pwBusy ? '加密中…' : '确认修改'}
                                </Button>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    </>
                )}

                {/* 底部 */}
                <div className="mt-6 flex items-center justify-center gap-2 text-muted-foreground">
                    <Hash className="size-3.5" />
                    <span className="text-xs">{user.userId}</span>
                </div>

                <div className="mt-4 flex justify-center">
                    <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                        <Link to="/functional">
                            <ChevronRight className="size-4 rotate-180" />
                            返回
                        </Link>
                    </Button>
                </div>
            </div>

            <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                ref={importFileRef}
                onChange={handleImportFile}
            />
        </PageShell>
    );
}

export default UserInfoPage;
