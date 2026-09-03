import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Plus, Info, LogOut, Home as HomeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import FriendPanel from "@/components/FriendPannel";
import MessagePanel from "@/components/MessagePannel";
import { Button } from "@/components/ui/button";
import { apiFetch, parseJson, errorText } from "@/api/request";
import { APIMacro } from "@/api/APIMacro";
import { useAuth } from "@/context/AuthContext";
import type { FriendRequestItem, UnreadSummary } from "@/api/types";
import { toast } from "sonner";

interface SelectedFriend {
    userId: string;
    userName: string;
}

// 无 WebSocket 阶段：轮询未读汇总，新消息到达时刷新徽章（打开的会话内部自己拉取）
const UNREAD_POLL_MS = 15000;

/** 桌面端左侧窄导航栏：品牌 + 页面入口 + 用户操作 */
function NavRail() {
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

function FunctionalPage() {
    const [friendList, setFriendList] = useState<FriendRequestItem[]>([]);
    const [friendLoading, setFriendLoading] = useState(true);
    const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
    const [lastMessageMap, setLastMessageMap] = useState<Record<string, { content: string; sentAt: string }>>({});
    const [currentFriend, setCurrentFriend] = useState<SelectedFriend | null>(null);

    const { user } = useAuth();
    const myUserId = user?.userId ?? "";

    const refreshFriendList = useCallback(async () => {
        setFriendLoading(true);
        try {
            const res = await apiFetch(APIMacro.GETFRIEND, { method: "GET" });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const list = (data as FriendRequestItem[]) ?? [];
            setFriendList(list);
            // 默认选中第一个好友
            setCurrentFriend(prev => {
                if (prev) return prev;
                if (list.length > 0) {
                    const first = list[0];
                    const party = myUserId === first.receiver.userId ? first.requester : first.receiver;
                    return { userId: party.userId ?? "", userName: party.userName };
                }
                return null;
            });
        } catch (err: any) {
            toast.error(err.message || "加载好友列表失败");
        } finally {
            setFriendLoading(false);
        }
    }, [myUserId]);

    const refreshUnread = useCallback(async () => {
        try {
            const res = await apiFetch(APIMacro.GETMESSAGE_ALLFRIEND, { method: "GET" });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const list = (data as UnreadSummary[]) ?? [];
            const counts: Record<string, number> = {};
            const last: Record<string, { content: string; sentAt: string }> = {};
            for (const item of list) {
                if (!item.sender) continue;
                counts[item.sender] = item.unreadCount ?? 0;
                if (item.content && item.sentAt) {
                    last[item.sender] = { content: item.content, sentAt: item.sentAt };
                }
            }
            setUnreadMap(counts);
            setLastMessageMap(prev => ({ ...prev, ...last }));
        } catch {
            // 未读汇总失败不影响主流程，静默等待下次轮询
        }
    }, []);

    useEffect(() => {
        refreshFriendList();
        refreshUnread();
        const timer = window.setInterval(refreshUnread, UNREAD_POLL_MS);
        return () => window.clearInterval(timer);
    }, [refreshFriendList, refreshUnread]);

    const handleSelectFriend = (friend: SelectedFriend) => {
        setCurrentFriend(friend);
        // 进入会话后由 MessagePanel 拉取并标记已读，随后刷新徽章
        refreshUnread();
    };

    return (
        <div className="flex h-dvh w-full overflow-hidden bg-background">
            {/* 桌面端窄导航 */}
            <NavRail />

            {/* 会话列表：移动端隐藏，选中好友后隐藏 */}
            <div className={cn(
                "w-full shrink-0 md:w-80 lg:w-96",
                currentFriend ? "hidden md:block" : "block"
            )}>
                <FriendPanel
                    friendList={friendList}
                    user={user}
                    currentFriendId={currentFriend?.userId}
                    onSelectFriend={handleSelectFriend}
                    unreadCounts={unreadMap}
                    lastMessageMap={lastMessageMap}
                    loading={friendLoading}
                />
            </div>

            {/* 聊天区 */}
            <div className={cn("min-w-0 flex-1", currentFriend ? "block" : "hidden md:block")}>
                <MessagePanel friend={currentFriend} user={user} />
            </div>
        </div>
    );
}

export default FunctionalPage;
