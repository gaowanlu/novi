import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { APIMacro } from "@/api/APIMacro";
import { useAuth } from "@/context/AuthContext";

/**
 * novi Socket.IO 连接管理器
 *
 * 职责：登录后建立到 /api/ws 的长连接，承载服务端 → 客户端的实时事件推送
 * （新消息、已读回执、好友申请等）。消息数据仍走 HTTP 拉取，WS 只负责及时通知，
 * 这样多节点部署下推送天然可靠（在线状态在 Redis，跨节点经 RabbitMQ 转发）。
 *
 * 事件名与后端约定一致（见 novi-backend/docs/plan.md）：
 *   novi_friend_request_comming / novi_friend_request_processed / novi_friend_friend_deleted
 *   novi_friend_message_comming / novi_friend_message_readed / novi_friend_message_crypto_ack
 */
export type NoviSocketEvent =
    | "novi_friend_request_comming"
    | "novi_friend_request_processed"
    | "novi_friend_friend_deleted"
    | "novi_friend_message_comming"
    | "novi_friend_message_readed"
    | "novi_friend_message_crypto_ack";

type Handler = (payload: any) => void;

let socket: Socket | null = null;
// 所有已注册监听：event -> handler 列表。每次（重）连接成功时统一挂载，
// 保证「先注册后连接」「连接中断后重连」两种顺序都能正确收到推送。
const handlersByEvent = new Map<NoviSocketEvent, Handler[]>();

/** 当前是否已登录（模块级读取，不触发 React 渲染） */
function isLoggedIn(): boolean {
    return Boolean(localStorage.getItem("jwtToken") && localStorage.getItem("userInfo"));
}

/** 把所有已注册监听挂到 socket 上 */
function attachAll(s: Socket): void {
    handlersByEvent.forEach((handlers, event) => {
        handlers.forEach(h => s.on(event, h));
    });
}

/** 建立连接（幂等：已存在则直接复用） */
export function ensureNoviSocket(): Socket | null {
    if (socket) return socket;
    if (!isLoggedIn()) return null;

    const token = localStorage.getItem("jwtToken");
    if (!token) return null;

    const host = APIMacro.HOST.replace(/^http/, "ws");
    socket = io(host, {
        path: "/api/ws",
        auth: { token },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 15000,
        timeout: 10000,
    });

    // 每次（重）连接成功：恢复全部监听
    socket.on("connect", () => attachAll(socket!));

    // 服务端鉴权失败（如 token 失效）：停止重连并清理，回到登录页。
    // 其余错误（网络抖动）交给 socket.io 自动重连。
    socket.on("connect_error", (err: Error) => {
        const msg = String(err?.message ?? "");
        if (msg.includes("认证")) {
            socket?.disconnect();
            socket = null;
            handlersByEvent.clear();
            localStorage.removeItem("jwtToken");
            localStorage.removeItem("userInfo");
            window.location.href = "/signin";
        }
    });

    // 页面关闭时断开，避免残留连接
    window.addEventListener("beforeunload", () => socket?.disconnect());

    // 若创建时已连接（极少见），立即挂载
    if (socket.connected) attachAll(socket);

    return socket;
}

/**
 * 订阅事件。登录态下返回当前 socket；未登录返回 null（登录流程完成后由调用方重试）。
 * 组件卸载时移除监听。
 */
export function useNoviSocketEvent(event: NoviSocketEvent, handler: Handler): Socket | null {
    const { token, tokenVerified } = useAuth();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    const s = (token && tokenVerified) ? ensureNoviSocket() : null;

    // 注册/反注册放进 effect 而不是渲染期：渲染期重复调用（StrictMode 双挂载、
    // 父级重渲染）会让同一事件挂上多个监听，一次推送触发多次回调。
    // effect 卸载时移除监听，保证「一事件一订阅」。
    useEffect(() => {
        if (!s) return;
        // 包装一层：实际回调读最新 handler，避免闭包过期
        const wrapped: Handler = (payload) => handlerRef.current(payload);
        const list = handlersByEvent.get(event) ?? [];
        list.push(wrapped);
        handlersByEvent.set(event, list);
        // 已连接则立即挂载；未连接（首次/重连中）会在 connect 回调里统一挂载
        if (s.connected) s.on(event, wrapped);
        return () => {
            const cur = handlersByEvent.get(event) ?? [];
            const idx = cur.indexOf(wrapped);
            if (idx >= 0) cur.splice(idx, 1);
            s.off(event, wrapped);
        };
        // 注意：handler 变化不触发重新注册，wrapped 经 handlerRef 永远读最新值
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [s, event]);

    return s;
}
