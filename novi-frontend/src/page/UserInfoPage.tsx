import { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth } from '../context/AuthContext';

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function UserInfoPage() {
    const [loading, setLoading] = useState(false);
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const [msg, setMsg] = useState('');

    const { user, updateEmailAndUserName } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMsg('');

        try {
            const res = await apiFetch(APIMacro.PUTUSER, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    _id: user.userId,
                    userName,
                    email,
                })
            });

            const data = await res.json();

            if (res.ok) {
                setMsg('修改成功 ✔️');
                updateEmailAndUserName(data.email, data.userName);
            } else {
                setMsg(data.message || '修改失败 ❌');
            }
        } catch (err: any) {
            setMsg(err.message || '网络错误');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-50">
            <Card className="w-full max-w-md shadow-lg border border-gray-200">
                <CardHeader>
                    <CardTitle className="text-xl text-center font-semibold">
                        用户信息修改
                    </CardTitle>
                </CardHeader>

                <CardContent className="space-y-6">

                    {/* 用户当前信息 */}
                    {user && (
                        <div className="text-center text-gray-600 text-sm space-y-1 pb-2 border-b">
                            <p>用户ID：<span className="font-medium">{user.userId}</span></p>
                            <p>当前用户名：{user.userName}</p>
                            <p>当前邮箱：{user.email}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">

                        <div className="space-y-1">
                            <p className="text-sm text-gray-700">新邮箱</p>
                            <Input
                                type="email"
                                placeholder="输入新的邮箱"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>

                        <div className="space-y-1">
                            <p className="text-sm text-gray-700">新用户名</p>
                            <Input
                                type="text"
                                placeholder="输入新的用户名"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                required
                            />
                        </div>

                        {msg && (
                            <p className="text-center text-sm text-blue-600">
                                {msg}
                            </p>
                        )}

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2 text-base"
                        >
                            {loading ? '修改中…' : '确认修改'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

export default UserInfoPage;
