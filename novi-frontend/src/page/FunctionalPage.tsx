import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import NavRail from "@/components/NavRail";
import FriendPanel from "@/components/FriendPanel";
import MessagePanel from "@/components/MessagePanel";
// import { Button } from "@/components/ui/button";
import { apiFetch, parseJson, errorText } from "@/api/request";
import { APIMacro } from "@/api/APIMacro";
import { useAuth } from "@/context/AuthContext";
import type { FriendMessageItem, FriendRequestItem, UnreadSummary, SelectedFriend } from "@/api/types";
import { toast } from "sonner";
import { useNoviSocketEvent, type NoviSocketPayload } from "@/ws/noviSocket";
import { removeFriendKeys, getTuple } from "@/crypto/keyStore";
import { completeTupleFromRequestItem } from "@/crypto/friendKeys";
import { decryptMessage } from "@/crypto/crypto";
import { isVaultUnlocked } from "@/crypto/vault";

function FunctionalPage() {
    const [friendList, setFriendList] = useState<FriendRequestItem[]>([]);
    const [friendLoading, setFriendLoading] = useState(true);
    const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
    const [lastMessageMap, setLastMessageMap] = useState<Record<string, { content: string; sentAt: string }>>({});
    const [currentFriend, setCurrentFriend] = useState<SelectedFriend | null>(null);

    const { user } = useAuth();
    const myUserId = user?.userId ?? "";

    // MessagePanel 注册的回调：WS 推送时据此实时更新打开的会话
    const appendMessageRef = useRef<((m: FriendMessageItem) => void) | null>(null);
    const markReadedRef = useRef<((ids: string[]) => void) | null>(null);
    // 已追加到打开会话的消息ID，防止同一条消息被重复推送（发送者/接收者两端都会收到）
    const seenMessageIdsRef = useRef<Set<string>>(new Set());
    // 当前会话ID（ref 版，供 WS 回调读取最新值，避免闭包过期）
    const currentFriendIdRef = useRef<string | null>(null);
    currentFriendIdRef.current = currentFriend?.userId ?? null;

    const refreshFriendList = useCallback(async () => {
        setFriendLoading(true);
        try {
            const res = await apiFetch(APIMacro.GETFRIEND, { method: "GET" });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const list = (data as FriendRequestItem[]) ?? [];
            setFriendList(list);
            // 离线补齐：我离线期间对方接受了申请（错过 WS 推送），用列表里的公钥补齐 5 元组，
            // 进入聊天即可加密（幂等；好友关系完整时绝不触碰已推进的链头）
            for (const item of list) await completeTupleFromRequestItem(myUserId, item);
            // 默认选中第一个好友
            setCurrentFriend(prev => {
                if (prev) return prev;
                if (list.length > 0) {
                    const first = list[0];
                    const party = myUserId === first.receiver.userId ? first.requester : first.receiver;
                    return { userId: party.userId ?? "", userName: party.userName, novicode: first.novicode ?? null };
                }
                return null;
            });
        } catch (err: unknown) {
            toast.error(err instanceof Error ? (err.message || "加载好友列表失败") : "加载好友列表失败");
        } finally {
            setFriendLoading(false);
        }
    }, [myUserId]);

    // 列表预览用的轻量解密：content 是 AES-GCM 密文（E2E，服务器只存不解密），
    // 直接渲染就是一串乱码。这里只解出明文做摘要（验签/链校验由 MessagePanel 负责）；
    // 解不出（vault 未解锁 / 5 元组缺失 / 密钥不匹配）回退「加密消息」占位，绝不显示密文。
    const previewDecrypt = useCallback(async (
        senderId: string,
        nc: string,
        m: { content: string; iv: string; wrappedKey: string; sig: string }
    ): Promise<string> => {
        const FALLBACK = "加密消息";
        if (!isVaultUnlocked(myUserId)) return FALLBACK;
        const tuple = getTuple(myUserId, senderId, nc);
        if (!tuple?.ownPrivateKey?.n) return FALLBACK;
        // 对方发来：用【自己】私钥解包对方包装的 wrappedKey，验签用对方公钥；
        // 自己发来（汇总含自己发的）：用【自己】私钥解包自己的 wrappedKeySelf，验签用自己公钥。
        const isMine = senderId === myUserId;
        const pub = isMine ? tuple.ownPublicKey : tuple.friendPublicKey;
        if (!pub?.n) return FALLBACK;
        try {
            const r = await decryptMessage({
                content: m.content,
                iv: m.iv,
                wrappedKey: m.wrappedKey,
                sig: m.sig,
                preHash: "",
                ownPrivJwk: tuple.ownPrivateKey,
                senderPubKeyJwk: pub,
                expectedPreHash: "",
                skipPreCheck: true,
            });
            return r.status === "ok" && r.text ? r.text : FALLBACK;
        } catch {
            return FALLBACK;
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
                if (!item.content || !item.sentAt) continue;
                const nc = item.noviCode || "1";
                // 对方发来取 wrappedKey；自己发来（汇总含自己发的）取 wrappedKeySelf
                const isMine = item.sender === myUserId;
                const wrappedKey = isMine ? (item.wrappedKeySelf ?? "") : (item.wrappedKey ?? "");
                const preview = await previewDecrypt(item.sender, nc, {
                    content: item.content,
                    iv: item.iv ?? "",
                    wrappedKey,
                    sig: item.sig ?? "",
                });
                last[item.sender] = { content: preview, sentAt: item.sentAt };
            }
            setUnreadMap(counts);
            setLastMessageMap(prev => ({ ...prev, ...last }));
        } catch {
            // 未读汇总失败不影响主流程，静默等待下次轮询
        }
    }, [myUserId, previewDecrypt]);

    useEffect(() => {
        refreshFriendList();
        refreshUnread();
        return () => { appendMessageRef.current = null; markReadedRef.current = null; };
    }, [refreshFriendList, refreshUnread]);

    // 收到新消息：更新好友列表排序/摘要/未读徽章；若属于当前打开的会话则直接追加气泡
    useNoviSocketEvent("novi_friend_message_comming", (payload) => {
        const m = payload as unknown as FriendMessageItem;
        if (!m?._id) return;

        // 刷新好友列表（新好友关系/排序）与未读徽章
        refreshFriendList();
        refreshUnread();

        // 好友列表的摘要预览：content 是密文，必须先解密否则列表里是一串乱码。
        // 与上面的 refreshUnread 同样走本地解密；解不出显示「加密消息」。
        // 注：refreshUnread 是独立请求、不感知这条 WS 消息，故此处单独更新预览。
        const peerId = m.sender === myUserId ? m.receiver : m.sender;
        void previewDecrypt(peerId, m.noviCode || "1", {
            content: m.content,
            iv: m.iv ?? "",
            wrappedKey: m.sender === myUserId ? (m.wrappedKeySelf ?? "") : (m.wrappedKey ?? ""),
            sig: m.sig ?? "",
        }).then(preview => {
            setLastMessageMap(prev => ({
                ...prev,
                [peerId]: { content: preview, sentAt: m.sentAt ?? prev[peerId]?.sentAt ?? "" }
            }));
        });

        // 属于当前打开的会话 → 追加到气泡列表（去重：自己发出时本地乐观更新已加过）
        if (peerId === currentFriendIdRef.current && !seenMessageIdsRef.current.has(m._id)) {
            seenMessageIdsRef.current.add(m._id);
            appendMessageRef.current?.(m);
            // 对方新消息：由 MessagePanel 解密校验后，解密成功才标已读（已读依赖解密成功）
        }
    });

    // 消息被标为已读：更新打开会话中对应气泡的已读状态（双勾）
    // 后端推送的 payload 是消息对象数组（见 message.ts markreaded），可能为单个对象
    useNoviSocketEvent("novi_friend_message_readed", (payload) => {
        const raw = Array.isArray(payload) ? payload : [payload] as unknown as NoviSocketPayload[];
        const ids: string[] = raw
            .map((p) => (typeof p._id === "string" ? p._id : ""))
            .filter((id): id is string => id.length > 0);
        if (ids.length === 0) return;
        markReadedRef.current?.(ids);
    });

    // 消息解密确认：对方已解密确认 → 刷新好友列表（可选展示「对方已解密」）
    useNoviSocketEvent("novi_friend_message_crypto_ack", () => {
        refreshFriendList();
    });

    // 好友被删除：清理本地与该好友的密钥 5 元组与链头（尽量无痕）
    // 注意：WS 推送里 requester/receiver 是原始 ObjectId 字符串
    useNoviSocketEvent("novi_friend_friend_deleted", (payload) => {
        const p = payload as { requester?: string | null; receiver?: string | null };
        const other = p?.requester === myUserId ? p.receiver : p.requester;
        if (other) {
            void removeFriendKeys(myUserId, other);
            // 被删好友正是当前打开的会话 → 清空选择（重新添加是新代次，需重新进入加载）
            if (other === currentFriendIdRef.current) setCurrentFriend(null);
        }
    });

    const handleSelectFriend = (friend: SelectedFriend) => {
        setCurrentFriend(friend);
        // 进入会话后由 MessagePanel 拉取并标记已读，随后刷新徽章
        refreshUnread();
    };

    // 供 MessagePanel 注册的回调：向当前会话追加新消息 / 标记已读
    const registerMessagePanel = useCallback((
        append: ((m: FriendMessageItem) => void) | null,
        markReaded: ((ids: string[]) => void) | null
    ) => {
        appendMessageRef.current = append;
        markReadedRef.current = markReaded;
        // 切换会话时重置去重集合
        seenMessageIdsRef.current = new Set();
    }, []);

    return (
        <div className="flex h-dvh w-full overflow-hidden bg-wa-panel">
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
                <MessagePanel friend={currentFriend} user={user} registerPanel={registerMessagePanel} />
            </div>
        </div>
    );
}

export default FunctionalPage;
