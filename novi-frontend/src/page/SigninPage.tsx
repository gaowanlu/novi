import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { APIMacro } from '../api/APIMacro';
import { apiFetch, parseJson, errorText } from '../api/request';
import type { LoginResult, ApiError } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

function SigninPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [processing, setProcessing] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    // 被路由守卫拦截时的原目标地址，登录成功后回跳
    const from = (location.state as { from?: string } | null)?.from;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setProcessing(true);

        try {
            const res = await apiFetch(APIMacro.LOGIN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const raw = await parseJson(res);

            if (res.ok) {
                const data = raw as LoginResult;
                login(data.jwtToken, { userId: data.userId, userName: data.userName, email: data.email });
                navigate(from || '/functional');
            } else {
                toast.error('登录失败', { description: errorText(res, raw as ApiError | null) });
            }
        } catch (err: unknown) {
            toast.error('网络错误', { description: err instanceof Error ? err.message : undefined });
        } finally {
            setProcessing(false);
        }
    };

    return (
        <PageShell>
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                    <h1 className="text-lg font-semibold tracking-tight">登录</h1>
                    <p className="text-sm text-muted-foreground">
                        欢迎回来，你的消息始终处于加密状态。
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="email">邮箱</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="account@example.com"
                            autoComplete="email"
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="password">密码</Label>
                            <button
                                type="button"
                                className="cursor-not-allowed text-xs text-muted-foreground/60 underline-offset-4"
                                title="请登录后前往个人信息中修改密码"
                                onClick={() => toast.info('请登录后前往个人信息中修改密码')}
                            >
                                忘记密码？
                            </button>
                        </div>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            minLength={8}
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    <Button
                        type="submit"
                        className="mt-1 w-full"
                        disabled={processing}
                    >
                        {processing && <Loader2 data-icon="inline-start" className="animate-spin" />}
                        {processing ? '登录中…' : '登录'}
                    </Button>
                </form>

                <Separator className="mx-0" />

                <p className="text-center text-sm text-muted-foreground">
                    还没有账号？{' '}
                    <Link
                        to="/signup"
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                        立即注册
                    </Link>
                </p>
            </div>
        </PageShell>
    );
}

export default SigninPage;
