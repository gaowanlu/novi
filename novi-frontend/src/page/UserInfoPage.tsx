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
    ChevronRight,
    Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth, useSessionUser } from '../context/AuthContext';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    const user = useSessionUser();

    const handleImportKeys = () => importFileRef.current?.click();

    const handleClearKeys = () => {
        clearKeys(user.userId);
        setClearOpen(false);
        toast.success('本地密钥已清空', { description: '与该好友的历史消息将无法解密' });
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
            importKeysBackup(bundle);
            toast.success('密钥已导入', { description: '历史消息现在可重新解密' });
        } catch (err: any) {
            toast.error('导入失败', { description: err?.message || '文件格式不正确' });
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

            const data = await res.json();

            if (res.ok) {
                toast.success('修改成功', { description: '你的资料已更新' });
                updateEmailAndUserName(data.email, data.userName);
            } else {
                toast.error('修改失败', { description: data.message });
            }
        } catch (err: any) {
            toast.error('网络错误', { description: err?.message });
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

                {/* 端到端加密密钥 */}
                <div className="mt-6 flex flex-col gap-1">
                    <div className="flex items-center gap-2 pb-1">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">端到端加密密钥</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => { downloadKeysBackup(user.userId); toast.success('密钥已导出'); }}
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
