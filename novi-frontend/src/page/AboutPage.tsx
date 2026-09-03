import { Link } from 'react-router-dom';
import {
    Lock,
    ShieldCheck,
    Zap,
    ArrowRight,
    Mail,
    KeyRound
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const PRINCIPLES = [
    {
        icon: KeyRound,
        title: '密钥永不离开设备',
        desc: '所有密钥对均由客户端生成，服务端无法读取任何内容。'
    },
    {
        icon: ShieldCheck,
        title: '无后门 · 无托管密钥',
        desc: '用户控制权永远优先，只有聊天双方设备能解密内容。'
    },
    {
        icon: Zap,
        title: '最小数据收集',
        desc: '仅保留最低限度的数据，隐私是设计的第一原则。'
    }
];

export default function AboutPage() {
    return (
        <div className="flex min-h-dvh flex-col bg-background">
            <header className="border-b px-6 py-3">
                <div className="mx-auto flex w-full max-w-4xl items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <Lock className="size-4" data-icon="inline-start" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">关于 novi</span>
                </div>
            </header>

            <main className="flex-1 px-6 py-12">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
                    {/* Hero */}
                    <section className="flex flex-col gap-4">
                        <Badge variant="secondary" className="w-fit gap-1.5 rounded-full px-3 py-1 text-xs">
                            <Lock data-icon="inline-start" className="size-3" />
                            端对端加密 · 隐私优先
                        </Badge>
                        <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
                            novi, no way.
                        </h1>
                        <p className="max-w-2xl text-lg text-muted-foreground">
                            Each friendship, a unique encryption pair the platform can never see.
                        </p>
                        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                            我们相信隐私是基础，而非附加。每段友谊都拥有独立的加密密钥对，
                            密钥只存在于你和好友的设备之间 —— 服务器永远只看到密文。
                        </p>
                    </section>

                    <Separator />

                    {/* 理念 */}
                    <section className="grid gap-4 md:grid-cols-3">
                        {PRINCIPLES.map(p => (
                            <Card key={p.title} className="gap-0">
                                <CardContent className="flex flex-col gap-3 p-5">
                                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                        <p.icon className="size-5" data-icon="inline-start" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <h3 className="text-sm font-semibold">{p.title}</h3>
                                        <p className="text-sm text-muted-foreground">{p.desc}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </section>

                    <Separator />

                    {/* 联系 + CTA */}
                    <section className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
                        <div className="flex flex-col gap-1">
                            <p className="text-xs text-muted-foreground">有问题？联系我们</p>
                            <a
                                href="mailto:heizuboriyo@gmail.com"
                                className="flex items-center gap-1.5 text-sm font-medium hover:underline underline-offset-4"
                            >
                                <Mail data-icon="inline-start" className="size-4" />
                                heizuboriyo@gmail.com
                            </a>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button asChild variant="ghost">
                                <Link to="/functional">了解功能</Link>
                            </Button>
                            <Button asChild className="gap-2">
                                <Link to="/signup">
                                    开始使用
                                    <ArrowRight data-icon="inline-end" className="size-4" />
                                </Link>
                            </Button>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
