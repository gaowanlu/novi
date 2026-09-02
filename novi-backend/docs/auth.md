# Auth 模块文档

> 路由前缀：`/api/auth`（在 `src/index.ts` 中挂载 `app.use('/api/auth', authRouter)`）
> 源文件：`src/routes/auth.ts`

本模块负责 **JWT 认证生命周期**：登录签发令牌、令牌校验、登出吊销、心跳续期。它是整个后端「服务端可吊销 JWT」机制的核心，所有受保护接口（friend / message）都依赖这里签发的令牌以及 Redis 中存储的令牌副本。

---

## 一、核心设计：JWT + Redis 双重校验

novi 的鉴权不是单纯的「JWT 自校验」，而是 **JWT + Redis 双保险**：

1. **签发时**：`jwt.sign({ _id: userId }, NOVI_JWT_SECRET)` 生成无过期时间（见问题 2）的令牌，同时把**同一个令牌字符串**写入 Redis：`user:auth:{userId}`，TTL 为 `NOVI_JWT_TOKEN_TTL`（默认 3600s）。
2. **校验时**（`middlewareAuth.ts`）：
   - 解析 `Authorization: Bearer <token>`；
   - `jwt.verify` 验证签名；
   - **再**从 Redis 读 `user:auth:{_id}`，要求 `cacheToken === token` 完全相等，否则 401。
3. **吊销时**：`logout` 删除 Redis key，之后即便 JWT 签名仍有效，也会被 `cacheToken !== token`（Redis 返回 null）拒绝。

> 这意味着「有效但已被轮换/登出的 JWT 一律被拒绝」。Socket.IO 连接（`userConnections.ts`）走完全相同的 Redis 校验逻辑，保证 HTTP 与 WS 两条链路的鉴权一致。

**重要约束**：不要在任何地方绕过 Redis 校验，否则服务端吊销能力失效。

---

## 二、接口清单

### 1. `POST /api/auth/login`

**用途**：登录，签发 JWT。

**请求体**（`postLoginSchema`）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `email` | string | 合法 email，必填 |
| `password` | string | 8–20 字符，必填 |

**成功响应** `200`：

```json
{ "jwtToken": "<token>", "userId": "<id>", "userName": "...", "email": "..." }
```

**失败响应**：`400 用户未注册` / `400 密码不正确请重试` / `500 <err.message>`。

**实现原理**：
1. `User.findOne({ email }).lean()` 取出用户（含 `password` / `passwordSalt`）；
2. 用 `sha256(password + salt)` 重新计算哈希，与库中 `password` 字符串比对；
3. 通过后 `jwt.sign` 签发，写入 Redis（`EX: JWT_TOKEN_TTL`）并返回。

---

### 2. `GET /api/auth/token/verify`

**用途**：探活 / 校验当前令牌是否有效（前端登录后或 401 时用于自检）。

**请求头**：`Authorization: Bearer <token>`（由 `middlewareAuth` 校验）。

**响应**：`200 {}`（只要中间件放行即返回空对象）。

**实现**：`tokenVerifyHandler` 不读任何数据，纯依赖 `middlewareAuth` 的结果。

---

### 3. `GET /api/auth/logout`

**用途**：登出，吊销当前令牌。

**请求头**：`Authorization: Bearer <token>`。

**响应**：`200 { message: '成功登出' }`。

**实现**：`redisClient.del('user:auth:{_id}')`。删除后该 token 立即失效，且所有已建立的 Socket.IO 连接在下一次心跳/校验时会被拒绝（注意：已存在的 WS 连接不会主动断开，见问题 5）。

> ⚠️ 语义上用 GET 表达「登出」这种**有副作用的操作**，不符合 REST 约定，且易被爬虫/预加载触发。见问题 3。

---

### 4. `GET /api/auth/heartbeat`

**用途**：心跳，续期令牌 TTL。

**请求头**：`Authorization: Bearer <token>`。

**响应**：`200 { message: '心跳成功 已续费' }`；若 Redis 中查不到令牌则 `401 { message: 'Token已失效' }`。

**实现**：`redisClient.expire('user:auth:{_id}', JWT_TOKEN_TTL)`，把 TTL 重置回完整时长，实现「活跃用户令牌不失效」的滑动过期。

> ⚠️ 同样用 GET 表达副作用操作（续期）。见问题 3。

---

## 三、数据与依赖

- **MongoDB**：`User`（`models/mongoModel.ts`），字段 `userName` / `email` / `password` / `passwordSalt`，均建唯一索引。
- **Redis**：`user:auth:{userId}` → 当前有效令牌字符串，TTL = `NOVI_JWT_TOKEN_TTL`。
- **环境变量**：`NOVI_JWT_SECRET`（签名密钥）、`NOVI_JWT_TOKEN_TTL`（秒，默认 3600）。

---

## 四、代码不合理之处与修改方案

### 问题 1：`JWT_SECRET` 在两处分别读取，且 auth.ts 里用空串兜底 ⚠️ 高
`routes/auth.ts:15` 与 `middlewareAuth.ts:8` 各自独立 `const JWT_SECRET = process.env.NOVI_JWT_SECRET`。
- auth.ts 写的是 `?? ''`，**空串也能 sign/verify 成功**（jsonwebtoken 允许空 secret），一旦忘记配置 `NOVI_JWT_SECRET`，系统会以「空密钥」静默运行，任何拿到源码的人都能伪造令牌。
- 两处独立读取，将来加 `NOVI_JWT_ALGORITHM` 或改逻辑时容易漏改一处。

**修改方案**：新建 `src/config/jwt.ts`（或并入 `config/loadDotEnv.ts` 的校验），集中导出：
```ts
const secret = process.env.NOVI_JWT_SECRET
if (!secret) throw new Error('NOVI_JWT_SECRET 未配置，拒绝启动')
export const JWT_SECRET = secret
export const JWT_TOKEN_TTL = Number.parseInt(process.env.NOVI_JWT_TOKEN_TTL ?? '3600', 10) || 3600
export const signToken = (id: string) => jwt.sign({ _id: id }, secret)
export const verifyToken = (t: string) => jwt.verify(t, secret)
```
auth.ts / middlewareAuth.ts / userConnections.ts 全部改为 import 这一份，**启动时缺密钥直接 fail-fast**。

---

### 问题 2：签发的 JWT 没有过期时间 ⚠️ 高
`auth.ts:43` `jwt.sign({ _id: userId }, JWT_SECRET)` 未传 `expiresIn`。令牌本身永不过期，安全性完全寄托在 Redis TTL 上。一旦 Redis 数据被持久化/备份泄露，或 Redis 故障期间校验逻辑被弱化，令牌将永久有效。

**修改方案**：签发时加上与 Redis 一致的过期：
```ts
jwt.sign({ _id: userId }, JWT_SECRET, { expiresIn: `${JWT_TOKEN_TTL}s` })
```
形成「JWT 自身过期 + Redis 吊销」双保险：即使 Redis 短暂不可用，令牌也有硬性寿命上限。

---

### 问题 3：登出 / 心跳用 GET 表达副作用 ⚠️ 中
`logout`、`heartbeat`（以及 friend 模块的 `DELETE /api/friend/` 带 query body）都用了语义不匹配的 HTTP 方法：
- GET 应是幂等只读，但这里会**删除 Redis key / 续期 TTL**；
- 浏览器预加载、CDN、爬虫可能误触发登出；
- 无法携带 body（虽然这里不需要）。

**修改方案**：
- 登出改为 `POST /api/auth/logout`（或 `DELETE /api/auth/session`）；
- 心跳改为 `POST /api/auth/heartbeat`（或保留 GET 但明确其为「只读探活 + 顺带续期」，并在文档中声明可被安全重复调用）。
> 注：前端 `APIMacro.ts` 需同步更新对应 URL，改动是跨项目的。

---

### 问题 4：密码哈希用单次 SHA-256，无加盐迭代 / 无 bcrypt ⚠️ 中
`auth.ts`（注册在 `user.ts`）与登录都使用 `crypto.createHash('sha256').update(password + salt)`——**单次 SHA-256**。现代 GPU 每秒可试数十亿次，离线撞库几乎零成本。`plan.md` 里「用户密码用 SHA256」的设定，从安全角度看偏弱。

**修改方案**：迁移到 `bcrypt`（或 `argon2`）：
```ts
const hash = await bcrypt.hash(password, 12)   // 注册
await bcrypt.compare(password, stored)          // 登录
```
bcrypt 自带 salt 与自适应成本因子，无需手工维护 `passwordSalt` 字段（可保留字段以兼容旧数据，逐步迁移）。迁移期可对旧 SHA-256 用户「登录成功一次后透明重哈希为 bcrypt」。

---

### 问题 5：登出后已存在的 Socket.IO 连接不会立即断开 ⚠️ 中
`logout` 只删了 `user:auth:{_id}`，但 `userConnections.userId2Socket` 里的连接、以及 `user:online:{id}` 在线状态都还在。被登出用户的 WS 仍会收到推送事件，直到心跳/重连时才被拒。

**修改方案**：登出时调用 `userConnections` 暴露的方法主动 `socket.disconnect()` 并 `DEL user:online:{id}`，保证「登出即彻底下线」。

---

### 问题 6：错误信息回显内部 `err.message` ⚠️ 低
各 handler 的 catch 直接 `res.status(500).json({ message: err.message })`，可能把 MongoDB/Redis 的堆栈或连接串细节泄露给前端。

**修改方案**：对外统一返回固定文案（如 `服务器内部错误`），`err.message` 仅写日志。

---

## 五、与其他模块的契约

- 签发的 `jwtToken` 是前端 `AuthContext` 持久化到 `localStorage` 的值，后续所有 `apiFetch` 都以 `Authorization: Bearer <jwtToken>` 携带。
- `userId`（即 JWT 里的 `_id`，MongoDB ObjectId 字符串）是 friend / message 模块 `req.noviUser._id` 的来源。
- 登出删除的 Redis key 与 `middlewareAuth`、Socket.IO 中间件读取的是**同一个 key**，三者必须一致。
