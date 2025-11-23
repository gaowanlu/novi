import { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth } from '../context/AuthContext';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function LogoutPage() {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');
    const { user, logout } = useAuth();

    const handleLogout = async () => {
        setLoading(true);
        setMsg('');

        try {
            const res = await apiFetch(APIMacro.LOGOUT, {
                method: 'GET'
            });

            const data = await res.json();

            if (res.ok) {
                setMsg('退出成功 ✔️');
                logout();
            } else {
                setMsg(data.message || '退出失败 ❌');
            }
        } catch (err) {
            setMsg('网络错误');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-50">
            <Card className="w-full max-w-md shadow-lg border border-gray-200">
                <CardHeader>
                    <CardTitle className="text-xl font-semibold text-center">
                        退出登录
                    </CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">

                    {user && (
                        <div className="text-center text-gray-600 text-sm space-y-1">
                            <p>当前用户：<span className="font-medium">{user.userName}</span></p>
                            <p>Email：{user.email}</p>
                        </div>
                    )}

                    {msg && (
                        <p className="text-center text-sm text-blue-600">
                            {msg}
                        </p>
                    )}

                    <Button
                        onClick={handleLogout}
                        disabled={loading}
                        className="w-full py-2 text-base"
                    >
                        {loading ? '退出中...' : '确认退出'}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

export default LogoutPage;
