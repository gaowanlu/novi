import React, { useEffect, useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle
} from "@/components/ui/item";
import { toast } from "sonner"
// import { useAuth } from '../context/AuthContext';

interface SearchUserResult {
    userName: string
    _id: string
}

interface FriendRequestResult {
    friendRequestId: string,
    createdAt: string,
    status: string,
    requester: {
        userId: string,
        userName: string
    },
    receiver: {
        userId: string,
        userName: string
    }
}

function NewFriendPage() {
    // const { user } = useAuth();
    const [searching, setSearching] = useState<boolean>(false);
    const [searchUserId, setSearchUserId] = useState<string>('');
    const [searchUserName, setSearchUserName] = useState<string>('');
    const [msg, setMsg] = useState('');
    const [searchUserResultList, setSearchUserResultList] = useState<SearchUserResult[]>([]);
    const [friendRequestResultList, setFriendRequestResultList] = useState<FriendRequestResult[]>([]);

    const handleSearchUserSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        console.log('搜索', { searchUserId, searchUserName });
        setSearching(true);

        try {
            const res = await apiFetch(APIMacro.USERFIND, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ _id: searchUserId, userName: searchUserName })
            });
            const data = await res.json();

            if (res.ok) {
                console.log('搜索结果', data);
                const newSearchUserResultList = data as SearchUserResult[];
                newSearchUserResultList.forEach(searchUser => {
                    console.log(searchUser);
                });
                setSearchUserResultList(newSearchUserResultList);

            } else {
                console.error(data.message);
                setMsg(data.message);
            }

        } catch (err: any) {
            console.error(err);
        } finally {
            setSearching(false);
        }
    };

    const handleAddNewFriendRequest = async (_id: string, userName: string) => {
        console.log({ _id, userName });

        try {
            const res = await apiFetch(APIMacro.POSTFRIENDREQUEST, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ targetUserId: _id })
            });
            const data = await res.json();
            if (res.ok) {
                console.log('发起好友申请结果', data);
                toast.success("Appling successful", {
                    description: (
                        <span className="text-green-400">
                            {JSON.stringify(data)}
                        </span>
                    ),
                    action: {
                        label: "Undo",
                        onClick: () => console.log("Undo"),
                    },
                });
                handleGetFriendRequest();
            } else {
                toast.error("Apply failed", {
                    description: (
                        <span className="text-red-400">
                            {data.message}
                        </span>
                    ),
                    action: {
                        label: "Undo",
                        onClick: () => console.log("Undo"),
                    },
                });
            }
        } catch (err: any) {
            console.log(err);
        }
    };

    const handleGetFriendRequest = async () => {
        try {
            const res = await apiFetch(APIMacro.GETFRIENDREQUEST, {
                method: 'GET'
            });
            const data = await res.json();
            if (res.ok) {
                console.log(data);
                const newFriendRequestResultList = data as FriendRequestResult[];
                setFriendRequestResultList(newFriendRequestResultList);
            } else {
                console.error(data.message);
            }
        } catch (err: any) {
            console.log(err);
        }
    };

    useEffect(() => {
        handleGetFriendRequest();
    }, []);

    return (
        <>
            <h1>NewFriendPage</h1>
            {msg && <p>{msg}</p>}
            <div>
                <h2>搜索用户</h2>
                <div className='p-2'>
                    <form onSubmit={handleSearchUserSubmit} className='flex flex-col gap-2'>
                        <Input type='text' placeholder='用户ID' value={searchUserId} onChange={(e) => setSearchUserId(e.target.value)} />
                        <Input type='text' placeholder='用户名' value={searchUserName} onChange={(e) => setSearchUserName(e.target.value)} />
                        <Button type='submit'>{searching ? '搜索中' : '搜索'}</Button>
                    </form>
                    <div className="flex w-full flex-col gap-6 pt-2">
                        {searchUserResultList.length === 0 && <p>暂无内容</p>}
                        {searchUserResultList.map((item: SearchUserResult) => {
                            return <Item key={item._id} variant="outline">
                                <ItemContent>
                                    <ItemTitle>{item.userName}</ItemTitle>
                                    <ItemDescription>
                                        {item._id}
                                    </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Button onClick={(e: any) => handleAddNewFriendRequest(item._id, item.userName)} size="sm" className='cursor-pointer'>
                                        申请添加为好友
                                    </Button>
                                </ItemActions>
                            </Item>
                        })}
                    </div>
                </div>
            </div>
            <div>
                <h2>申请管理</h2>
                <div className='flex flex-col gap-2'>
                    {friendRequestResultList.map((item: FriendRequestResult) => {
                        return <Item key={item.friendRequestId} variant="outline">
                            <p>发起者: {item.requester.userId} | {item.requester.userName}</p>
                            <p>接收者: {item.receiver.userId} | {item.receiver.userName}</p>
                            <p>状态: {item.status}</p>
                            <p>创建时间: {item.createdAt}</p>
                            <Button>同意</Button>
                            <Button>拒绝</Button>
                            <Button>撤销</Button>
                            <Button>删除好友关系</Button>
                        </Item>
                    })}
                </div>
            </div>
        </>
    );
}

export default NewFriendPage;
