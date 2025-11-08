import { useState } from 'react';
import { ApiMacro } from '../api/ApiMacro';
import { apiFetch } from '../api/request';
import { useAuth } from '../context/AuthContext';

function LogoutPage() {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');
    const { token, user, logout } = useAuth();

    const handleButtonClick = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMsg('');

        try {
            const res = await apiFetch(ApiMacro.LOGOUT, {
                method: 'GET'
            });

            const data = await res.json();

            if (res.ok) {
                setMsg(`退出登录成功！${JSON.stringify(data)}`);
                console.log('退出登录成功:', data);
                logout();
            } else {
                setMsg(data.message || '退出登录失败');
            }
        } catch (err) {
            setMsg('网络错误');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <h1>LogoutPage</h1>

            {token && <p>token: {token}</p>}
            {user && <p>userId: {user.userId} userName: {user.userName} email: {user.email}</p>}
            {msg && <p>{msg}</p>}

            <button onClick={(e) => handleButtonClick(e)}>退出登录</button>
        </>
    );
}

export default LogoutPage;