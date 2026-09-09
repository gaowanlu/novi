import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { toast } from "sonner";
import { LogOut } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";

// 保留 /logout 路由以兼容旧链接：直接执行退出并回到登录页
export default function LogoutPage() {
    const { user, serverLogout } = useAuth();
    const { lock } = useVault();
    const navigate = useNavigate();

    // 进入该页即退出登录：调用服务端撤销会话 + 锁定保险箱（清除内存私钥）
    // useEffect 避免渲染期副作用；serverLogout 内部 best-effort，失败不阻塞跳转
    useEffect(() => {
        lock();
        void serverLogout();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    toast.success("已退出登录");

    return (
        <PageShell>
            <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <LogOut className="size-6" data-icon="inline-start" />
                </div>
                <div className="flex flex-col gap-1">
                    <h1 className="text-lg font-semibold tracking-tight">已退出登录</h1>
                    <p className="text-sm text-muted-foreground">
                        {user ? `${user.userName} 已安全登出，会话已结束。` : "会话已结束。"}
                    </p>
                </div>
                <div className="flex w-full items-center justify-center gap-3 pt-2">
                    <Button asChild variant="ghost">
                        <Link to="/">返回首页</Link>
                    </Button>
                    <Button onClick={() => navigate("/signin")}>前往登录</Button>
                </div>
            </div>
        </PageShell>
    );
}
