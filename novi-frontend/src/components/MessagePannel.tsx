import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, parseJson, errorText } from "@/api/request";
import { APIMacro } from "@/api/APIMacro";
import type { FriendMessageItem } from "@/api/types";

interface UserInfo {
    userId: string;
    userName: string;
}

const NOVI_CODE = "1"; // 明文阶段固定 novicode，E2E 落地后按密钥版本管理
const PAGE_SIZE = 30;

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

const formatDay = (iso: string) =>
    new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });

export default function MessagePanel({ friend, user }: { friend: UserInfo | null; user?: { userId: string } | null }) {
    const myUserId = user?.userId ?? "";

    const [messages, setMessages] = useState<FriendMessageItem[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState("");

    const bottomRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const pendingMarkRead = useRef<string[]>([]);
    const flushTimer = useRef<number | null>(null);

    // 会话切换或好友变化时：拉取会话（未读优先，无未读取最新10条）
    useEffect(() => {
        if (!friend) return;
        let cancelled = false;

        const loadConversation = async () => {
            setLoading(true);
            setError("");
            setHasMore(false);
            pendingMarkRead.current = [];
            try {
                const res = await apiFetch(
                    `${APIMacro.GETMESSAGE_PULL}?sender=${friend.userId}`,
                    { method: "GET" }
                );
                const data = await parseJson(res);
                if (!res.ok) throw new Error(errorText(res, data));
                if (cancelled) return;
                const list = (data as FriendMessageItem[]) ?? [];
                setMessages(list);
                setHasMore(list.length >= PAGE_SIZE);
                // 进入会话即视为已读
                const unreadIds = list
                    .filter(m => m.sender === friend.userId && !m.readAt)
                    .map(m => m._id);
                if (unreadIds.length > 0) markRead(unreadIds);
            } catch (err: any) {
                if (!cancelled) {
                    setMessages([]);
                    setError(err.message || "加载消息失败");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadConversation();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [friend?.userId]);

    // 向上滚动到顶部时加载更早的历史
    const handleScrollUp = useCallback(async () => {
        const el = viewportRef.current;
        if (!el || !friend || loadingOlder || !hasMore || loading) return;
        if (el.scrollTop > 80) return;
        const oldest = messages[0];
        if (!oldest) return;

        setLoadingOlder(true);
        try {
            const res = await apiFetch(
                `${APIMacro.GETMESSAGE_PULL}?sender=${friend.userId}&before=${encodeURIComponent(oldest.sentAt)}`,
                { method: "GET" }
            );
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const older = (data as FriendMessageItem[]) ?? [];
            if (older.length > 0) {
                // 保持滚动位置：记录旧高度差
                const prevHeight = el.scrollHeight;
                const prevTop = el.scrollTop;
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m._id));
                    return [...older.filter(m => !existingIds.has(m._id)), ...prev];
                });
                requestAnimationFrame(() => {
                    el.scrollTop = el.scrollHeight - prevHeight + prevTop;
                });
            }
            if (older.length < PAGE_SIZE) setHasMore(false);
        } catch (err: any) {
            toast.error(err.message || "加载历史消息失败");
        } finally {
            setLoadingOlder(false);
        }
    }, [friend, loadingOlder, hasMore, loading, messages]);

    // 新消息到来时滚动到底部
    useEffect(() => {
        const el = viewportRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        else bottomRef.current?.scrollIntoView();
    }, [messages.length]);

    // 标记已读（1秒去抖批量提交）
    const flushMarkRead = useCallback(async () => {
        if (flushTimer.current) window.clearTimeout(flushTimer.current);
        flushTimer.current = window.setTimeout(async () => {
            const ids = [...pendingMarkRead.current];
            pendingMarkRead.current = [];
            if (ids.length === 0) return;
            try {
                const res = await apiFetch(APIMacro.PUTMESSAGE_MARKREADED, {
                    method: "PUT",
                    body: JSON.stringify({ messageIds: ids })
                });
                const data = await parseJson(res);
                if (!res.ok) throw new Error(errorText(res, data));
                setMessages(prev => prev.map(m =>
                    ids.includes(m._id) ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m));
            } catch (err: any) {
                // 已读失败不打扰用户，下次进入会话会重试
                console.error("markreaded failed:", err);
            }
        }, 1000);
    }, []);

    const markRead = useCallback((ids: string[]) => {
        pendingMarkRead.current.push(...ids);
        flushMarkRead();
    }, [flushMarkRead]);

    // 发送消息（乐观更新）
    const sendMessage = async () => {
        const text = input.trim();
        if (!text || !friend || sending) return;

        setSending(true);
        const tempId = `temp-${Date.now()}`;
        const optimistic: FriendMessageItem = {
            _id: tempId,
            noviCode: NOVI_CODE,
            sender: myUserId,
            receiver: friend.userId,
            content: text,
            sentAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, optimistic]);
        setInput("");

        try {
            const res = await apiFetch(APIMacro.POSTMESSAGE, {
                method: "POST",
                body: JSON.stringify({
                    noviCode: NOVI_CODE,
                    receiver: friend.userId,
                    content: text
                })
            });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const saved = data as FriendMessageItem;
            setMessages(prev => prev.map(m => (m._id === tempId ? { ...saved, _id: saved._id ?? tempId } : m)));
        } catch (err: any) {
            toast.error(err.message || "发送失败");
            setMessages(prev => prev.filter(m => m._id !== tempId));
        } finally {
            setSending(false);
        }
    };

    if (!friend) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center space-y-1">
                    <p className="text-lg font-medium text-gray-600">选择一个好友开始聊天</p>
                    <p className="text-sm">消息只存在于你和好友之间</p>
                </div>
            </div>
        );
    }

    // 按日期分组渲染
    const renderGroups = () => {
        const groups: { day: string; items: FriendMessageItem[] }[] = [];
        for (const m of messages) {
            const day = formatDay(m.sentAt);
            const last = groups[groups.length - 1];
            if (last && last.day === day) last.items.push(m);
            else groups.push({ day, items: [m] });
        }
        return groups;
    };

    return (
        <Card className="h-full rounded-none shadow-sm border-l flex flex-col">
            {/* 顶部好友信息 */}
            <div className="p-4 border-b flex items-center justify-between">
                <div className="min-w-0">
                    <p className="text-lg font-semibold truncate">{friend.userName}</p>
                    <p className="text-xs text-gray-500 truncate">ID: {friend.userId}</p>
                </div>
                {loadingOlder && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> 加载更早的消息
                    </span>
                )}
            </div>

            {/* 消息内容 */}
            <div className="flex-1 overflow-hidden">
                {loading ? (
                    <div className="p-4 space-y-4">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-8 w-32 ml-auto" />
                        <Skeleton className="h-8 w-56" />
                        <Skeleton className="h-8 w-40 ml-auto" />
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-full text-sm text-red-500">{error}</div>
                ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-sm text-gray-400">
                        还没有消息，打个招呼吧
                    </div>
                ) : (
                    <ScrollArea className="h-full">
                        <div
                            ref={viewportRef}
                            onScroll={handleScrollUp}
                            className="p-4 space-y-1 min-h-full"
                        >
                            {renderGroups().map(group => (
                                <div key={group.day} className="space-y-2">
                                    <div className="flex justify-center py-2">
                                        <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                                            {group.day}
                                        </span>
                                    </div>
                                    {group.items.map(msg => {
                                        const mine = msg.sender === myUserId;
                                        return (
                                            <div
                                                key={msg._id}
                                                className={`flex ${mine ? "justify-end" : "justify-start"}`}
                                            >
                                                <div
                                                    className={`
                                                        max-w-[70%] px-4 py-2 rounded-2xl text-sm shadow-sm
                                                        ${mine
                                                            ? "bg-gray-900 text-white"
                                                            : "bg-gray-200 text-gray-900"}
                                                    `}
                                                >
                                                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                                    <div className={`text-[10px] mt-1 text-right flex items-center gap-1 justify-end ${mine ? "text-white/60" : "text-gray-500"}`}>
                                                        {formatTime(msg.sentAt)}
                                                        {mine && msg.readAt && <span title="对方已读">✓✓</span>}
                                                        {mine && !msg.readAt && msg._id.startsWith("temp-") && <Loader2 className="w-3 h-3 animate-spin" />}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                            <div ref={bottomRef} />
                        </div>
                    </ScrollArea>
                )}
            </div>

            {/* 底部输入框 */}
            <div className="p-4 border-t flex gap-2">
                <Input
                    placeholder="输入消息…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && sendMessage()}
                    disabled={sending}
                />
                <Button onClick={sendMessage} disabled={sending || !input.trim()}>
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    发送
                </Button>
            </div>
        </Card>
    );
}
