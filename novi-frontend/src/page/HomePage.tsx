import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export default function HomePage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-white to-gray-100 p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="w-full max-w-4xl"
            >
                <Card className="rounded-2xl shadow-lg overflow-hidden border border-gray-200 bg-white">
                    <div className="flex flex-col md:flex-row items-stretch">

                        {/* ========== 左侧深色 Hero ========== */}
                        <div className="md:w-1/2 p-10 bg-linear-to-b from-gray-900 to-gray-800 text-white flex flex-col justify-center">
                            <div className="flex justify-center mb-6">
                                <div className="p-4 bg-white/10 rounded-full backdrop-blur-sm border border-white/20">
                                    <Sparkles className="w-10 h-10 text-white" />
                                </div>
                            </div>

                            <CardTitle className="text-4xl font-extrabold leading-tight text-center">
                                novi, no way.
                            </CardTitle>

                            <CardDescription className="mt-3 text-gray-300 text-center text-sm max-w-xs mx-auto leading-relaxed">
                                Each friendship, a unique encryption pair the platform can never see.
                            </CardDescription>
                        </div>

                        {/* ========== 右侧 Home 按钮区 ========== */}
                        <div className="md:w-1/2 p-8 bg-white">
                            <CardHeader className="pb-2">
                                <h2 className="text-lg font-semibold text-gray-900 text-center">欢迎来到 novi</h2>
                                <p className="text-sm text-gray-600 text-center">
                                    一个简单、私密、极致轻量的加密聊天世界。
                                </p>
                            </CardHeader>

                            <Separator className="my-6" />

                            <CardContent>
                                <div className="grid grid-cols-2 gap-4">

                                    <Button variant="outline" asChild className="rounded-xl py-5 font-medium">
                                        <Link to="/">首页</Link>
                                    </Button>

                                    <Button asChild className="rounded-xl py-5 font-medium bg-gray-900 text-white hover:bg-black">
                                        <Link to="/signin">登录</Link>
                                    </Button>

                                    <Button variant="secondary" asChild className="rounded-xl py-5 font-medium">
                                        <Link to="/functional">功能</Link>
                                    </Button>

                                    <Button variant="outline" asChild className="rounded-xl py-5 font-medium">
                                        <Link to="/signup">注册</Link>
                                    </Button>

                                    <Button variant="outline" asChild className="rounded-xl py-5 font-medium">
                                        <Link to="/logout">退出登录</Link>
                                    </Button>

                                    <Button variant="secondary" asChild className="rounded-xl py-5 font-medium">
                                        <Link to="/user/info">个人信息</Link>
                                    </Button>

                                    <Button
                                        variant="outline"
                                        asChild
                                        className="rounded-xl py-5 font-medium col-span-2"
                                    >
                                        <Link to="/new/friend">新朋友</Link>
                                    </Button>

                                    <Button
                                        asChild
                                        className="rounded-xl py-5 font-medium col-span-2 bg-gray-900 text-white hover:bg-black"
                                    >
                                        <Link to="/about">关于 novi</Link>
                                    </Button>
                                </div>
                            </CardContent>
                        </div>

                    </div>
                </Card>
            </motion.div>
        </div>
    );
}
