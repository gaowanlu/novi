import { Link } from 'react-router-dom';
import {
    Lock,
    ShieldCheck,
    Zap,
    MessageCircle,
    ArrowRight,
    Sparkles
} from 'lucide-react';
import { motion } from 'framer-motion';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const FEATURES = [
    {
        icon: Lock,
        title: '端到端加密',
        desc: '每段友谊生成独立的密钥对，服务器永远只看到密文。'
    },
    {
        icon: ShieldCheck,
        title: '零信任架构',
        desc: '无后门、无托管密钥，只有你和好友的设备能解密内容。'
    },
    {
        icon: Zap,
        title: '轻量极速',
        desc: '客户端优先的极简设计，桌面与移动端都丝滑。'
    }
];

export default function HomePage() {
    const { user } = useAuth();

    return (
        <div className="flex min-h-dvh flex-col bg-background">
            {/* 顶栏 */}
            <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-6 py-3 backdrop-blur">
                <Link to="/" className="flex items-center gap-2" aria-label="novi 首页">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <MessageCircle className="size-4.5" data-icon="inline-start" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">novi</span>
                </Link>
                <div className="flex items-center gap-2">
                    <Button asChild variant="ghost" size="sm">
                        <Link to="/about">关于</Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                        <Link to="/functional">功能</Link>
                    </Button>
                    {user ? (
                        <Button asChild size="sm">
                            <Link to="/functional">打开聊天</Link>
                        </Button>
                    ) : (
                        <>
                            <Button asChild variant="ghost" size="sm">
                                <Link to="/signin">登录</Link>
                            </Button>
                            <Button asChild size="sm">
                                <Link to="/signup">注册</Link>
                            </Button>
                        </>
                    )}
                </div>
            </header>

            {/* Hero */}
            <main className="flex flex-1 flex-col">
                <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-6 pt-16 pb-12 text-center md:pt-24">
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="flex flex-col items-center gap-5"
                    >
                        <Badge
                            variant="secondary"
                            className="gap-1.5 rounded-full px-3 py-1 text-xs"
                        >
                            <Sparkles data-icon="inline-start" className="size-3" />
                            隐私优先 · 端到端加密
                        </Badge>

                        <h1 className="max-w-2xl text-4xl leading-tight font-extrabold tracking-tight md:text-5xl">
                            每段友谊，一把{' '}
                            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                                独有密钥
                            </span>
                        </h1>

                        <p className="max-w-xl text-base text-muted-foreground md:text-lg">
                            novi 是一个端到端加密的私密聊天应用。
                            平台永远只存储密文，密钥只存在于你和好友的设备之间。
                        </p>

                        <div className="flex items-center gap-3">
                            <Button asChild size="lg" className="h-11 gap-2 rounded-full px-6">
                                <Link to={user ? '/functional' : '/signup'}>
                                    {user ? '开始聊天' : '免费开始'}
                                    <ArrowRight data-icon="inline-end" className="size-4" />
                                </Link>
                            </Button>
                            <Button asChild size="lg" variant="outline" className="h-11 rounded-full px-6">
                                <Link to="/about">了解更多</Link>
                            </Button>
                        </div>
                    </motion.div>
                </section>

                {/* 特性 */}
                <section className="mx-auto w-full max-w-5xl px-6 pb-16">
                    <div className="grid gap-4 md:grid-cols-3">
                        {FEATURES.map((f, i) => (
                            <motion.div
                                key={f.title}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                            >
                                <Card className="h-full gap-0">
                                    <CardContent className="flex flex-col gap-3 p-5">
                                        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                            <f.icon className="size-5" data-icon="inline-start" />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <h3 className="text-sm font-semibold">{f.title}</h3>
                                            <p className="text-sm text-muted-foreground">{f.desc}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        ))}
                    </div>
                </section>
            </main>

            {/* 底部 */}
            <footer className="border-t py-6">
                <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-6 text-xs text-muted-foreground md:flex-row">
                    <span>© {new Date().getFullYear()} novi · 隐私是基础，而非附加</span>
                    <div className="flex items-center gap-4">
                        <Link to="/about" className="hover:text-foreground hover:underline underline-offset-4">关于</Link>
                        <Link to="/functional" className="hover:text-foreground hover:underline underline-offset-4">功能</Link>
                        <a
                            href="mailto:heizuboriyo@gmail.com"
                            className="hover:text-foreground hover:underline underline-offset-4"
                        >
                            联系
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
