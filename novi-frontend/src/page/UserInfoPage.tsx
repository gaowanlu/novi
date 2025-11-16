import React, { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth } from '../context/AuthContext';

function UserInfoPage() {
    const [loading, setLoading] = useState(false);
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const [msg, setMsg] = useState('');
    const { token, user, updateEmailAndUserName } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMsg('');

        try {
            const res = await apiFetch(APIMacro.PUTUSER, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ _id: user.userId, userName: userName, email: email })
            });
            const data = await res.json();

            if (res.ok) {
                setMsg('修改成功');
                console.log('修改成功', data);
                updateEmailAndUserName(data.email, data.userName);
            } else {
                setMsg(data.message || '修改失败');
            }

            console.log(data);
        } catch (err: any) {
            setMsg(err.message);
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <h1>UserInfoPage</h1>

            {token && <p>token: {token}</p>}
            {user && <p>userId: {user.userId} userName: {user.userName} email: {user.email}</p>}

            <form onSubmit={handleSubmit} style={{ 'border': 'medium dashed green' }}>
                <div>
                    <p>我的ID: {user.userId}</p>
                </div>
                <div>
                    <input type='email' placeholder='邮箱' value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div>
                    <input type='text' placeholder='用户名' value={userName} onChange={(e) => setUserName(e.target.value)} required />
                </div>
                <div>
                    <button type='submit' disabled={loading}>
                        {loading ? '修改中...' : '修改'}
                    </button>
                </div>
                {msg && <p>{msg}</p>}
            </form>
        </>
    );
}

export default UserInfoPage;
