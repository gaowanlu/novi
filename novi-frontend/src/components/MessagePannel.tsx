import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    ArrowDown,
    Check,
    CheckCheck,
    Clock3,
    Lock,
    MoreVertical,
    Paperclip,
    Search,
    SendHorizontal,
    Smile,
    UserPlus
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
    Message,
    MessageContent,
    MessageFooter,
    MessageHeader,
    MessageGroup
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker } from "@/components/ui/marker";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

const formatDay = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return "今天";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "昨天";
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
};

/** 消息状态图标：未读=单勾，已读=双勾 */
const ReadTicks = ({ read, sending }: { read: boolean; sending: boolean }) => {
    if (sending) return <Clock3 data-icon="inline-end" className="size-3.5" aria-label="发送中" />;
    if (read) return <CheckCheck data-icon="inline-end" className="size-3.5" aria-label="对方已读" />;
    return <Check data-icon="inline-end" className="size-3.5" aria-label="已送达" />;
};

export default function MessagePanel({
    friend,
    user
}: {
    friend: UserInfo | null;
    user?: { userId: string } | null;
}) {
    const myUserId = user?.userId ?? "";

    const [messages, setMessages] = useState<FriendMessageItem[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState("");
    const [nearBottom, setNearBottom] = useState(true);
    const [newCount, setNewCount] = useState(0);

    const viewportRef = useRef<HTMLDivElement>(null);
    const prevLenRef = useRef(0);
    const prevFriendRef = useRef<string | null>(null);
    const pendingMarkRead = useRef<string[]>([]);
    const flushTimer = useRef<number | null>(null);

    // 会话切换时拉取会话（未读优先，无未读取最新一批）
    useEffect(() => {
        if (!friend) return;
        let cancelled = false;
        prevFriendRef.current = friend.userId;
        prevLenRef.current = 0;
        setNewCount(0);
        setNearBottom(true);

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
                prevLenRef.current = list.length;
                setHasMore(list.length >= PAGE_SIZE);
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

    const scrollToBottom = useCallback((smooth = false) => {
        const el = viewportRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    }, []);

    // 新消息：在底部附近 → 平滑滚到底；否则累计新消息计数
    useEffect(() => {
        const grew = messages.length - prevLenRef.current;
        prevLenRef.current = messages.length;
        if (grew <= 0) return;
        if (nearBottom) {
            scrollToBottom(true);
            setNewCount(0);
        } else {
            setNewCount(c => c + grew);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length]);

    const handleScroll = useCallback(async () => {
        const el = viewportRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        setNearBottom(atBottom);
        if (atBottom && newCount > 0) setNewCount(0);

        if (el.scrollTop > 80) return;
        if (!friend || loadingOlder || !hasMore || loading) return;
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
            // 后端 before 分支返回倒序（新→旧），翻转为正序（旧→新）再拼到列表头部
            const older = ((data as FriendMessageItem[]) ?? []).reverse();
            if (older.length > 0) {
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
    }, [friend, loadingOlder, hasMore, loading, messages, newCount]);

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
                console.error("markreaded failed:", err);
            }
        }, 1000);
    }, []);

    const markRead = useCallback((ids: string[]) => {
        pendingMarkRead.current.push(...ids);
        flushMarkRead();
    }, [flushMarkRead]);

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
        setNearBottom(true);

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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            sendMessage();
        }
    };

    // 按日期分组
    const groups = useMemo(() => {
        // 防御性排序：不信任传输顺序，统一按 sentAt 升序（旧在上、新在下）。
        // 同秒消息用 _id 兜底（Mongo ObjectId 天然含时间戳，可稳定去重排序）。
        const sorted = [...messages].sort((a, b) => {
            const d = new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
            return d !== 0 ? d : a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
        });

        const out: { day: string; items: FriendMessageItem[] }[] = [];
        for (const m of sorted) {
            const day = formatDay(m.sentAt);
            const last = out[out.length - 1];
            if (last && last.day === day) last.items.push(m);
            else out.push({ day, items: [m] });
        }
        return out;
    }, [messages]);

    if (!friend) {
        return (
            <section className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-card ring-1 ring-border">
                    <Lock className="size-7 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold">选择一个好友开始聊天</h2>
                    <p className="max-w-xs text-sm text-muted-foreground">
                        每段友谊都拥有独立的加密密钥对，平台永远无法读取你的内容。
                    </p>
                </div>
            </section>
        );
    }

    return (
        <section className="flex h-full min-h-0 flex-1 flex-col bg-muted/30">
            {/* 顶栏 */}
            <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
                <Avatar className="size-10 shrink-0">
                    <AvatarFallback className="bg-secondary text-sm font-medium text-secondary-foreground">
                        {friend.userName?.trim()?.slice(0, 2) || "?"}
                    </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-semibold">{friend.userName}</span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <Lock data-icon="inline-start" className="size-3" />
                        ID {friend.userId} · 端到端加密
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" aria-label="搜索消息">
                        <Search />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="更多">
                        <MoreVertical />
                    </Button>
                </div>
            </header>

            {/* 消息区 */}
            <div className="relative min-h-0 flex-1">
                <div
                    ref={viewportRef}
                    onScroll={handleScroll}
                    className="h-full overflow-y-auto scroll-smooth px-4 py-4 md:px-8"
                >
                    {loading ? (
                        <div className="flex flex-col gap-6">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                                    <Skeleton className="h-10 w-56 rounded-2xl" />
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="flex h-full items-center justify-center">
                            <Badge variant="destructive">{error}</Badge>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                            <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1 text-xs">
                                <Lock data-icon="inline-start" className="size-3" />
                                消息受端到端加密保护
                            </Badge>
                            <p className="mt-2 text-sm text-muted-foreground">还没有消息，打个招呼吧</p>
                        </div>
                    ) : (
                        <div className="mx-auto flex max-w-3xl flex-col gap-1">
                            {loadingOlder && (
                                <div className="mb-2 flex justify-center">
                                    <Badge variant="secondary" className="gap-1.5 rounded-full text-xs">
                                        <Skeleton className="size-3 rounded-full" />
                                        加载更早的消息…
                                    </Badge>
                                </div>
                            )}
                            {groups.map(group => (
                                <div key={group.day} className="flex flex-col gap-1">
                                    <Marker variant="separator" className="my-3">
                                        <Badge variant="secondary" className="gap-1.5 rounded-full bg-muted/80 px-2.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-muted/80">
                                            <Lock data-icon="inline-start" className="size-3" />
                                            {group.day}
                                        </Badge>
                                    </Marker>
                                    <MessageGroup>
                                        {group.items.map(msg => {
                                            const mine = msg.sender === myUserId;
                                            const isTemp = msg._id.startsWith("temp-");
                                            return (
                                                <Message key={msg._id} align={mine ? "end" : "start"}>
                                                    <MessageContent>
                                                        <MessageHeader>
                                                            {!mine && <span>{friend.userName}</span>}
                                                        </MessageHeader>
                                                        <Bubble variant={mine ? "default" : "secondary"} align={mine ? "end" : "start"}>
                                                            <BubbleContent>
                                                                <p className="whitespace-pre-wrap break-words">
                                                                    {msg.content}
                                                                </p>
                                                            </BubbleContent>
                                                            <MessageFooter className="gap-1">
                                                                <span className="tabular-nums">
                                                                    {formatTime(msg.sentAt)}
                                                                </span>
                                                                {mine && (
                                                                    <ReadTicks read={Boolean(msg.readAt)} sending={isTemp} />
                                                                )}
                                                            </MessageFooter>
                                                        </Bubble>
                                                    </MessageContent>
                                                </Message>
                                            );
                                        })}
                                    </MessageGroup>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 跳转到最新 */}
                {!nearBottom && !loading && messages.length > 0 && (
                    <button
                        type="button"
                        onClick={() => { scrollToBottom(true); setNewCount(0); }}
                        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent"
                    >
                        {newCount > 0 && (
                            <Badge className="h-4 min-w-4 gap-0 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                                {newCount}
                            </Badge>
                        )}
                        <ArrowDown data-icon="inline-start" className="size-3.5" />
                        最新消息
                    </button>
                )}
            </div>

            {/* 输入区 */}
            <footer className="flex items-end gap-2 border-t bg-card px-3 py-3 md:px-4">
                <Button variant="ghost" size="icon" className="shrink-0" aria-label="添加好友">
                    <UserPlus />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border bg-muted/60 px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-foreground" aria-label="表情">
                        <Smile />
                    </Button>
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入消息…"
                        aria-label="消息内容"
                        className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-foreground" aria-label="附件">
                        <Paperclip />
                    </Button>
                </div>
                <Button
                    size="icon"
                    className="size-10 shrink-0 rounded-full"
                    onClick={sendMessage}
                    disabled={!input.trim() || sending}
                    aria-label="发送"
                >
                    <SendHorizontal />
                </Button>
            </footer>
        </section>
    );
}
