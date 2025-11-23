import { useState } from "react";
import { APIMacro } from "../api/APIMacro";
import { apiFetch } from "../api/request";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardAction } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export default function SignupPage() {
    const [userName, setUserName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [processing, setProcessing] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setProcessing(true);

        try {
            const res = await apiFetch(APIMacro.SIGNUP, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userName, email, password }),
            });

            const data = await res.json();

            if (res.ok) {
                console.log("注册成功:", data);
                navigate("/signin");
            } else {
                console.error("注册失败", data.message);
                toast.error("注册失败", {
                    description: <span className="text-red-400">{data.message}</span>,
                });
            }
        } catch (err) {
            console.error(err);
            toast.error("网络错误");
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="w-full h-screen flex justify-center items-center">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle>Create your novi account</CardTitle>
                </CardHeader>

                <CardAction className="w-full flex justify-end px-6">
                    <Link to="/signin">
                        <Button variant="link" className="p-0 text-sm">
                            Already have an account?
                        </Button>
                    </Link>
                </CardAction>

                <CardContent>
                    <form onSubmit={handleSubmit}>
                        <div className="flex flex-col gap-6">
                            <div className="grid gap-2">
                                <Label htmlFor="userName">User Name</Label>
                                <Input
                                    id="userName"
                                    type="text"
                                    value={userName}
                                    onChange={(e) => setUserName(e.target.value)}
                                    placeholder="your nickname"
                                    required
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="account@mfavant.xyz"
                                    required
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="grid gap-2">
                                <Button type="submit" className="w-full" disabled={processing}>
                                    {processing ? "Processing..." : "Sign Up"}
                                </Button>
                            </div>
                        </div>
                    </form>
                </CardContent>

                <CardFooter className="flex-col gap-2"></CardFooter>
            </Card>
        </div>
    );
}
