import { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';

function SignupPage() {
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMsg('');

        try {
            const res = await apiFetch(APIMacro.SIGNUP, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userName, email, password }),
            });

            const data = await res.json();

            if (res.ok) {
                setMsg(`注册成功！${JSON.stringify(data)}`);
                console.log('成功:', data);
            } else {
                setMsg(data.message || '注册失败');
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
            <h1>SignupPage</h1>

            {msg && <p>{msg}</p>}

            <form onSubmit={handleSubmit}>
                <div>
                    <input
                        type="text"
                        placeholder="userName"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        required
                    />
                </div>

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
                    {loading ? '注册中...' : '注册'}
                </button>
            </form>
        </>
    );
}

export default SignupPage;