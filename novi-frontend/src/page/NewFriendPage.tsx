import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Search,
    UserPlus,
    Users,
    Clock,
    Check,
    X,
    Trash2,
    CornerDownLeft,
    ArrowLeft,
    Loader2
} from 'lucide-react';

import { APIMacro } from '@/api/APIMacro';
import { apiFetch } from '@/api/request';
import { useSessionUser } from '@/context/AuthContext';
import type { FriendRequestItem } from '@/api/types';
import { useNoviSocketEvent } from '@/ws/noviSocket';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

const STATUS_LABEL: Record<string, string> = {
    pending: '待处理',
    accepted: '已是好友',
    rejected: '已拒绝',
    deleted: '已删除',
    canceled: '已撤销',
};

const formatDateTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

interface SearchUserResult {
    userName: string;
    _id: string;
}

export default function NewFriendPage() {
    const user = useSessionUser();

    const [searchUserId, setSearchUserId] = useState('');
    const [searchUserName, setSearchUserName] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
    const [searched, setSearched] = useState(false);

    const [requests, setRequests] = useState<FriendRequestItem[]>([]);
    const [loadingRequests, setLoadingRequests] = useState(true);

    // 搜索
    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setSearching(true);
        setSearched(true);
        try {
            const res = await apiFetch(APIMacro.USERFIND, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ _id: searchUserId, userName: searchUserName })
            });
            const data = await res.json();
            if (res.ok) setSearchResults(data);
            else setSearchResults([]);
        } catch {
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    };

    const handleAddFriend = async (_id: string) => {
        try {
            const res = await apiFetch(APIMacro.POSTFRIENDREQUEST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUserId: _id })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success('申请已发送');
                refreshRequests();
            } else {
                toast.error(data.message);
            }
        } catch (err: any) {
            toast.error(err?.message || '发送失败');
        }
    };

    // 申请记录
    const refreshRequests = async () => {
        setLoadingRequests(true);
        try {
            const res = await apiFetch(APIMacro.GETFRIENDREQUEST, { method: 'GET' });
            const data = await res.json();
            if (res.ok) {
                const list: FriendRequestItem[] = [...data].reverse();
                list.sort((a, b) => {
                    const pa = a.status === 'pending' ? 0 : 1;
                    const pb = b.status === 'pending' ? 0 : 1;
                    return pa - pb;
                });
                setRequests(list);
            }
        } catch { /* 静默 */ }
        finally {
            setLoadingRequests(false);
        }
    };

    const handleRespond = async (friendRequestId: string, status: 'accepted' | 'rejected') => {
        try {
            const res = await apiFetch(APIMacro.PUTFRIENDREQUEST, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendRequestId, status })
            });
            const data = await res.json();
            if (res.ok) refreshRequests();
            else toast.error(data.message);
        } catch (err: any) {
            toast.error(err?.message);
        }
    };

    const handleCancel = async (friendRequestId: string) => {
        try {
            const res = await apiFetch(
                `${APIMacro.DELETEFRIENDREQUEST}?friendRequestId=${friendRequestId}`,
                { method: 'DELETE' }
            );
            const data = await res.json();
            if (res.ok) refreshRequests();
            else toast.error(data.message);
        } catch (err: any) {
            toast.error(err?.message);
        }
    };

    const handleDeleteFriend = async (targetUserId: string, friendRequestId: string) => {
        if (!confirm('确定删除该好友关系吗？')) return;
        try {
            const params = new URLSearchParams({ targetUserId, friendRequestId });
            const res = await apiFetch(`${APIMacro.DELETEFRIEND}?${params.toString()}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) refreshRequests();
            else toast.error(data.message);
        } catch (err: any) {
            toast.error(err?.message);
        }
    };

    useEffect(() => {
        refreshRequests();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 实时刷新申请列表：好友申请到来 / 被处理 / 撤回 / 好友被删除 时立即更新
    useNoviSocketEvent("novi_friend_request_comming", () => refreshRequests());
    useNoviSocketEvent("novi_friend_request_processed", () => refreshRequests());
    useNoviSocketEvent("novi_friend_friend_deleted", () => refreshRequests());

    const pendingIncoming = useMemo(
        () => requests.filter(r => r.status === 'pending' && user.userId === r.receiver.userId).length,
        [requests, user.userId]
    );

    return (
        <div className="flex min-h-dvh flex-col bg-muted/30">
            {/* 顶部栏 */}
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-4 py-3 md:px-6">
                <Button variant="ghost" size="icon" asChild aria-label="返回聊天">
                    <Link to="/functional"><ArrowLeft /></Link></Button>
                <div className="flex flex-col leading-tight">
                    <h1 className="text-base font-semibold tracking-tight">新朋友</h1>
                    <p className="text-xs text-muted-foreground">查找用户 · 管理好友关系</p>
                </div>
            </header>

            <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
                <Tabs defaultValue="search" className="flex flex-col gap-4">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="search" className="gap-2">
                            <Search data-icon="inline-start" className="size-4" />
                            搜索用户
                        </TabsTrigger>
                        <TabsTrigger value="requests" className="gap-2">
                            <Users data-icon="inline-start" className="size-4" />
                            申请管理
                            {pendingIncoming > 0 && (
                                <Badge
                                    variant="secondary"
                                    className="ml-1 h-4.5 min-w-4.5 gap-0 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                                >
                                    {pendingIncoming}
                                </Badge>
                            )}
                        </TabsTrigger>
                    </TabsList>

                    {/* 搜索用户 */}
                    <TabsContent value="search" className="mt-2 flex flex-col gap-4">
                        <form onSubmit={handleSearch} className="flex flex-col gap-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="searchId">用户 ID</Label>
                                    <Input
                                        id="searchId"
                                        placeholder="输入用户 ID"
                                        value={searchUserId}
                                        onChange={e => setSearchUserId(e.target.value)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="searchName">用户名</Label>
                                    <Input
                                        id="searchName"
                                        placeholder="输入用户名"
                                        value={searchUserName}
                                        onChange={e => setSearchUserName(e.target.value)}
                                    />
                                </div>
                            </div>
                            <Button type="submit" className="w-fit" disabled={searching}>
                                {searching
                                    ? <Loader2 data-icon="inline-start" className="animate-spin" />
                                    : <Search data-icon="inline-start" />}
                                {searching ? '搜索中…' : '搜索'}
                            </Button>
                        </form>

                        <Separator />

                        {searching ? (
                            <div className="flex flex-col gap-2">
                                {[...Array(2)].map((_, i) => (
                                    <Item key={i} variant="outline">
                                        <Skeleton className="size-10 rounded-full" />
                                        <div className="flex-1 space-y-1.5">
                                            <Skeleton className="h-4 w-32" />
                                            <Skeleton className="h-3 w-48" />
                                        </div>
                                    </Item>
                                ))}
                            </div>
                        ) : !searched ? (
                            <Empty className="py-10">
                                <EmptyMedia className="mt-0">
                                    <Search className="size-6" />
                                </EmptyMedia>
                                <EmptyTitle>查找新用户</EmptyTitle>
                                <EmptyDescription>
                                    输入用户 ID 或用户名，找到他们并发送好友请求。
                                </EmptyDescription>
                            </Empty>
                        ) : searchResults.length === 0 ? (
                            <Empty className="py-10">
                                <EmptyTitle>没有找到用户</EmptyTitle>
                                <EmptyDescription>
                                    换个 ID 或用户名试试，或确认对方已注册。
                                </EmptyDescription>
                            </Empty>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {searchResults.map(item => (
                                    <Item key={item._id} variant="outline">
                                        <Avatar className="size-10 shrink-0">
                                            <AvatarFallback className="bg-secondary text-sm font-medium text-secondary-foreground">
                                                {item.userName?.trim()?.slice(0, 2) || '?'}
                                            </AvatarFallback>
                                        </Avatar>
                                        <ItemContent className="min-w-0">
                                            <ItemTitle className="truncate">{item.userName}</ItemTitle>
                                            <ItemDescription className="truncate font-mono text-xs">
                                                {item._id}
                                            </ItemDescription>
                                        </ItemContent>
                                        <ItemActions>
                                            <Button
                                                size="sm"
                                                onClick={() => handleAddFriend(item._id)}
                                                className="gap-1.5"
                                            >
                                                <UserPlus data-icon="inline-start" className="size-4" />
                                                添加好友
                                            </Button>
                                        </ItemActions>
                                    </Item>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* 申请管理 */}
                    <TabsContent value="requests" className="mt-2 flex flex-col gap-2">
                        {loadingRequests && requests.length === 0 ? (
                            <div className="flex flex-col gap-2">
                                {[...Array(3)].map((_, i) => (
                                    <Item key={i} variant="outline">
                                        <Skeleton className="size-10 rounded-full" />
                                        <div className="flex-1 space-y-1.5">
                                            <Skeleton className="h-4 w-40" />
                                            <Skeleton className="h-3 w-52" />
                                        </div>
                                    </Item>
                                ))}
                            </div>
                        ) : requests.length === 0 ? (
                            <Empty className="py-10">
                                <EmptyMedia className="mt-0">
                                    <Users className="size-6" />
                                </EmptyMedia>
                                <EmptyTitle>暂无申请记录</EmptyTitle>
                                <EmptyDescription>
                                    你发出的和收到的好友请求都会显示在这里。
                                </EmptyDescription>
                            </Empty>
                        ) : (
                            requests.map(item => {
                                const isReceiver = user.userId === item.receiver.userId;
                                const other = isReceiver ? item.requester : item.receiver;
                                const pending = item.status === 'pending';

                                return (
                                    <Item key={item.friendRequestId} variant="outline" className="flex-col items-stretch gap-3 py-3">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="size-10 shrink-0">
                                                <AvatarFallback className="bg-secondary text-sm font-medium text-secondary-foreground">
                                                    {other.userName?.trim()?.slice(0, 2) || '?'}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate text-sm font-medium">{other.userName}</span>
                                                    <Badge
                                                        variant={
                                                            item.status === 'accepted' ? 'secondary'
                                                            : 'outline'
                                                        }
                                                        className="shrink-0 rounded-full px-2 py-0 text-[10px] font-normal"
                                                    >
                                                        {STATUS_LABEL[item.status] ?? item.status}
                                                    </Badge>
                                                </div>
                                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                    <Clock data-icon="inline-start" className="size-3" />
                                                    {formatDateTime(item.createdAt)}
                                                    {isReceiver
                                                        ? ' · 对方申请加你'
                                                        : ' · 你发出的申请'}
                                                </span>
                                            </div>
                                        </div>

                                        {(pending || item.status === 'accepted') && (
                                            <>
                                                <Separator />
                                                <div className="flex items-center justify-end gap-2">
                                                    {isReceiver && pending && (
                                                        <>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleRespond(item.friendRequestId, 'rejected')}
                                                                className="gap-1.5"
                                                            >
                                                                <X data-icon="inline-start" className="size-4" />
                                                                拒绝
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleRespond(item.friendRequestId, 'accepted')}
                                                                className="gap-1.5"
                                                            >
                                                                <Check data-icon="inline-start" className="size-4" />
                                                                同意
                                                            </Button>
                                                        </>
                                                    )}

                                                    {!isReceiver && pending && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleCancel(item.friendRequestId)}
                                                            className="gap-1.5"
                                                        >
                                                            <CornerDownLeft data-icon="inline-start" className="size-4" />
                                                            撤销申请
                                                        </Button>
                                                    )}

                                                    {item.status === 'accepted' && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleDeleteFriend(other.userId!, item.friendRequestId)}
                                                            className="gap-1.5 text-destructive hover:text-destructive"
                                                        >
                                                            <Trash2 data-icon="inline-start" className="size-4" />
                                                            删除好友
                                                        </Button>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </Item>
                                );
                            })
                        )}
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}
