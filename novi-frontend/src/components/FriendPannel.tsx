import { useId } from "react";
import { Search, MessageCircle, Users, Plus, LogOut, Info, Home as HomeIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { FriendRequestItem } from "@/api/types";

interface SelectedFriend {
    userId: string;
    userName: string;
}

interface FriendPanelProps {
    friendList: FriendRequestItem[];
    user: { userId: string; userName: string } | null;
    currentFriendId?: string | null;
    onSelectFriend?: (friend: SelectedFriend) => void;
    /** 每个好友的未读消息数，key 为好友 userId */
    unreadCounts?: Record<string, number>;
    /** 每个好友最后一条消息摘要，key 为好友 userId */
    lastMessageMap?: Record<string, { content: string; sentAt: string }>;
    loading?: boolean;
    className?: string;
}

const formatLastSeen = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
        return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "昨天";
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
};

const initialsOf = (name: string) => name?.trim()?.slice(0, 2) || "?";

export default function FriendPanel({
    friendList,
    user,
    currentFriendId,
    onSelectFriend,
    unreadCounts = {},
    lastMessageMap = {},
    loading = false,
    className
}: FriendPanelProps) {
    const myUserId = user?.userId ?? "";
    const listboxId = useId();

    const rows = friendList
        .map(item => {
            const friend = myUserId === item.receiver.userId ? item.requester : item.receiver;
            return { item, friend };
        })
        .filter(({ friend }) => Boolean(friend.userId))
        // 按最后消息时间倒序；无消息的按加入时间倒序
        .sort((a, b) => {
            const ta = lastMessageMap[a.friend.userId!]?.sentAt ?? a.item.createdAt;
            const tb = lastMessageMap[b.friend.userId!]?.sentAt ?? b.item.createdAt;
            return new Date(tb).getTime() - new Date(ta).getTime();
        });

    return (
        <aside className={cn("flex h-full min-h-0 flex-col border-r bg-card", className)}>
            {/* 头部：品牌 + 搜索 */}
            <div className="flex flex-col gap-3 p-4 pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <MessageCircle className="size-4.5" data-icon="inline-start" />
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-sm font-semibold tracking-tight">novi</span>
                            <span className="text-[11px] text-muted-foreground">加密聊天</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" asChild aria-label="个人信息">
                            <Link to="/user/info"><Info /></Link></Button>
                        <Button variant="ghost" size="icon" asChild aria-label="退出登录">
                            <Link to="/logout"><LogOut /></Link></Button>
                        <Button variant="ghost" size="icon" asChild aria-label="新朋友" className="text-primary-foreground">
                            <Link to="/new/friend"><Plus /></Link></Button>
                    </div>
                </div>

                <div className="relative">
                    <Search
                        data-icon="inline-start"
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        aria-label="搜索好友"
                        placeholder="搜索或开始新聊天"
                        className="h-9 rounded-full bg-muted pl-9 text-sm"
                    />
                </div>
            </div>

            {/* 列表 */}
            <ScrollArea className="min-h-0 flex-1">
                <ul
                    id={listboxId}
                    role="listbox"
                    aria-label="好友列表"
                    className="flex flex-col px-2 pb-2"
                >
                    {loading && friendList.length === 0 && (
                        <>
                            {[...Array(5)].map((_, i) => (
                                <li key={i}>
                                    <div className="flex items-center gap-3 rounded-lg p-3">
                                        <Skeleton className="size-10 rounded-full" />
                                        <div className="flex-1 space-y-2">
                                            <Skeleton className="h-4 w-2/3" />
                                            <Skeleton className="h-3 w-1/2" />
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </>
                    )}

                    {!loading && rows.length === 0 && (
                        <li className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <Users />
                            </div>
                            <p className="text-sm font-medium">还没有好友</p>
                            <p className="text-xs text-muted-foreground">
                                去「新朋友」页面添加吧
                            </p>
                            <Button size="sm" asChild className="mt-2">
                                <Link to="/new/friend">添加好友</Link>
                            </Button>
                        </li>
                    )}

                    {rows.map(({ item, friend }) => {
                        const unread = unreadCounts[friend.userId!] ?? 0;
                        const last = lastMessageMap[friend.userId!];
                        const active = currentFriendId === friend.userId;
                        return (
                            <li key={item.friendRequestId} role="option" aria-selected={active}>
                                <button
                                    type="button"
                                    onClick={() => onSelectFriend?.({ userId: friend.userId!, userName: friend.userName })}
                                    className={cn(
                                        "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                                        active
                                            ? "bg-accent"
                                            : "hover:bg-accent/60 data-[highlighted]:bg-accent/60"
                                    )}
                                >
                                    <Avatar className="size-11 shrink-0">
                                        <AvatarFallback className="bg-secondary text-sm font-medium text-secondary-foreground">
                                            {initialsOf(friend.userName)}
                                        </AvatarFallback>
                                    </Avatar>

                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className={cn(
                                                "truncate text-sm",
                                                active ? "font-semibold" : "font-medium"
                                            )}>
                                                {friend.userName}
                                            </span>
                                            <span className={cn(
                                                "shrink-0 text-[11px] tabular-nums",
                                                unread > 0 ? "font-semibold text-primary" : "text-muted-foreground"
                                            )}>
                                                {formatLastSeen(last?.sentAt ?? item.createdAt)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={cn(
                                                "flex min-w-0 items-center gap-1 truncate text-xs",
                                                unread > 0 ? "font-medium text-foreground" : "text-muted-foreground"
                                            )}>
                                                {unread > 0 && (
                                                    <MessageCircle className="size-3.5 shrink-0 text-primary" data-icon="inline-start" />
                                                )}
                                                <span className="truncate">
                                                    {last?.content?.trim() || "还没有消息，打个招呼吧"}
                                                </span>
                                            </span>
                                            {unread > 0 && (
                                                <Badge
                                                    variant="secondary"
                                                    className="h-5 min-w-5 shrink-0 gap-0 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary"
                                                >
                                                    {unread > 99 ? "99+" : unread}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </ScrollArea>

            {/* 底部：当前用户 */}
            {user && (
                <>
                    <Separator />
                    <div className="flex items-center gap-3 p-3">
                        <Avatar className="size-9 shrink-0">
                            <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                                {initialsOf(user.userName)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="truncate text-sm font-medium">{user.userName}</span>
                            <span className="truncate text-[11px] text-muted-foreground">
                                {user.userId}
                            </span>
                        </div>
                        <Button variant="ghost" size="icon" asChild aria-label="首页">
                            <Link to="/"><HomeIcon /></Link></Button>
                    </div>
                </>
            )}
        </aside>
    );
}
