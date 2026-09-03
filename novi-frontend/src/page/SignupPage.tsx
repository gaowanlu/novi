import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { APIMacro } from "../api/APIMacro";
import { apiFetch } from "../api/request";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export default function SignupPage() {
    const [userName, setUserName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [processing, setProcessing] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setProcessing(true);

        try {
            const res = await apiFetch(APIMacro.SIGNUP, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userName, email, password }),
            });

            const data = await res.json();

            if (res.ok) {
                toast.success("注册成功", { description: "请登录你的新账号" });
                navigate("/signin");
            } else {
                toast.error("注册失败", { description: data.message });
            }
        } catch (err: any) {
            toast.error("网络错误", { description: err?.message });
        } finally {
            setProcessing(false);
        }
    };

    return (
        <PageShell>
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                    <h1 className="text-lg font-semibold tracking-tight">创建账号</h1>
                    <p className="text-sm text-muted-foreground">
                        每段友谊都拥有独立的加密密钥对，平台永远无法读取。
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="userName">用户名</Label>
                        <Input
                            id="userName"
                            type="text"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            placeholder="你的昵称"
                            autoComplete="nickname"
                            required
                        />
                    </div>

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
                        <Label htmlFor="password">密码</Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="至少 6 位"
                            autoComplete="new-password"
                            minLength={6}
                            required
                        />
                    </div>

                    <Button
                        type="submit"
                        className="mt-1 w-full"
                        disabled={processing}
                    >
                        {processing && <Loader2 data-icon="inline-start" className="animate-spin" />}
                        {processing ? "注册中…" : "注册"}
                    </Button>
                </form>

                <Separator />

                <p className="text-center text-sm text-muted-foreground">
                    已有账号？{' '}
                    <Link
                        to="/signin"
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                        直接登录
                    </Link>
                </p>
            </div>
        </PageShell>
    );
}
