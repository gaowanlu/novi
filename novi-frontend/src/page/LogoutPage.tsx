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
    // 全部放 effect（含 toast）：渲染期跑副作用会在 StrictMode 双挂载下重复触发
    useEffect(() => {
        lock();
        void serverLogout();
        toast.success("已退出登录");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
