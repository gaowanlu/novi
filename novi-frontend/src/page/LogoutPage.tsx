import { useNavigate, Link } from "react-router-dom";
import { useAuth, useSessionUser } from "@/context/AuthContext";
import { toast } from "sonner";
import { LogOut } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";

// 保留 /logout 路由以兼容旧链接：直接执行退出并回到登录页
export default function LogoutPage() {
    const { logout } = useAuth();
    const user = useSessionUser();
    const navigate = useNavigate();

    // 进入该页即退出登录
    logout();
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
                        {user.userName} 已安全登出，会话已结束。
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
