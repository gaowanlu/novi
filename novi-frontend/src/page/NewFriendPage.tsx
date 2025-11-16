import React, { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
// import { useAuth } from '../context/AuthContext';

interface SearchUserResult {
    userName: string
    _id: string
}

function NewFriendPage() {
    // const { user } = useAuth();
    const [searching, setSearching] = useState<boolean>(false);
    const [searchUserId, setSearchUserId] = useState<string>('');
    const [searchUserName, setSearchUserName] = useState<string>('');
    const [msg, setMsg] = useState('');
    const [searchUserResultList, setSearchUserResultList] = useState<SearchUserResult[]>([]);

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

    return (
        <>
            <h1>NewFriendPage</h1>
            {msg && <p>{msg}</p>}
            <div>
                <h2>搜索用户</h2>
                <div style={{ 'border': '1px solid black', 'padding': '1rem' }}>
                    <form onSubmit={handleSearchUserSubmit}>
                        <input type='text' placeholder='用户ID' value={searchUserId} onChange={(e) => setSearchUserId(e.target.value)} />
                        <input type='text' placeholder='用户名' value={searchUserName} onChange={(e) => setSearchUserName(e.target.value)} />
                        <button type='submit'>{searching ? '搜索中' : '搜索'}</button>
                    </form>
                    <div>
                        {searchUserResultList.length === 0 && <p>暂无内容</p>}
                        {searchUserResultList.map((item: SearchUserResult) => {
                            return <div key={item._id} style={{ 'border': '1px solid black' }}>
                                <p>ID: {item._id} UserName: {item.userName}</p>
                                <button>添加好友</button>
                            </div>
                        })}
                    </div>
                </div>
            </div>
            <div>
                <h2>申请管理</h2>
                <div style={{ 'border': '1px solid black', 'padding': '1rem' }}>
                </div>
            </div>
        </>
    );
}

export default NewFriendPage;
