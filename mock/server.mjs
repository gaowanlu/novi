// novi-mock —— 独立的后端接口 mock 服务
//
// 用途：让前端不依赖真实后端（Mongo / Redis / RabbitMQ / Kafka）也能完整演示与联调。
//   - 纯内存数据，重启即重置，不碰任何真实工程代码，不污染 novi-frontend / novi-backend。
//   - 复刻 novi-backend 的 HTTP 契约（路由、字段、错误体），但不含 Socket.IO ——
//     前端当前只走 HTTP 轮询（见 FunctionalPage / MessagePanel），所以不需要 WebSocket。
//
// 运行：
//   cd mock && npm install && npm start   # 监听 NOVI_MOCK_PORT，默认 3300
//
// 前端接入（两种方式，见 README）：
//   1) 推荐：vite 代理 /api → 本服务。此时前端 .env 里 VITE_NOVI_HOST=http://localhost:5173，
//      前端照旧调用 `${HOST}/api/...`，请求被代理到本服务。前后端工程零改动。
//   2) 直连：前端 .env 里 VITE_NOVI_HOST=http://127.0.0.1:3300（本服务已开 CORS）。
//
// 演示账号：demo@novi.chat / demo123456（另有 friend@novi.chat 作为预置好友）。

import express from "express";
import cors from "cors";

const PORT = parseInt(process.env.NOVI_MOCK_PORT ?? "3300", 10);
const HOST = process.env.NOVI_MOCK_HOST ?? "0.0.0.0";

// ---------------------------------------------------------------------------
// 内存数据：用户 / 好友关系 / 消息（重启即重置）
// ---------------------------------------------------------------------------
const users = new Map(); // _id -> { _id, userName, email, password }
const friendRequests = new Map(); // id -> { _id, requester, receiver, status, createdAt, respondedAt }
const messages = []; // [{ _id, noviCode, sender, receiver, content, sentAt, readAt, cryptoAckAt }]

let reqCounter = 0;
const nextReqId = () => `req${(reqCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const nextMsgId = () => `msg${(messages.length + 1).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const iso = (d = new Date()) => d.toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// 把内存里的原始关系记录转成前端消费的聚合结构（对齐 GET /api/friend 的返回）
const toFriendRequestItem = (rec) => ({
    friendRequestId: rec._id,
    status: rec.status,
    createdAt: rec.createdAt,
    respondedAt: rec.respondedAt ?? null,
    requester: {
        userId: rec.requester,
        userName: users.get(rec.requester)?.userName ?? "对方账号已注销",
    },
    receiver: {
        userId: rec.receiver,
        userName: users.get(rec.receiver)?.userName ?? "对方账号已注销",
    },
});

// ---------------------------------------------------------------------------
// 种子数据
// ---------------------------------------------------------------------------
const seed = () => {
    // 预置用户
    const demo = { _id: "user_demo_0001", userName: "演示用户", email: "demo@novi.chat", password: "demo123456" };
    const friend = { _id: "user_friend_02", userName: "好友小明", email: "friend@novi.chat", password: "friend12345" };
    users.set(demo._id, demo);
    users.set(friend._id, friend);

    // 一条已接受的好友关系：demo <-> friend（requester 为 friend，receiver 为 demo，
    // 这样前端在 demo 视角下「好友」取自 requester 一侧）
    const fr = {
        _id: nextReqId(),
        requester: friend._id,
        receiver: demo._id,
        status: "accepted",
        createdAt: ago(1000 * 60 * 60 * 24 * 2), // 两天前
        respondedAt: ago(1000 * 60 * 60 * 24 * 2 - 1000 * 60 * 5),
    };
    friendRequests.set(fr._id, fr);

    // 一段与 demo 的对话：既有对方发的（含未读，用于演示未读角标 + 拉取），也有 demo 发的
    const t = Date.now();
    const push = (sender, receiver, content, sentAt, readAt = null) => {
        messages.push({
            _id: nextMsgId(),
            noviCode: "1",
            sender,
            receiver,
            content,
            sentAt,
            readAt,
            cryptoAckAt: null,
        });
    };
    // 较早的历史（已被读过）
    push(friend._id, demo._id, "嗨，最近忙什么？", ago(1000 * 60 * 60 * 5), iso());
    push(demo._id, friend._id, "在捣鼓 novi 的端到端加密方案", ago(1000 * 60 * 60 * 5 - 1000 * 60 * 3));
    push(friend._id, demo._id, "听起来很酷，进展如何？", ago(1000 * 60 * 60 * 5 - 1000 * 60 * 1), iso());
    // 未读：对方刚发来的两条（readAt 为空，会触发未读角标）
    push(friend._id, demo._id, "我这边密钥五元组已经跑通了", ago(1000 * 60 * 2));
    push(friend._id, demo._id, "有空把 crypto/ack 那块一起看看吗？", ago(1000 * 60 * 1));
    // t 目前未直接使用，保留便于后续按绝对时间造数据
    void t;
};
seed();

// ---------------------------------------------------------------------------
// 中间件
// ---------------------------------------------------------------------------
const app = express();
app.use(cors()); // 开发期最宽松，直连方式下前端跨域可用
app.use(express.json());

app.use((req, res, next) => {
    // eslint-disable-next-line no-console
    console.log(`[mock] ${req.method} ${req.originalUrl}`);
    next();
});

// 从 Authorization 头解析出当前用户（mock 不做真实 JWT 校验，只认「带了 Bearer 头」即视为已登录）
const requireAuth = (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
        res.status(401).json({ message: "未提供token" });
        return;
    }
    // token 约定为登录时签发的 userId（见 /login）。便于 mock 直接定位用户。
    const user = users.get(token);
    if (!user) {
        res.status(401).json({ message: "Token已失效" });
        return;
    }
    req.noviUser = user;
    next();
};

// 统一错误出口
const fail = (res, status, message) => res.status(status).json({ message });

// ---------------------------------------------------------------------------
// /api/auth
// ---------------------------------------------------------------------------
app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body ?? {};
    const user = [...users.values()].find((u) => u.email === email);
    if (!user) return fail(res, 400, "用户未注册");
    if (user.password !== password) return fail(res, 400, "密码不正确请重试");
    // 用 userId 充当 token：mock 无 JWT，前端只把它当不透明串存起来回传
    res.status(200).json({
        jwtToken: user._id,
        userId: user._id,
        userName: user.userName,
        email: user.email,
    });
});

app.get("/api/auth/token/verify", requireAuth, (_req, res) => {
    res.status(200).json({});
});

app.get("/api/auth/heartbeat", requireAuth, (_req, res) => {
    res.status(200).json({ message: "心跳成功 已续费" });
});

app.get("/api/auth/logout", requireAuth, (_req, res) => {
    res.status(200).json({ message: "成功登出" });
});

// ---------------------------------------------------------------------------
// /api/user
// ---------------------------------------------------------------------------
// 注册
app.post("/api/user", (req, res) => {
    const { userName, email, password } = req.body ?? {};
    if (!userName || !email || !password) return fail(res, 400, "请求参数不符合要求");
    if ([...users.values()].some((u) => u.userName === userName)) return fail(res, 400, "用户名已被占用");
    if ([...users.values()].some((u) => u.email === email)) return fail(res, 400, "邮箱已被注册");
    const newUser = {
        _id: `user_${email.replace(/[^a-z0-9]/gi, "").slice(0, 10)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
        userName,
        email,
        password,
    };
    users.set(newUser._id, newUser);
    res.status(200).json({ _id: newUser._id, userName, email });
});

// 修改个人信息
app.put("/api/user", requireAuth, (req, res) => {
    const { _id, userName, email } = req.body ?? {};
    const user = users.get(_id ?? req.noviUser._id);
    if (!user) return fail(res, 404, "请求的资源不存在");
    if (userName) user.userName = userName;
    if (email) user.email = email;
    res.status(200).json({ _id: user._id, userName: user.userName, email: user.email });
});

// 搜索用户：{ userName, _id } 任一即可
app.post("/api/user/find", (req, res) => {
    const { userName, _id } = req.body ?? {};
    const list = [...users.values()].filter((u) => {
        const hitName = userName && (u.userName === userName || u.userName.includes(userName));
        const hitId = _id && u._id === _id;
        return hitName || hitId;
    });
    res.status(200).json(list.map((u) => ({ _id: u._id, userName: u.userName })));
});

// ---------------------------------------------------------------------------
// /api/friend
// ---------------------------------------------------------------------------
// 获取好友列表（仅 accepted）
app.get("/api/friend", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const list = [...friendRequests.values()]
        .filter((r) => r.status === "accepted" && (r.requester === me || r.receiver === me))
        .map(toFriendRequestItem);
    res.status(200).json(list);
});

// 获取自己相关的所有好友申请/关系记录
app.get("/api/friend/request", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const list = [...friendRequests.values()]
        .filter((r) => r.requester === me || r.receiver === me)
        .map(toFriendRequestItem);
    res.status(200).json(list);
});

// 发起好友申请
app.post("/api/friend/request", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { targetUserId } = req.body ?? {};
    if (me === targetUserId) return fail(res, 400, "不能添加自己为好友");
    if (!users.has(targetUserId)) return fail(res, 400, "目标用户不存在");
    // 已存在 accepted / pending 则直接返回现有记录（与后端一致）
    const found = [...friendRequests.values()].find(
        (r) =>
            ["accepted", "pending"].includes(r.status) &&
            ((r.requester === me && r.receiver === targetUserId) ||
                (r.requester === targetUserId && r.receiver === me))
    );
    if (found) {
        return res.status(200).json(toFriendRequestItem(found));
    }
    const rec = {
        _id: nextReqId(),
        requester: me,
        receiver: targetUserId,
        status: "pending",
        createdAt: iso(),
        respondedAt: null,
    };
    friendRequests.set(rec._id, rec);
    res.status(200).json(toFriendRequestItem(rec));
});

// 同意 / 拒绝好友申请（只有 receiver 能处理，且必须 pending）
app.put("/api/friend/request", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { friendRequestId, status } = req.body ?? {};
    const rec = friendRequests.get(friendRequestId);
    if (!rec) return fail(res, 400, "未找到目标申请记录");
    if (me !== rec.receiver) return fail(res, 400, "这不是向您发起的好友申请");
    if (rec.status !== "pending") return fail(res, 400, "无法重复处理目标好友申请");
    if (status !== "accepted" && status !== "rejected") {
        return fail(res, 400, "指定status不符合要求 必须是 accepted or rejected");
    }
    rec.status = status;
    rec.respondedAt = iso();
    res.status(200).json(toFriendRequestItem(rec));
});

// 删除好友关系
app.delete("/api/friend", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { targetUserId, friendRequestId } = req.query;
    const rec = [...friendRequests.values()].find(
        (r) =>
            r.status === "accepted" &&
            (r._id === friendRequestId ||
                (r.requester === me && r.receiver === targetUserId) ||
                (r.requester === targetUserId && r.receiver === me))
    );
    if (!rec) return fail(res, 400, "在非好友状态下无法解除好友关系");
    rec.status = "deleted";
    res.status(200).json(toFriendRequestItem(rec));
});

// 撤销自己发起的好友申请（必须是自己发出且 pending）
app.delete("/api/friend/request", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { friendRequestId } = req.query;
    const rec = friendRequests.get(friendRequestId);
    if (!rec || rec.requester !== me || rec.status !== "pending") {
        return fail(res, 400, "找不到符合要求的好友申请");
    }
    rec.status = "canceled";
    res.status(200).json(toFriendRequestItem(rec));
});

// ---------------------------------------------------------------------------
// /api/message
// ---------------------------------------------------------------------------
// 发送消息
app.post("/api/message", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { noviCode, receiver, content } = req.body ?? {};
    if (receiver === me) return fail(res, 400, "无法向自己发送消息");
    if (!users.has(receiver)) return fail(res, 400, "目标用户不存在");
    const isFriend = [...friendRequests.values()].some(
        (r) =>
            r.status === "accepted" &&
            ((r.requester === me && r.receiver === receiver) || (r.requester === receiver && r.receiver === me))
    );
    if (!isFriend) return fail(res, 400, "不能向非好友用户发送消息");

    const msg = {
        _id: nextMsgId(),
        noviCode: noviCode ?? "1",
        sender: me,
        receiver,
        content,
        sentAt: iso(),
        readAt: null,
        cryptoAckAt: null,
    };
    messages.push(msg);
    res.status(200).json(msg);
});

// 拉取与某好友的会话。sender 实际指「会话对端」。
//   - ?before=<iso>  拉取该时间之前的历史（倒序取 30 条再反转为正序）
//   - 无 before       若存在未读（对方发给我且 readAt 为空），返回未读点前后各 30 条；否则返回最新 10 条
app.get("/api/message/pull/unread/byfriend", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const peer = req.query.sender;
    const before = req.query.before ? new Date(req.query.before) : null;

    const conv = messages
        .filter(
            (m) =>
                (m.sender === peer && m.receiver === me) ||
                (m.sender === me && m.receiver === peer)
        )
        .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));

    if (before) {
        const older = conv
            .filter((m) => new Date(m.sentAt) <= before)
            .slice(-30); // 正序的最后 30 条
        return res.status(200).json(older);
    }

    const firstUnread = conv.find((m) => m.sender === peer && !m.readAt);
    if (!firstUnread) {
        return res.status(200).json(conv.slice(-10)); // 无未读：最新 10 条
    }
    // 有未读：未读点之前最多 30 条 + 未读点起最多 30 条（保持正序）
    const idx = conv.indexOf(firstUnread);
    const prev = conv.slice(Math.max(0, idx - 30), idx);
    const after = conv.slice(idx, idx + 30);
    res.status(200).json([...prev, ...after]);
});

// 全部好友未读汇总（FunctionalPage 轮询用）
app.get("/api/message/allfriend", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    // 按发送者分组统计未读，取每组最新一条
    const bySender = new Map();
    for (const m of messages) {
        if (m.receiver !== me || m.readAt) continue;
        const g = bySender.get(m.sender) ?? { count: 0, latest: m };
        g.count += 1;
        if (new Date(m.sentAt) > new Date(g.latest.sentAt)) g.latest = m;
        bySender.set(m.sender, g);
    }
    const list = [...bySender.entries()]
        .map(([sender, g]) => ({
            sender,
            unreadCount: g.count,
            content: g.latest.content,
            sentAt: g.latest.sentAt,
            lastMessageID: g.latest._id,
            noviCode: g.latest.noviCode,
            senderInfo: {
                _id: users.get(sender)?._id ?? null,
                userName: users.get(sender)?.userName ?? "对方账号已注销",
            },
        }))
        .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    res.status(200).json(list);
});

// 标记已读
app.put("/api/message/markreaded", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { messageIds = [] } = req.body ?? {};
    const idSet = new Set(messageIds);
    const updated = [];
    for (const m of messages) {
        if (idSet.has(m._id) && m.receiver === me && !m.readAt) {
            m.readAt = iso();
            updated.push({ _id: m._id, sender: m.sender, receiver: m.receiver });
        }
    }
    if (updated.length === 0) {
        return res.status(200).json({ message: "没有可标记的未读消息", updatedIds: [] });
    }
    res.status(200).json({ message: "消息已标记为已读", modifiedCount: updated.length, unreadMessages: updated });
});

// 解密确认（E2E 预留，mock 仅置位 cryptoAckAt）
app.put("/api/message/crypto/ack", requireAuth, (req, res) => {
    const me = req.noviUser._id;
    const { messageIds = [] } = req.body ?? {};
    const idSet = new Set(messageIds);
    const updated = [];
    for (const m of messages) {
        if (idSet.has(m._id) && m.receiver === me && !m.cryptoAckAt) {
            m.cryptoAckAt = iso();
            updated.push({ _id: m._id, sender: m.sender, receiver: m.receiver });
        }
    }
    if (updated.length === 0) {
        return res.status(200).json({ message: "没有可确认解密的消息", updatedIds: [] });
    }
    res.status(200).json({ message: "消息已标记为已解密", modifiedCount: updated.length, unAckMessages: updated });
});

// ---------------------------------------------------------------------------
app.get("/", (_req, res) => res.send("novi-mock 🚀 后端接口 mock 运行中"));
app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`✅ novi-mock running at http://${HOST}:${PORT}`);
    console.log(`   演示账号：demo@novi.chat / demo123456`);
    console.log(`   预置好友：friend@novi.chat（好友小明，含未读消息）`);
});
