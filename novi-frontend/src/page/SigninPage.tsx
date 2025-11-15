import { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth } from '../context/AuthContext';

function SigninPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');
    const { login, token, user } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMsg('');

        try {
            const res = await apiFetch(APIMacro.LOGIN, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (res.ok) {
                setMsg(`登录成功！${JSON.stringify(data)}`);
                console.log('成功:', data);
                login(data.jwtToken, { userId: data.userId, userName: data.userName, email: data.email });
            } else {
                setMsg(data.message || '登录失败');
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
            <h1>SigninPage</h1>

            {token && <p>token: {token}</p>}
            {user && <p>userId: {user.userId} userName: {user.userName} email: {user.email}</p>}
            {msg && <p>{msg}</p>}

            <form onSubmit={handleSubmit}>
                <div>
                    <input
                        type="email"
                        placeholder="12345678@qq.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>

                <div>
                    <input
                        type="password"
                        placeholder="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>

                <button type="submit" disabled={loading}>
                    {loading ? '登录中...' : '登录'}
                </button>
            </form>
        </>
    );
}

export default SigninPage;