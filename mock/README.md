# novi-mock

独立的 novi 后端接口 mock 服务，用于**不启动真实后端**（Mongo / Redis / RabbitMQ / Kafka）就能完整演示与联调前端。

- 纯内存数据，重启即重置，**不修改任何工程代码**，不污染 `novi-frontend` / `novi-backend`。
- 复刻 `novi-backend` 的 HTTP 契约（路由、字段、错误体一致）。
- **不含 Socket.IO**：前端目前只走 HTTP 轮询（`FunctionalPage` 15s 拉未读、`MessagePanel` 打开会话时拉取），所以 mock 只需 HTTP。

## 已覆盖的接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录，返回 `{ jwtToken, userId, userName, email }` |
| GET | `/api/auth/token/verify` | 校验 token（刷新页面时前端会调用） |
| GET | `/api/auth/heartbeat` | 心跳续费 |
| GET | `/api/auth/logout` | 登出 |
| POST | `/api/user` | 注册 |
| PUT | `/api/user` | 修改用户名 / 邮箱 |
| POST | `/api/user/find` | 按 ID / 用户名搜索用户 |
| GET | `/api/friend` | 好友列表（仅 accepted） |
| GET | `/api/friend/request` | 全部好友申请 / 关系记录 |
| POST | `/api/friend/request` | 发起好友申请 |
| PUT | `/api/friend/request` | 同意 / 拒绝 |
| DELETE | `/api/friend` | 删除好友 |
| DELETE | `/api/friend/request` | 撤销申请 |
| POST | `/api/message` | 发送消息 |
| GET | `/api/message/pull/unread/byfriend?sender=` | 拉取与某好友的会话 |
| GET | `/api/message/allfriend` | 全部好友未读汇总 |
| PUT | `/api/message/markreaded` | 标记已读 |
| PUT | `/api/message/crypto/ack` | 解密确认（E2E 预留） |

## 运行

```bash
cd mock
npm install
npm start          # 监听 NOVI_MOCK_PORT（默认 3300）
```

## 前端如何接入（二选一）

**方式 A（推荐）：Vite 代理**
前端 `.env` 里 `VITE_NOVI_HOST=http://localhost:5173`（Vite 自身地址）。前端照旧请求
`${HOST}/api/...`，这些请求被 `vite.config.ts` 里的 `/api` 代理转发到 mock（默认
`http://127.0.0.1:3300`，可用 `NOVI_MOCK_TARGET` 覆盖）。前后端工程零改动。

```bash
# 终端 1
cd mock && npm start
# 终端 2
cd novi-frontend && npm run dev
```

**方式 B：直连**
把前端 `.env` 的 `VITE_NOVI_HOST` 直接设为 `http://127.0.0.1:3300`（mock 已开启 CORS）。
适合前端跑在非 Vite 环境、或想显式指向 mock 的场景。

## 演示账号

| 邮箱 | 密码 | 说明 |
| --- | --- | --- |
| `demo@novi.chat` | `demo123456` | 演示用户，预置一个好友 + 未读消息 |
| `friend@novi.chat` | `friend12345` | 预置好友（好友小明） |

登录 `demo@novi.chat` 后，好友列表会出现「好友小明」，聊天页有 2 条未读消息可用于演示未读角标、
拉取会话、标记已读、发送消息等完整链路。

> 说明：mock 用 `userId` 充当 token（无真实 JWT 签名），仅用于演示；真实鉴权逻辑以 `novi-backend` 为准。
