import React, { useEffect, useState } from 'react';
import { APIMacro } from '@/api/APIMacro';
import { apiFetch } from '@/api/request';
import { useSessionUser } from '@/context/AuthContext';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle
} from "@/components/ui/item";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import { Search, UserPlus, Users, Clock } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, string> = {
    pending: '待处理',
    accepted: '已是好友',
    rejected: '已拒绝',
    deleted: '已删除',
    canceled: '已撤销',
};

const formatDateTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString("zh-CN") : "—";

interface SearchUserResult {
    userName: string;
    _id: string;
}

interface FriendRequestResult {
    friendRequestId: string;
    createdAt: string;
    status: string;
    requester: {
        userId: string;
        userName: string;
    };
    receiver: {
        userId: string;
        userName: string;
    };
}

export default function NewFriendPage() {
    const user = useSessionUser();
    const [loadingRequests, setLoadingRequests] = useState(true);
    const [searching, setSearching] = useState(false);
    const [searchUserId, setSearchUserId] = useState('');
    const [searchUserName, setSearchUserName] = useState('');
    const [msg, setMsg] = useState('');
    const [searchUserResultList, setSearchUserResultList] = useState<SearchUserResult[]>([]);
    const [friendRequestResultList, setFriendRequestResultList] = useState<FriendRequestResult[]>([]);

    const handleSearchUserSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSearching(true);
        try {
            const res = await apiFetch(APIMacro.USERFIND, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ _id: searchUserId, userName: searchUserName })
            });
            const data = await res.json();
            if (res.ok) {
                setSearchUserResultList(data);
            } else {
                setMsg(data.message);
            }
        } catch (err: any) {
            console.error(err);
        } finally {
            setSearching(false);
        }
    };

    const handleAddNewFriendRequest = async (_id: string) => {
        try {
            const res = await apiFetch(APIMacro.POSTFRIENDREQUEST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUserId: _id })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("申请成功");
                handleGetFriendRequest();
            } else {
                toast.error(data.message);
            }
        } catch (err: any) {
            console.log(err);
        }
    };

    const handleGetFriendRequest = async () => {
        setLoadingRequests(true);
        try {
            const res = await apiFetch(APIMacro.GETFRIENDREQUEST, { method: 'GET' });
            const data = await res.json();
            if (res.ok) {
                // 待处理（别人等我回复 / 我发出未回复）置顶，其余按时间倒序
                const list = [...data].reverse();
                const pending = (s: string) => s === 'pending';
                list.sort((a, b) => {
                    const pa = pending(a.status) ? 0 : 1;
                    const pb = pending(b.status) ? 0 : 1;
                    return pa - pb;
                });
                setFriendRequestResultList(list);
            }
        } catch (err: any) {
            console.log(err);
        } finally {
            setLoadingRequests(false);
        }
    };

    const handleDeleteFriend = async (targetUserId: string, friendRequestId: string) => {
        try {
            const params = new URLSearchParams({ targetUserId, friendRequestId });
            const res = await apiFetch(
                `${APIMacro.DELETEFRIEND}?${params.toString()}`,
                { method: 'DELETE' }
            );
            const data = await res.json();
            if (res.ok) {
                handleGetFriendRequest();
            } else {
                toast.error(data.message);
            }
        } catch (err: any) {
            console.error(err);
        }
    };

    const handleDeleteFriendRequest = async (friendRequestId: string) => {
        try {
            const res = await apiFetch(
                `${APIMacro.DELETEFRIENDREQUEST}?friendRequestId=${friendRequestId}`,
                { method: 'DELETE' }
            );
            const data = await res.json();
            if (res.ok) {
                handleGetFriendRequest();
            } else {
                toast.error(data.message);
            }
        } catch (err: any) {
            console.error(err);
        }
    };

    const handlePutFriendRequest = async (friendRequestId: string, status: string) => {
        try {
            const res = await apiFetch(APIMacro.PUTFRIENDREQUEST, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendRequestId, status })
            });
            const data = await res.json();
            if (res.ok) {
                handleGetFriendRequest();
            } else {
                toast.error(data.message);
            }
        } catch (err: any) {
            console.error(err);
        }
    };

    useEffect(() => {
        handleGetFriendRequest();
    }, []);

    return (
        <div className="min-h-screen p-6 bg-linear-to-b from-white to-gray-100 flex items-center justify-center">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-4xl space-y-8"
            >

                {/* 顶部标题 */}
                <div className="text-center space-y-2">
                    <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 flex items-center justify-center gap-2">
                        <UserPlus className="w-8 h-8 text-gray-700" />
                        新朋友
                    </h1>
                    <p className="text-gray-500">查找用户 · 发送好友请求 · 管理你的关系</p>
                </div>

                {/* 搜索区域 */}
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <Search className="w-5 h-5" />
                            搜索用户
                        </CardTitle>
                        <p>{msg}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSearchUserSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Input
                                placeholder="用户ID"
                                value={searchUserId}
                                onChange={(e) => setSearchUserId(e.target.value)}
                            />
                            <Input
                                placeholder="用户名"
                                value={searchUserName}
                                onChange={(e) => setSearchUserName(e.target.value)}
                            />
                            <Button type="submit" className="w-full">
                                {searching ? "搜索中..." : "搜索"}
                            </Button>
                        </form>

                        <Separator />

                        <div className="flex flex-col gap-4">
                            {searchUserResultList.length === 0 && (
                                <p className="text-sm text-gray-500 text-center">暂无搜索结果</p>
                            )}

                            {searchUserResultList.map((item) => (
                                <Item key={item._id} variant="outline" className="p-4 rounded-xl">
                                    <ItemContent>
                                        <ItemTitle className="font-semibold text-gray-900">{item.userName}</ItemTitle>
                                        <ItemDescription className="text-gray-500">
                                            {item._id}
                                        </ItemDescription>
                                    </ItemContent>
                                    <ItemActions>
                                        <Button
                                            onClick={() => handleAddNewFriendRequest(item._id)}
                                            size="sm"
                                            className="bg-gray-900 text-white hover:bg-black"
                                        >
                                            添加好友
                                        </Button>
                                    </ItemActions>
                                </Item>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* 好友请求区域 */}
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <Users className="w-5 h-5" />
                            申请管理
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {loadingRequests && friendRequestResultList.length === 0 && (
                            <p className="text-sm text-gray-500 text-center py-4">加载申请记录…</p>
                        )}

                        {!loadingRequests && friendRequestResultList.length === 0 && (
                            <p className="text-sm text-gray-500 text-center py-4">暂无好友申请记录</p>
                        )}

                        {friendRequestResultList.map((item) => (
                            <Item key={item.friendRequestId} variant="outline" className="p-4 rounded-xl flex-col items-start">
                                <div className="flex flex-col gap-1 text-sm text-gray-700">
                                    <p className="flex items-center gap-1">
                                        <strong>
                                            {user.userId === item.receiver.userId ? '有人申请加你' : '你申请添加'}
                                        </strong>
                                        <span className="font-semibold">{user.userId === item.receiver.userId ? item.requester.userName : item.receiver.userName}</span>
                                    </p>
                                    <p><strong>状态：</strong>{STATUS_LABEL[item.status] ?? item.status}</p>
                                    <p className="flex items-center gap-1 text-xs text-gray-500">
                                        <Clock className="w-3 h-3" />
                                        {formatDateTime(item.createdAt)}
                                        {item.status === 'pending' && user.userId === item.receiver.userId
                                            ? ' · 等待你回复'
                                            : item.status === 'pending' ? ' · 等待对方回复' : ''}
                                    </p>
                                </div>

                                <ButtonGroup className="flex w-full justify-end pt-3">
                                    {user.userId === item.receiver.userId && item.status === "pending" && (
                                        <>
                                            <Button
                                                variant="outline"
                                                onClick={() => handlePutFriendRequest(item.friendRequestId, 'accepted')}
                                            >
                                                同意
                                            </Button>

                                            <Button
                                                variant="outline"
                                                onClick={() => handlePutFriendRequest(item.friendRequestId, 'rejected')}
                                            >
                                                拒绝
                                            </Button>
                                        </>
                                    )}

                                    {user.userId === item.requester.userId && item.status === "pending" && (
                                        <Button variant="outline" onClick={() => handleDeleteFriendRequest(item.friendRequestId)}>
                                            撤销
                                        </Button>
                                    )}

                                    {item.status === 'accepted' && (
                                        <Button
                                            variant="outline"
                                            onClick={() =>
                                                handleDeleteFriend(
                                                    user.userId === item.receiver.userId ? item.requester.userId : item.receiver.userId,
                                                    item.friendRequestId
                                                )
                                            }
                                        >
                                            删除好友关系
                                        </Button>
                                    )}
                                </ButtonGroup>

                            </Item>
                        ))}
                    </CardContent>
                </Card>

            </motion.div>
        </div>
    );
}
