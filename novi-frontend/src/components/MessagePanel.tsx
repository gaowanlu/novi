import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    ArrowDown,
    Check,
    CheckCheck,
    Clock3,
    Lock,
    MessageCircle,
    Plus,
    SendHorizontal,
    ShieldAlert,
    ShieldCheck
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import {
    Message,
    MessageContent,
    MessageFooter,
    MessageHeader,
    MessageGroup
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker } from "@/components/ui/marker";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiFetch, parseJson, errorText } from "@/api/request";
import { APIMacro } from "@/api/APIMacro";
import type { FriendMessageItem, ChatUser, SelectedFriend } from "@/api/types";
import {
    encryptMessage,
    decryptMessage,
    publicFingerprint,
    jwkToB64,
    GENESIS_PRE_HASH,
    type DecryptStatus
} from "@/crypto/crypto";
import {
    getTuple,
    getChainHead,
    setChainHead
} from "@/crypto/keyStore";
import { isReady, DEFAULT_NOVI_CODE, resolveCurrentNovicode } from "@/crypto/friendKeys";

const PAGE_SIZE = 30;
// 后端 markreaded / crypto/ack 对 messageIds 设 .max(200)，超限返回 400。
// 前端提交前按此上限切片分批，避免大 backlog（多会话×每窗口30条）整批被拒导致 ack/已读静默丢失。
const BATCH_SIZE = 200;

// 头像底色：品牌绿；在白底面板上更亮、在绿色头部/深色上更深，保证两种场景下都可辨识
const AVATAR_BG_CLASS = "bg-[oklch(0.8_0.17_158)] dark:bg-[oklch(0.62_0.14_160)]";

/** 解密后的本地视图：在服务端密文消息上叠加明文/校验状态/指纹 */
interface DisplayMessage extends FriendMessageItem {
    plain?: string | null;        // 解密出的明文（乐观占位先存输入文本；刷新后由解密回填，双向皆可）
    verifyStatus?: DecryptStatus | "mine" | "pending";
    fingerprint?: string | null;  // 本条签名方公钥指纹（校验通过后，仅对方消息展示）
}

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

const formatDay = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return "今天";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "昨天";
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
};

/** 消息状态图标：未读=单勾，已读=双勾 */
const ReadTicks = ({ read, sending }: { read: boolean; sending: boolean }) => {
    if (sending) return <Clock3 data-icon="inline-end" className="size-3.5 text-[#8ed6bb]" aria-label="发送中" />;
    if (read) return <CheckCheck data-icon="inline-end" className="size-3.5 text-[#8ed6bb]" aria-label="对方已读" />;
    return <Check data-icon="inline-end" className="size-3.5 text-[#8ed6bb]" aria-label="已送达" />;
};

export default function MessagePanel({
    friend,
    user,
    registerPanel
}: {
    friend: SelectedFriend | null;
    user?: ChatUser | null;
    /** 由 FunctionalPage 注入：WS 推送时向当前会话追加新消息 / 标记已读；传 null 解绑（卸载时） */
    registerPanel?: (
        append: ((m: FriendMessageItem) => void) | null,
        markReaded: ((ids: string[]) => void) | null
    ) => void;
}) {
    const myUserId = user?.userId ?? "";

    const [messages, setMessages] = useState<DisplayMessage[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState("");
    const [nearBottom, setNearBottom] = useState(true);
    const [newCount, setNewCount] = useState(0);
    const [ready, setReady] = useState(false); // 5 元组是否齐全（可加解密）
    const [friendFingerprint, setFriendFingerprint] = useState<string | null>(null);

    const viewportRef = useRef<HTMLDivElement>(null);
    const prevLenRef = useRef(0);
    const prevFriendRef = useRef<string | null>(null);
    const pendingMarkRead = useRef<string[]>([]);
    const flushTimer = useRef<number | null>(null);
    const pendingAck = useRef<string[]>([]);
    const ackTimer = useRef<number | null>(null);
    // processChainMessage 引用 flushAck；用 ref 避免定义顺序循环
    const flushAckRef = useRef<(() => void) | null>(null);
    // 链校验串行队列：同一会话的「验证 / 链头读写」步骤严格排队（根因修复见 enqueueChainStep）
    const chainQueueRef = useRef<Promise<unknown>>(Promise.resolve());
    // 消息列表的 ref 镜像：供链头的「单调推进」判断在异步步骤里读到最新列表
    const messagesRef = useRef<DisplayMessage[]>([]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // 按 ≤BATCH_SIZE 分批提交批量接口（markreaded / crypto/ack）：
    // 后端对 messageIds 有 .max(200) 上限，超限返回 400 会静默丢失整批 ack/已读。
    // 切片并发提交，任一批失败仅影响该批（console.error），不阻塞其它批。
    const submitInBatches = useCallback(
        async (url: string, ids: string[]) => {
            const result: string[] = [];
            const chunks: string[][] = [];
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                chunks.push(ids.slice(i, i + BATCH_SIZE));
            }
            await Promise.all(chunks.map(async (chunk) => {
                const res = await apiFetch(url, {
                    method: "PUT",
                    body: JSON.stringify({ messageIds: chunk })
                });
                const data = await parseJson(res);
                if (!res.ok) throw new Error(errorText(res, data));
                result.push(...chunk);
            }));
            return result;
        },
        []
    );

    // crypto/ack 提交（1秒去抖批量）
    const flushAck = useCallback(async () => {
        if (ackTimer.current) window.clearTimeout(ackTimer.current);
        ackTimer.current = window.setTimeout(async () => {
            const ids = [...pendingAck.current];
            pendingAck.current = [];
            if (ids.length === 0) return;
            try {
                const ok = await submitInBatches(APIMacro.PUTMESSAGE_CRYPTO_ACK, ids);
                setMessages(prev => prev.map(m =>
                    ok.includes(m._id) ? { ...m, cryptoAckAt: m.cryptoAckAt ?? new Date().toISOString() } : m));
            } catch (err: unknown) {
                console.error("crypto ack failed:", err);
            }
        }, 1000);
    }, [submitInBatches]);
    flushAckRef.current = flushAck;

    // 校验 + 展示「一条」消息，expectedPreHash 由调用方显式传入（链头 / 运行中的上一条 currHash）：
    //   - 对方发送：解密（对方公钥包装→自己私钥解）→ 验签（对方公钥）→ 存储 hash 字段比对 → 链衔接。
    //   - 自己发送：用 wrappedKeySelf（自己公钥包装→自己私钥解）自我解密，其余校验相同（验签用自己公钥）。
    //     修复前发的旧消息无 wrappedKeySelf → 退回「仅链衔接」，正文显示 "(自己发送)" 兜底（无法恢复）。
    // 任一步失败 → 展示对应错误徽标，且【不得】crypto/ack、【不得】标已读（ack/已读只针对对方消息）。
    // 返回值：本次推进到的 currHash（成功时为本地重算值，退回链校验时为存储值），供链头推进。
    const processChainMessage = useCallback(
        async (
            m: FriendMessageItem,
            expectedPreHash: string,
            opts: { skipPreCheck?: boolean } = {}
        ): Promise<string | null> => {
            const novicode = m.noviCode || DEFAULT_NOVI_CODE;
            const isMine = m.sender === myUserId;
            const tuple = getTuple(myUserId, friend!.userId, novicode);

            if (isMine) {
                // 自己发的：数据密钥双包装，用 wrappedKeySelf + 自己私钥可回读自己的历史消息。
                const canSelfDecrypt = Boolean(m.wrappedKeySelf) &&
                    Boolean(tuple?.ownPrivateKey?.n) && Boolean(tuple?.ownPublicKey?.n);
                if (!canSelfDecrypt) {
                    // 修复前的旧消息（无 wrappedKeySelf）或本端密钥缺失 → 无法自我解密，
                    // 退回旧行为：只做链衔接，正文靠 "(自己发送)" 兜底显示。
                    const linkOk = opts.skipPreCheck || m.preHash == null || m.preHash === expectedPreHash;
                    setMessages(prev => prev.map(x => x._id === m._id && x.verifyStatus !== "ok"
                        ? { ...x, verifyStatus: linkOk ? "mine" : "chain" } : x));
                    return m.currHash ?? null;
                }
                const selfResult = await decryptMessage({
                    content: m.content,
                    iv: m.iv ?? "",
                    wrappedKey: m.wrappedKeySelf!,
                    sig: m.sig ?? "",
                    preHash: m.preHash ?? "",
                    ownPrivJwk: tuple!.ownPrivateKey,
                    senderPubKeyJwk: tuple!.ownPublicKey,
                    expectedPreHash,
                    storedCurrHash: m.currHash ?? undefined,
                    skipPreCheck: opts.skipPreCheck,
                });
                if (selfResult.status === "ok") {
                    // 自我解密成功 → 回读明文。与旧行为保持一致：自己气泡不显示指纹徽标；
                    // 也不 crypto/ack（ack 只由接收方提交）。
                    setMessages(prev => prev.map(x => x._id === m._id
                        ? { ...x, plain: selfResult.text, verifyStatus: "ok" } : x));
                    return selfResult.currHash;
                }
                // 自我解密失败（本端密钥丢失 / 数据被改）→ 展示对应错误徽标
                setMessages(prev => prev.map(x => x._id === m._id ? { ...x, verifyStatus: selfResult.status } : x));
                return null;
            }

            if (!tuple || !tuple.friendPublicKey?.n) {
                // 5 元组尚未就绪（对方公钥缺失）→ 待握手
                setMessages(prev => prev.map(x => x._id === m._id ? { ...x, verifyStatus: "pending" } : x));
                return null;
            }
            const result = await decryptMessage({
                content: m.content,
                iv: m.iv ?? "",
                wrappedKey: m.wrappedKey ?? "",
                sig: m.sig ?? "",
                preHash: m.preHash ?? "",
                ownPrivJwk: tuple.ownPrivateKey,
                senderPubKeyJwk: tuple.friendPublicKey,
                expectedPreHash,
                storedCurrHash: m.currHash ?? undefined,
                skipPreCheck: opts.skipPreCheck,
            });
            if (result.status === "ok") {
                // 本条签名方公钥指纹（校验通过后展示，供用户核对）
                const fp = await publicFingerprint(jwkToB64(tuple.friendPublicKey));
                setMessages(prev => prev.map(x => x._id === m._id
                    ? { ...x, plain: result.text, verifyStatus: "ok", fingerprint: fp } : x));
                // 解密成功 → crypto/ack（去抖批量）；链头由调用方统一推进
                pendingAck.current.push(m._id);
                flushAckRef.current?.();
                return result.currHash;
            }
            setMessages(prev => prev.map(x => x._id === m._id ? { ...x, verifyStatus: result.status } : x));
            return null;
        },
        // 依赖取 userId 原语（稳定），不取 friend 对象引用，避免父级重渲染导致回调身份变化
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [myUserId, friend?.userId]
    );

    /**
     * 把一个「链校验 / 链头读写」步骤排进本会话的串行队列，步骤按入队顺序逐个执行。
     *
     * 断链根因（消息发太快出现「链断裂」）：此前每条 WS 推送都触发一个 fire-and-forget
     * 的异步验证，连发两条时两个验证任务会在前一个任务【完成之前】读到同一个（旧的）链头；
     * 后一条的 pre 指向前一条的 currHash，与旧链头比对必然失败 → 误判「链断裂」，
     * 链头不推进 → 级联到其后的每一条（且本端下一条也基于旧链头构造，对方端同样断链）。
     * 串行化后，每个步骤执行时读到的都是前序步骤推进过的最新链头，连发消息按序逐条校验。
     */
    const enqueueChainStep = useCallback(
        <T,>(step: () => T | Promise<T>): Promise<T | undefined> => {
            const p = chainQueueRef.current.then(step, step) as Promise<T>;
            // 单个步骤抛错（理论上不会：processChainMessage 返回状态不抛错）不得阻断后续消息
            chainQueueRef.current = p.catch((err) => {
                console.error("chain step failed:", err);
                return undefined;
            });
            return p;
        },
        []
    );

    /**
     * 链头「单调」写入：列表里已存在比候选消息更新、且已由对端校验通过（ok）的消息时，
     * 链头大概率已被推进到候选之后 → 不回写，防止链头回退
     *（链头一旦回退，其后所有消息都会误报「链断裂」，下一条发送也会基于回退的链头）。
     * 只认 ok、不认 mine：「已发但尚未落库回显」的占位消息若比候选「新」（时钟偏差等），
     * 也不应阻止候选写入——占位消息自己的 persist 步骤排在队列更后面，最终会把链头推到最新。
     * 队列串行保证：任何一次短暂回写之后，必然有「更新」的 persist 步骤随后修正。
     */
    const persistChainHeadSafe = useCallback(
        (candidate: { _id: string; sentAt: string }, currHash: string, novicode: string) => {
            if (!friend) return;
            const t = new Date(candidate.sentAt).getTime();
            const hasNewer = messagesRef.current.some(
                x => x._id !== candidate._id &&
                    (x.noviCode || DEFAULT_NOVI_CODE) === novicode && // 只比同代次：跨代次的 sentAt 比较无意义
                    new Date(x.sentAt).getTime() > t &&
                    x.verifyStatus === "ok"
            );
            if (!hasNewer) setChainHead(myUserId, friend.userId, novicode, currHash);
        },
        // 依赖取 userId 原语（稳定），不取 friend 对象引用
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [myUserId, friend?.userId]
    );

    // 校验一整段（可能只覆盖历史中段的）已加载消息窗口：双向消息按时间升序走一遍链。
    //   - 对方消息：完整自校验（解密/验签/存储hash/衔接）；自己消息：完整自校验（自我解密）；
    //     仅修复前的旧消息（无 wrappedKeySelf）退回「仅链衔接」。
    //   - 按代次分段：删除好友后重新添加会产生新代次（旧代次密文用新密钥无法解密），
    //     窗口若混有多代消息（存量/边界数据）则每段是独立哈希链——逐段各自从创世值校验、
    //     各自落库本代链头，绝不让旧代次尾部覆盖新代次的创世链头（重新加好友后「链断裂」的根因）。
    //   - 运行链头 prevHash 从「段首条」开始；首条前驱不在窗口内 → skipPreCheck 只查自洽，
    //     避免因拿不到真正的上一条 currHash 而误报「链断裂」（刷新后历史首条此前正常、刷新后变砖的根因）。
    //   - 每处理完一条即把 prevHash 推进到该条存储的 currHash：单条被篡改/缺失只影响其自身展示，
    //     不级联污染其后所有消息（否则一条坏消息会让整段历史变砖）。
    //   - 仅 persistHead=true（初始加载）时用「段尾 currHash」落库本代链头；
    //     上滑加载更早消息（persistHead=false）时不动链头——它们早于现有链头，回退会倒退链头。
    const verifyChainWindow = useCallback(
        async (windowMsgs: FriendMessageItem[], persistHead: boolean) => {
            if (!friend || windowMsgs.length === 0) return;
            const sorted = [...windowMsgs].sort((a, b) =>
                new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime() ||
                (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
            // 按代次切段（相邻同代次归一段）
            const runs: { novicode: string; msgs: FriendMessageItem[] }[] = [];
            for (const m of sorted) {
                const nc = m.noviCode || DEFAULT_NOVI_CODE;
                const lastRun = runs[runs.length - 1];
                if (lastRun && lastRun.novicode === nc) lastRun.msgs.push(m);
                else runs.push({ novicode: nc, msgs: [m] });
            }
            for (const run of runs) {
                let prevHash: string | null = null;
                for (const m of run.msgs) {
                    await processChainMessage(m, prevHash ?? GENESIS_PRE_HASH, {
                        skipPreCheck: prevHash === null
                    });
                    // 最佳推进：无论本条是否通过，都指向其存储的 currHash，使下一条按「真实前驱」校验。
                    if (m.currHash) prevHash = m.currHash;
                }
                if (persistHead && prevHash) {
                    // 单调写：窗口可能只覆盖历史中段，若本代次之后已有被实时校验推进过的更新消息，
                    // 则保持更靠后的链头，绝不回退
                    persistChainHeadSafe(run.msgs[run.msgs.length - 1], prevHash, run.novicode);
                }
            }
        },
        // 依赖取 userId 原语（稳定）+ processChainMessage；不取 friend 对象引用
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [myUserId, friend?.userId, processChainMessage, persistChainHeadSafe]
    );

    // 已读提交（1秒去抖批量）。只对解密成功（verifyStatus==="ok"）的消息有效。
    const flushMarkRead = useCallback(async () => {
        if (flushTimer.current) window.clearTimeout(flushTimer.current);
        flushTimer.current = window.setTimeout(async () => {
            const ids = [...pendingMarkRead.current];
            pendingMarkRead.current = [];
            if (ids.length === 0) return;
            try {
                const ok = await submitInBatches(APIMacro.PUTMESSAGE_MARKREADED, ids);
                setMessages(prev => prev.map(m =>
                    ok.includes(m._id) ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m));
            } catch (err: unknown) {
                console.error("markreaded failed:", err);
            }
        }, 1000);
    }, [submitInBatches]);

    const markRead = useCallback((ids: string[]) => {
        pendingMarkRead.current.push(...ids);
        flushMarkRead();
    }, [flushMarkRead]);

    // 会话切换：拉取会话并逐条解密；检查 5 元组是否就绪
    useEffect(() => {
        if (!friend) return;
        let cancelled = false;
        prevFriendRef.current = friend.userId;
        prevLenRef.current = 0;
        setNewCount(0);
        setNearBottom(true);
        setFriendFingerprint(null);
        // 切换会话 → 链队列重置，上个会话残留的校验步骤不得混进新会话的链
        chainQueueRef.current = Promise.resolve();

        const loadConversation = async () => {
            setLoading(true);
            setError("");
            setHasMore(false);
            pendingMarkRead.current = [];
            pendingAck.current = [];
            setMessages([]);
            try {
                // 解析当前关系代次（记录值=服务器权威 > 本地已有代次 > "1"）：
                // 删除后重新添加只拉取/校验当前代次——旧代次密文用新密钥无法解密
                const novicode = resolveCurrentNovicode(myUserId, friend.userId, friend.novicode ?? null);
                const ok = isReady(myUserId, friend.userId, novicode);
                setReady(ok);
                if (ok) {
                    const tuple = getTuple(myUserId, friend.userId, novicode);
                    if (tuple?.friendPublicKey?.n) {
                        setFriendFingerprint(await publicFingerprint(jwkToB64(tuple.friendPublicKey)));
                    }
                }
                const res = await apiFetch(
                    `${APIMacro.GETMESSAGE_PULL}?sender=${friend.userId}&novicode=${encodeURIComponent(novicode)}`,
                    { method: "GET" }
                );
                const data = await parseJson(res);
                if (!res.ok) throw new Error(errorText(res, data));
                if (cancelled) return;
                const list = ((data as FriendMessageItem[]) ?? []) as DisplayMessage[];
                setMessages(list);
                prevLenRef.current = list.length;
                setHasMore(list.length >= PAGE_SIZE);

                // 初始加载完成 → 滚动到最新消息（useLayoutEffect 可能因批处理未触发）
                if (list.length > 0) scrollToBottom(false);

                // 整段按时间升序校验（双向都走链）：对方消息完整自校验、自己消息仅链衔接。
                // 窗口首条的前驱不在窗口内 → skipPreCheck 只查自洽；窗口尾部 currHash 落库为链头。
                // 进链队列执行：与实时 WS 消息的校验串行，避免两者并发读写链头互相竞态。
                await enqueueChainStep(() => verifyChainWindow(list, true));

                // 对方发来的、解密成功且未读的 → 标已读
                setMessages(prev => {
                    const toRead = prev
                        .filter(m => m.sender !== myUserId && m.verifyStatus === "ok" && !m.readAt)
                        .map(m => m._id);
                    if (toRead.length) markRead(toRead);
                    return prev;
                });
            } catch (err: unknown) {
                if (!cancelled) {
                    setMessages([]);
                    setError(err instanceof Error ? (err.message || "加载消息失败") : "加载消息失败");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadConversation();
        return () => { cancelled = true; };
        // friend.novicode 变化（删除后重新添加 → 新代次）需重新加载会话
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [friend?.userId, friend?.novicode]);

    // 向父级注册「追加新消息 / 标记已读」回调
    useEffect(() => {
        if (!registerPanel) return;
        if (!friend) {
            registerPanel(() => { }, () => { });
            return;
        }
        registerPanel(
            (m: FriendMessageItem) => {
                if (!m._id || m._id.startsWith("temp-")) return;
                // 已在列表中（例如已被初始窗口拉取覆盖）→ 不再追加、也不再单独校验：
                // 窗口校验已把它算进链，链头已推进过它，再校验必然衔接失败、误报「链断裂」
                // 追加仍走函数式更新去重（同 tick 重复推送安全）
                setMessages(prev => {
                    if (prev.some(x => x._id === m._id)) return prev;
                    return [...prev, m as DisplayMessage];
                });
                // 是否已被列表覆盖，用 ref 判断（供「跳过单独校验」用）
                const existed = messagesRef.current.some(x => x._id === m._id);
                // 自己发的不在此处理（已有本地占位）；
                // 解密成功（verifyStatus 变 ok）时由下方 effect 标已读
                if (m.sender === myUserId || existed) return;
                const novicode = m.noviCode || DEFAULT_NOVI_CODE;
                // 进链队列校验（不再 fire-and-forget）：步骤执行时读「最新」链头，
                // 连发多条时按到达顺序逐条校验；成功后单调推进链头到本条 currHash
                void enqueueChainStep(async () => {
                    // 排队期间可能已被窗口校验覆盖 → 已是 ok 则跳过
                    const dupe = messagesRef.current.find(x => x._id === m._id);
                    if (dupe && dupe.verifyStatus === "ok") return;
                    const head = getChainHead(myUserId, friend.userId, novicode);
                    const newHead = await processChainMessage(m, head);
                    if (newHead) persistChainHeadSafe(m, newHead, novicode);
                });
            },
            (ids: string[]) => {
                if (ids.length === 0) return;
                setMessages(prev => prev.map(x =>
                    ids.includes(x._id) ? { ...x, readAt: x.readAt ?? new Date().toISOString() } : x));
                markRead(ids);
            }
        );
        return () => registerPanel(null, null);
        // 依赖取 userId 原语（稳定）；不取 friend 对象引用
        // enqueueChainStep/persistChainHeadSafe 以 userId 原语为依赖，随 friend 切换同步更新
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [friend?.userId, registerPanel, markRead, processChainMessage, enqueueChainStep, persistChainHeadSafe, myUserId]);

    // 某条消息解密成功后 → 若对方发的且未读，标已读（已读依赖解密成功）
    useEffect(() => {
        const toRead = messages
            .filter(m => m.sender !== myUserId && m.verifyStatus === "ok" && !m.readAt)
            .map(m => m._id);
        if (toRead.length > 0) markRead(toRead);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    const scrollToBottom = useCallback((smooth = false) => {
        const el = viewportRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    }, []);

    // 新消息：在底部附近 → 平滑滚到底；否则累计新消息计数
    // 用 useLayoutEffect 确保 DOM 已更新后再滚动（初始加载/切换会话时内容才刚渲染）
    useLayoutEffect(() => {
        const grew = messages.length - prevLenRef.current;
        prevLenRef.current = messages.length;
        if (grew <= 0) return;
        if (nearBottom) {
            scrollToBottom(true);
            setNewCount(0);
        } else {
            setNewCount(c => c + grew);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length]);

    const handleScroll = useCallback(async () => {
        const el = viewportRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        setNearBottom(atBottom);
        if (atBottom && newCount > 0) setNewCount(0);

        if (el.scrollTop > 80) return;
        if (!friend || loadingOlder || !hasMore || loading) return;
        const oldest = messages[0];
        if (!oldest) return;

        setLoadingOlder(true);
        try {
            const novicode = resolveCurrentNovicode(myUserId, friend.userId, friend.novicode ?? null);
            const res = await apiFetch(
                `${APIMacro.GETMESSAGE_PULL}?sender=${friend.userId}&before=${encodeURIComponent(oldest.sentAt)}&novicode=${encodeURIComponent(novicode)}`,
                { method: "GET" }
            );
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const older = ((data as FriendMessageItem[]) ?? []).reverse();
            if (older.length > 0) {
                const prevHeight = el.scrollHeight;
                const prevTop = el.scrollTop;
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m._id));
                    return [...older.filter(m => !existingIds.has(m._id)), ...prev];
                });
                requestAnimationFrame(() => {
                    el.scrollTop = el.scrollHeight - prevHeight + prevTop;
                });
                // 校验新加载的更早消息（双向走链）。它们早于现有链头 → persistHead=false，不回退链头。
                await verifyChainWindow(older, false);
            }
            if (older.length < PAGE_SIZE) setHasMore(false);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? (err.message || "加载历史消息失败") : "加载历史消息失败");
        } finally {
            setLoadingOlder(false);
        }
    }, [friend, myUserId, loadingOlder, hasMore, loading, messages, newCount, verifyChainWindow]);

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || !friend || sending || !ready) return;

        setSending(true);
        const tempId = `temp-${Date.now()}`;
        // 当前关系代次（与 loadConversation 同算法）：删除后重新添加时发送走新代次的密钥/链
        const novicode = resolveCurrentNovicode(myUserId, friend.userId, friend.novicode ?? null);
        const optimistic: DisplayMessage = {
            _id: tempId,
            noviCode: novicode,
            sender: myUserId,
            receiver: friend.userId,
            content: "",
            sentAt: new Date().toISOString(),
            plain: text,
            verifyStatus: "mine"
        };
        setMessages(prev => [...prev, optimistic]);
        setInput("");
        setNearBottom(true);

        try {
            const tuple = getTuple(myUserId, friend.userId, novicode)!;
            // 在链队列上读链头：等前面排队的实时校验步骤（对方连发消息）全部完成后
            // 再读，保证 pre 衔接在真实尾部；否则会基于过期链头构造，对端判「链断裂」
            const pre = (await enqueueChainStep(() =>
                getChainHead(myUserId, friend.userId, novicode)
            )) ?? GENESIS_PRE_HASH;
            const enc = await encryptMessage({
                text,
                novicode,
                senderId: myUserId,
                receiverId: friend.userId,
                preHash: pre,
                friendPubKeyJwk: tuple.friendPublicKey,
                ownPrivJwk: tuple.ownPrivateKey,
                ownPubKeyJwk: tuple.ownPublicKey
            });
            const res = await apiFetch(APIMacro.POSTMESSAGE, {
                method: "POST",
                body: JSON.stringify({
                    noviCode: novicode,
                    receiver: friend.userId,
                    content: enc.content,
                    iv: enc.iv,
                    wrappedKey: enc.wrappedKey,
                    wrappedKeySelf: enc.wrappedKeySelf,
                    sig: enc.sig,
                    preHash: enc.preHash,
                    currHash: enc.currHash
                })
            });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(errorText(res, data));
            const saved = data as FriendMessageItem;
            // 更新链头：以本端刚算出的 enc.currHash 为准（权威值）；
            // 服务端回显仅比对，不一致说明服务端改写了字段，只告警不采纳。
            if (enc.currHash) {
                if (saved.currHash && saved.currHash !== enc.currHash) {
                    console.warn("服务端回显的 currHash 与本地计算不一致（可能被篡改）", saved._id);
                }
                // 进链队列单调写：等待期间若对方的更新消息已先推进链头，
                // 则不回退（persistChainHeadSafe 内部判断）
                void enqueueChainStep(() => persistChainHeadSafe(saved, enc.currHash, novicode));
            }
            setMessages(prev => prev.map(m => (m._id === tempId
                ? { ...saved, plain: text, verifyStatus: "mine" } : m)));
        } catch (err: unknown) {
            toast.error(err instanceof Error ? (err.message || "发送失败") : "发送失败");
            setMessages(prev => prev.filter(m => m._id !== tempId));
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            sendMessage();
        }
    };

    // 按日期分组
    const groups = useMemo(() => {
        const sorted = [...messages].sort((a, b) => {
            const d = new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
            return d !== 0 ? d : a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
        });
        const out: { day: string; items: DisplayMessage[] }[] = [];
        for (const m of sorted) {
            const day = formatDay(m.sentAt);
            const last = out[out.length - 1];
            if (last && last.day === day) last.items.push(m);
            else out.push({ day, items: [m] });
        }
        return out;
    }, [messages]);

    if (!friend) {
        return (
            <section className="chat-wallpaper flex h-full min-h-0 flex-col items-center justify-center gap-5 px-6 text-center">
                <div className="flex size-20 items-center justify-center rounded-full bg-white/70 shadow-sm ring-1 ring-wa-line backdrop-blur dark:bg-black/30">
                    <Lock className="size-8 text-wa-700" />
                </div>
                <div className="flex flex-col gap-1.5">
                    <h2 className="text-lg font-semibold text-wa-ink">选择一个好友开始聊天</h2>
                    <p className="max-w-xs text-sm text-wa-muted">
                        每段友谊都拥有独立的加密密钥对，平台永远无法读取你的内容。
                    </p>
                </div>
                <Button asChild className="mt-1">
                    <Link to="/new/friend">
                        <Plus data-icon="inline-start" className="size-4" />
                        添加好友
                    </Link>
                </Button>
            </section>
        );
    }

    return (
        <section className="chat-wallpaper flex h-full min-h-0 flex-1 flex-col text-wa-bubble-fg">
            {/* 顶栏 */}
            <header className="flex h-16 items-center gap-3 bg-wa-header px-3 text-wa-header-fg">
                <Avatar className="size-10 shrink-0">
                    <AvatarFallback className={AVATAR_BG_CLASS + " text-sm font-medium text-wa-header-fg"}>
                        {friend.userName?.trim()?.slice(0, 2) || "?"}
                    </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[15px] font-semibold">{friend.userName}</span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-white/75">
                        <Lock data-icon="inline-start" className="size-3" />
                        端到端加密
                        {friendFingerprint && (
                            <span className="font-mono" title="对方公钥指纹，请线下核对以防中间人">
                                · {friendFingerprint}
                            </span>
                        )}
                    </span>
                </div>
            </header>

            {/* 密钥未就绪提示 */}
            {!ready && (
                <div className="flex items-center gap-2 border-b border-wa-line bg-wa-bubble-in px-4 py-1.5 text-xs text-wa-panel-fg">
                    <ShieldAlert data-icon="inline-start" className="size-3.5 shrink-0 text-destructive" />
                    尚未建立加密密钥（需双方都完成好友接受流程）。请在「新朋友」里重新接受该好友关系。
                </div>
            )}

            {/* 消息区 */}
            <div className="relative min-h-0 flex-1">
                <div
                    ref={viewportRef}
                    onScroll={handleScroll}
                    className="h-full overflow-y-auto scroll-smooth px-4 py-4 md:px-8"
                >
                    {loading ? (
                        <div className="flex flex-col gap-6">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                                    <Skeleton className="h-10 w-56 rounded-2xl" />
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="flex h-full items-center justify-center">
                            <Badge variant="destructive">{error}</Badge>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                            <Badge variant="secondary" className="gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs text-wa-muted dark:bg-black/30">
                                <Lock data-icon="inline-start" className="size-3" />
                                消息受端到端加密保护
                            </Badge>
                            <p className="mt-2 text-sm text-wa-muted">还没有消息，打个招呼吧</p>
                        </div>
                    ) : (
                        <div className="mx-auto flex max-w-3xl flex-col gap-1">
                            {loadingOlder && (
                                <div className="mb-2 flex justify-center">
                                    <Badge variant="secondary" className="gap-1.5 rounded-full text-xs">
                                        <Skeleton className="size-3 rounded-full" />
                                        加载更早的消息…
                                    </Badge>
                                </div>
                            )}
                            {groups.map(group => (
                                <div key={group.day} className="flex flex-col gap-1">
                                    <Marker variant="separator" className="my-3 [&_span]:mx-0">
                                        <Badge variant="secondary" className="gap-1.5 rounded-md bg-wa-bubble px-2.5 py-1 text-[11px] font-medium text-wa-muted shadow-sm hover:bg-wa-bubble">
                                            <Lock data-icon="inline-start" className="size-3" />
                                            {group.day}
                                        </Badge>
                                    </Marker>
                                    <MessageGroup>
                                        {group.items.map(msg => {
                                            const mine = msg.sender === myUserId;
                                            const isTemp = msg._id.startsWith("temp-");
                                            const body = renderBody(msg);
                                            return (
                                                <Message key={msg._id} align={mine ? "end" : "start"}>
                                                    <MessageContent>
                                                        <MessageHeader className="px-2 text-wa-muted">
                                                            {!mine && <span>{friend.userName}</span>}
                                                        </MessageHeader>
                                                        <Bubble
                                                            variant={body.failed ? "destructive" : mine ? "default" : "secondary"}
                                                            align={mine ? "end" : "start"}
                                                        >
                                                            <BubbleContent
                                                                className={
                                                                    mine
                                                                        ? "rounded-xl rounded-tr-[3px] bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]"
                                                                        : "rounded-xl rounded-tl-[3px] bg-white text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]"
                                                                }
                                                            >
                                                                <p className="whitespace-pre-wrap break-words">{body.text}</p>
                                                                {body.badge && body.badge}
                                                            </BubbleContent>
                                                            <MessageFooter className="gap-1 px-3 text-[11px]">
                                                                <span className="tabular-nums text-wa-muted">
                                                                    {formatTime(msg.sentAt)}
                                                                </span>
                                                                {msg.fingerprint && !body.failed && (
                                                                    <span
                                                                        className="inline-flex items-center gap-0.5 font-mono text-[10px] text-wa-muted"
                                                                        title={`签名指纹 ${msg.fingerprint}（与头部一致即未被篡改）`}
                                                                    >
                                                                        <ShieldCheck data-icon="inline-start" className="size-3" />
                                                                        {msg.fingerprint.slice(0, 8)}
                                                                    </span>
                                                                )}
                                                                {mine && (
                                                                    <ReadTicks read={Boolean(msg.readAt)} sending={isTemp} />
                                                                )}
                                                            </MessageFooter>
                                                        </Bubble>
                                                    </MessageContent>
                                                </Message>
                                            );
                                        })}
                                    </MessageGroup>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 跳转到最新 */}
                {!nearBottom && !loading && messages.length > 0 && (
                    <button
                        type="button"
                        onClick={() => { scrollToBottom(true); setNewCount(0); }}
                        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-wa-line bg-white px-3 py-1.5 text-xs font-medium text-wa-ink shadow-md transition-colors hover:bg-wa-bubble-in dark:bg-[#202c33] dark:text-wa-panel-fg"
                    >
                        {newCount > 0 && (
                            <Badge className="h-4 min-w-4 gap-0 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                                {newCount}
                            </Badge>
                        )}
                        <ArrowDown data-icon="inline-start" className="size-3.5" />
                        最新消息
                    </button>
                )}
            </div>

            {/* 输入区：纯文字消息 */}
            <footer className="flex items-center gap-2 border-t border-wa-line bg-[#f0f2f5] px-3 py-2.5 md:px-4 dark:bg-[#202c33]">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-transparent bg-white px-4 focus-within:border-wa-line dark:bg-[#233138]">
                    <MessageCircle className="size-5 shrink-0 text-wa-muted" data-icon="inline-start" />
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={ready ? "输入消息…" : "密钥未就绪，无法发送"}
                        aria-label="消息内容"
                        disabled={!ready}
                        className="h-9 min-w-0 flex-1 bg-transparent text-sm text-wa-ink outline-none placeholder:text-wa-muted disabled:opacity-50"
                    />
                </div>
                <Button
                    size="icon"
                    className="size-10 shrink-0 rounded-full"
                    onClick={sendMessage}
                    disabled={!input.trim() || sending || !ready}
                    aria-label="发送"
                >
                    <SendHorizontal className="-rotate-45" />
                </Button>
            </footer>
        </section>
    );
}

/** 渲染一条消息正文 + 校验徽标 */
function renderBody(msg: DisplayMessage): { text: string; failed: boolean; badge?: React.ReactNode } {
    if (msg.verifyStatus === "mine") {
        return { text: msg.plain ?? "(自己发送)", failed: false };
    }
    if (msg.verifyStatus === "ok") {
        return { text: msg.plain ?? "", failed: false };
    }
    if (msg.verifyStatus === "pending") {
        return { text: "正在解密…", failed: false };
    }
    // 校验失败
    const map: Record<string, { text: string; badge: string }> = {
        decrypt: { text: "⚠ 无法解密（密钥不匹配或已丢失）", badge: "解密失败" },
        signature: { text: "⚠ 签名校验失败（可能被篡改）", badge: "签名不符" },
        chain: { text: "⚠ 链校验失败（消息被删/被改/顺序错乱）", badge: "链断裂" }
    };
    const m = map[msg.verifyStatus ?? ""] ?? { text: "⚠ 无法验证该消息", badge: "校验失败" };
    return { text: m.text, failed: true, badge: <Badge variant="destructive" className="ml-2">{m.badge}</Badge> };
}


