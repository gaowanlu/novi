import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 统一页面外壳：品牌头 + 居中卡片内容。
 * 用于登录/注册/个人信息等单卡片页面。
 */
export function PageShell({
    children,
    className,
    width = "max-w-md"
}: {
    children: ReactNode;
    className?: string;
    width?: string;
}) {
    return (
        <div className={cn("flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted/30 p-6", className)}>
            <Link to="/" className="flex flex-col items-center gap-2" aria-label="返回 novi 首页">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                    <MessageCircle className="size-6" data-icon="inline-start" />
                </div>
                <div className="flex flex-col items-center leading-tight">
                    <span className="text-base font-semibold tracking-tight">novi</span>
                    <span className="text-xs text-muted-foreground">
                        Each friendship, a unique encryption pair.
                    </span>
                </div>
            </Link>
            <Card className={cn("w-full gap-0 py-0", width)}>
                <CardContent className="p-6">{children}</CardContent>
            </Card>
        </div>
    );
}
