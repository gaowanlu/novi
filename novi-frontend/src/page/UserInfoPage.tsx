import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, AtSign, Mail, User as UserIcon, Download, Upload, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth, useSessionUser } from '../context/AuthContext';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { downloadKeysBackup, importKeysBackup, parseKeysBackup } from '@/crypto/keyStore';

function UserInfoPage() {
    const [loading, setLoading] = useState(false);
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const importFileRef = useRef<HTMLInputElement>(null);

    const { updateEmailAndUserName } = useAuth();
    const user = useSessionUser();

    const handleImportKeys = () => importFileRef.current?.click();

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

    return (
        <PageShell>
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                    <h1 className="text-lg font-semibold tracking-tight">个人信息</h1>
                    <p className="text-sm text-muted-foreground">更新你的用户名和邮箱。</p>
                </div>

                {/* 当前资料摘要 */}
                <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
                    <Avatar className="size-11 shrink-0">
                        <AvatarFallback className="bg-primary text-sm font-medium text-primary-foreground">
                            {user.userName?.trim()?.slice(0, 2) || '?'}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                        <span className="flex items-center gap-1.5 font-medium">
                            <UserIcon data-icon="inline-start" className="size-3.5 text-muted-foreground" />
                            <span className="truncate">{user.userName}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail data-icon="inline-start" className="size-3.5" />
                            <span className="truncate">{user.email}</span>
                        </span>
                    </div>
                    <Badge variant="secondary" className="shrink-0 gap-1 rounded-full px-2 py-0.5 text-[11px]">
                        <AtSign data-icon="inline-start" className="size-3" />
                        {user.userId}
                    </Badge>
                </div>

                <Separator />

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="newUserName">新用户名</Label>
                        <Input
                            id="newUserName"
                            type="text"
                            placeholder="输入新的用户名"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="newEmail">新邮箱</Label>
                        <Input
                            id="newEmail"
                            type="email"
                            placeholder="输入新的邮箱"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="mt-1 flex items-center gap-2">
                        <Button type="submit" className="flex-1" disabled={loading}>
                            {loading && <Loader2 data-icon="inline-start" className="animate-spin" />}
                            {loading ? '保存中…' : '保存修改'}
                        </Button>
                        <Button asChild variant="ghost" onClick={() => window.history.back()}>
                            <Link to="/functional">取消</Link>
                        </Button>
                    </div>
                </form>

                <Separator />

                {/* 端到端密钥备份（用户自管，平台不持有） */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        <h2 className="text-sm font-semibold">端到端加密密钥</h2>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        你的私钥只保存在本浏览器，平台永不接触。一旦丢失将无法解密与该好友的历史消息，
                        请定期导出备份并妥善保管（备份文件含私钥，切勿分享给他人）。
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => { downloadKeysBackup(user.userId); toast.success('密钥已导出'); }}
                        >
                            <Download data-icon="inline-start" className="size-4" />
                            导出密钥备份
                        </Button>
                        <Button variant="outline" className="gap-1.5" onClick={handleImportKeys}>
                            <Upload data-icon="inline-start" className="size-4" />
                            导入密钥备份
                        </Button>
                    </div>
                    <input
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        ref={importFileRef}
                        onChange={handleImportFile}
                    />
                </div>
            </div>
        </PageShell>
    );
}

export default UserInfoPage;
