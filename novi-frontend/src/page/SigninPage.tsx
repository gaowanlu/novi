import { toast } from "sonner"

import { useState } from 'react';
import { APIMacro } from '../api/APIMacro';
import { apiFetch } from '../api/request';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useNavigate } from "react-router-dom";


function SigninPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loginProcessing, setLoginProcessing] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setLoginProcessing(true);

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
                console.log('成功:', data);
                login(data.jwtToken, { userId: data.userId, userName: data.userName, email: data.email });
                navigate("/");
            } else {
                console.error('登录失败', data.message);
                toast.error("Login failed", {
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
        } catch (err) {
            console.error(err);
        } finally {
            setLoginProcessing(false);
        }
    };

    return (
        <div className='w-full h-screen flex justify-center items-center'>
            <Card className='w-full max-w-sm'>
                <CardHeader>
                    <CardTitle>Login to your novi account</CardTitle>
                    <CardDescription>
                        Each friendship, a unique encryption pair the platform can never see.
                    </CardDescription>
                    <CardAction>
                        <Button variant="link">Sign Up</Button>
                    </CardAction>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit}>
                        <div className='flex flex-col gap-6'>
                            <div className='grid gap-2'>
                                <Label htmlFor='email'>Email</Label>
                                <Input id='email'
                                    type='email'
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder='account@mfavant.xyz'
                                    required />
                            </div>
                            <div className='grid gap-2'>
                                <div className='flex items-center'>
                                    <Label htmlFor='password'>Password</Label>
                                    <a href='#' className='ml-auto inline-block text-sm underline-offset-4 hover:underline'>
                                        Forgot your password?
                                    </a>
                                </div>
                                <Input id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required />
                            </div>
                            <div className='grid gap-2'>
                                <Button
                                    type="submit"
                                    className='w-full'
                                    disabled={loginProcessing}
                                    onClick={handleSubmit}>
                                    {loginProcessing ? 'Processing...' : 'Login'}
                                </Button>
                            </div>
                        </div>
                    </form>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                </CardFooter>
            </Card>
        </div>
    );
}

export default SigninPage;