import { useNavigate } from "react-router-dom";
import { useAuth, useSessionUser } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

// 保留 /logout 路由以兼容旧链接：直接执行退出并回到登录页
export default function LogoutPage() {
    const { logout } = useAuth();
    const user = useSessionUser();
    const navigate = useNavigate();

    // 进入该页即退出登录
    logout();
    toast.success("已退出登录");

    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-50">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-center">已退出登录</CardTitle>
                    <CardDescription className="text-center">
                        {user.userName} 已安全登出
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <Button onClick={() => navigate("/signin")}>前往登录</Button>
                </CardContent>
            </Card>
        </div>
    );
}
