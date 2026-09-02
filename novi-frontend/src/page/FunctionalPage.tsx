import { useCallback, useEffect, useState } from "react";
import FriendPanel from "@/components/FriendPannel";
import MessagePanel from "@/components/MessagePannel";
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

function FunctionalPage() {
    const [friendList, setFriendList] = useState<FriendRequestItem[]>([]);
    const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
    const [currentFriend, setCurrentFriend] = useState<SelectedFriend | null>(null);

    const { user } = useAuth();
    const myUserId = user?.userId ?? "";

    const refreshFriendList = useCallback(async () => {
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
                    return { userId: party.userId ?? '', userName: party.userName };
                }
                return null;
            });
        } catch (err: any) {
            toast.error(err.message || "加载好友列表失败");
        }
    }, [myUserId]);

    const refreshUnread = useCallback(async () => {
        try {
            const res = await apiFetch(APIMacro.GETMESSAGE_ALLFRIEND, { method: "GET" });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const list = (data as UnreadSummary[]) ?? [];
            const map: Record<string, number> = {};
            for (const item of list) {
                if (item.sender) map[item.sender] = item.unreadCount;
            }
            setUnreadMap(map);
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
        <div className="w-screen h-screen grid grid-cols-[280px_1fr] bg-gray-100">
            <FriendPanel
                friendList={friendList}
                user={user}
                currentFriendId={currentFriend?.userId}
                onSelectFriend={handleSelectFriend}
                unreadCounts={unreadMap}
            />

            <MessagePanel
                friend={currentFriend}
                user={user}
            />
        </div>
    );
}

export default FunctionalPage;
