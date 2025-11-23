import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const mockMessages = [
    { from: "friend", text: "嘿，你上线啦？", time: "10:01" },
    { from: "me", text: "嗯呢，我来测试聊天功能。", time: "10:02" },
    { from: "friend", text: "UI 看起来不错！", time: "10:03" },
    { from: "me", text: "我在继续完善整体体验。", time: "10:04" },
    { from: "friend", text: "加油 💪", time: "10:05" },
];

export default function MessagePanel({ friend }: { friend: any, user?: any }) {
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState(mockMessages);

    if (!friend) {
        return (
            <div className="flex items-center justify-center text-gray-500">
                请选择一个好友开始聊天
            </div>
        );
    }

    const sendMessage = () => {
        if (!input.trim()) return;

        setMessages([
            ...messages,
            {
                from: "me",
                text: input,
                time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
            }
        ]);
        setInput("");
    };

    return (
        <Card className="h-full rounded-none shadow-sm border-l flex flex-col">
            {/* 顶部好友信息 */}
            <div className="p-4 border-b">
                <p className="text-lg font-semibold">{friend.userName}</p>
                <p className="text-xs text-gray-600">{friend.email}</p>
            </div>

            {/* 消息内容 */}
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
                        >
                            <div
                                className={`
                                    max-w-xs px-4 py-2 rounded-2xl text-sm shadow
                                    ${msg.from === "me"
                                        ? "bg-gray-900 text-white"
                                        : "bg-gray-200 text-gray-900"}
                                `}
                            >
                                {msg.text}
                                <div className="text-[10px] opacity-60 mt-1 text-right">
                                    {msg.time}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            {/* 底部输入框 */}
            <div className="p-4 border-t flex gap-2">
                <Input
                    placeholder="输入消息…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                />
                <Button onClick={sendMessage}>发送</Button>
            </div>
        </Card>
    );
}
