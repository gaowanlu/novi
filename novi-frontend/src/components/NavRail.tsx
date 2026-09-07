import { Link } from "react-router-dom";
import { MessageCircle, Plus, Info, LogOut, Home as HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

/** 桌面端左侧窄导航栏：品牌 + 页面入口 + 用户操作 */
export default function NavRail() {
    const { user } = useAuth();
    return (
        <nav className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r bg-card py-3 lg:flex">
            <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <MessageCircle className="size-5" data-icon="inline-start" />
            </div>
            <Button variant="ghost" size="icon" asChild aria-label="新朋友">
                <Link to="/new/friend"><Plus /></Link></Button>
            <Button variant="ghost" size="icon" asChild aria-label="个人信息">
                <Link to="/user/info"><Info /></Link></Button>
            <Button variant="ghost" size="icon" asChild aria-label="首页">
                <Link to="/"><HomeIcon /></Link></Button>
            <div className="mt-auto flex flex-col items-center gap-2">
                <Button variant="ghost" size="icon" asChild aria-label="退出登录">
                    <Link to="/logout"><LogOut /></Link></Button>
                {user && (
                    <span
                        title={`${user.userName} · ${user.userId}`}
                        className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                    >
                        {user.userName?.trim()?.slice(0, 2) || "?"}
                    </span>
                )}
            </div>
        </nav>
    );
}
