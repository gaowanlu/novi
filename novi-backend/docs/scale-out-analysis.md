# novi 后端横向扩展方案分析

> 基于 `src/connections/userConnections.ts`、`src/mq/noviNodeIPC.ts`、`src/mq/mqRabbitMQ.ts`、`src/routes/{message,friend,auth}.ts`、`src/middlewares/middlewareAuth.ts` 的当前代码（2026-09-04）。

## 1. 当前方案概览

**拓扑**：N 个无状态节点实例 + 前置网关（nginx）+ 共享数据层。

```
                       ┌──────────────┐
   Client ───HTTP────▶ │  nginx LB   │ ──▶ Node A (NOVI_NODE=1)
             ──WS────▶ │ (轮询分发)  │ ──▶ Node B (NOVI_NODE=2)
                       └──────────────┘
                                        │  │
              ┌─────────────────────────┘  └────────────────────────┐
        共享数据层                                            节点间协调层
  ┌────────────┬────────────┬────────────┐            ┌────────────┴───────────┐
  │  MongoDB   │ PostgreSQL │  Redis     │            │       RabbitMQ         │
  │ 业务主存储  │ orders     │ 在线状态    │            │ /novi_node/{N}/ipc     │
  │            │            │ user:auth:*│            │ /novi_node/{N}/heartbeat│
  └────────────┴────────────┴────────────┘            └────────────────────────┘
```

**核心机制**：

| 关注点 | 实现 | 位置 |
|---|---|---|
| 节点身份 | 环境变量 `NOVI_NODE`，每实例不同 | `.env.example` |
| 在线状态 | Redis `user:online:{userId}` = 节点 ID，TTL 5 分钟，心跳每 3 分钟续期 | `userConnections.ts:108,165` |
| 鉴权 | JWT 签名校验 + **Redis `user:auth:{userId}` 精确匹配**（支持吊销/换 token） | `middlewareAuth.ts:34` |
| 跨节点推送 | 变更 → 查 Redis 拿对方所在节点 → RabbitMQ `sendToNode` → 目标节点 Socket.IO emit | `routes/message.ts:59-74` |
| 消息内容 | 永远走 HTTP 回拉，Socket.IO 只传轻量事件通知 | CLAUDE.md 设计约定 |
| 本地连接表 | 每节点 `userId → socket` 内存 Map（每用户每节点单 socket） | `userConnections.ts:18` |

**推送流程**（以发消息为例，`routes/message.ts:49-74`）：

1. 请求落在任意节点，落库 Mongo；
2. `redisClient.get('user:online:{sender}')` 与 `...:{receiver}` 各查一次；
3. 对每个在线方 `noviNodeIPC.sendToNode(node, {fromNode, forUserId, event, message, timestamp})`；
4. RabbitMQ 投递到 `/novi_node/{node}/ipc` 队列；
5. 目标节点消费后 `userConnections.eventMessageForClientByUserId()` 本地 emit；
6. 客户端收到事件后发 HTTP 拉取实际数据。

---

## 2. 优点

### 2.1 架构方向正确
- **无状态 HTTP 层 + 有状态连接层分离**：任何节点都能处理任何 HTTP 请求（共享 Mongo/Redis/PG），水平扩展 HTTP 吞吐只需加机器；
- **通知与数据分离**：WS 只推"发生了什么"（事件 + ID），数据走 HTTP。这使得 WS 链路极轻、不承载大 payload、不需要为消息内容做跨节点一致性，也天然规避了"WS 连接粘在旧节点上但数据被新节点写"的复杂场景；
- **Redis 作为跨节点唯一事实来源**：在线位置、token 吊销都集中在一处，节点间无需 P2P 同步状态；
- **RabbitMQ 点对点队列**（`/novi_node/{N}/ipc`）路由直接，目标节点不存在时消息自然滞留（见 3.3 讨论）。

### 2.2 鉴权设计对多节点友好
JWT + Redis 双校验意味着：**任意节点**都能验证任意用户的 token 有效性，且登出/换 token 后所有节点立即失效（`auth.ts:69` 删 Redis key，下一次任何节点的请求都会 401）。这是多节点部署的正确做法，比"token 存在签发节点本地"的常见错误实现好得多。

### 2.3 重连逻辑基本完整
`mqRabbitMQ.ts` 对 producer/consumer 连接都有 `error`/`close` 事件监听和 5 秒重连；`dbRedis.ts` 使用了 node-redis 官方客户端（内置 reconnect + retry）。中间件挂了不会拖死进程。

### 2.4 容量上界清晰
单节点可承载的并发连接数 = 机器内存/CPU 上限（Socket.IO 单连接开销很小，单机数万连接量级）。横向扩展上限只受 RabbitMQ/Redis 吞吐约束，而这两个都是成熟可横向组件。

---

## 3. 缺点与潜在问题（按严重度排序）

### 🔴 P0-1：在线状态 TTL/心跳间隔的"静默死亡窗口"

`userConnections.ts:108` 设置 `user:online:{id}` TTL 5 分钟；`OnHeartbeat` 每 3 分钟才真正写一次 Redis（`latestHeartbeatTimestamp` 节流，`userConnections.ts:158`）。

**故障场景**：节点 A 宕机（进程被 kill、机器断电）。该节点上所有用户：

1. 客户端感知断开（通常秒级）→ 重连 → 被 nginx 分到节点 B → 节点 B 覆盖 Redis 为 B。✅ 这部分能自愈；
2. **但节点 B 的 HTTP 路由（如 A 宕机前几秒别人给该用户发消息）查 Redis 仍会看到 `A`** → RabbitMQ 消息投到 `/novi_node/A/ipc` → A 的消费者已死 → **队列里消息滞留**（非持久队列，A 重启后若队列未重建则丢弃；即使重建，滞留消息会被当作新事件重放）。
3. 用户若不主动重连（App 在后台被挂起、弱网），Redis 里 `A` 的指向最长**存活 5 分钟**——期间所有发给他的推送都石沉大海，且没有任何告警。

**本质**：状态的正确性完全依赖"客户端及时重连"，服务端没有主动清理/校验机制。对聊天应用，"5 分钟僵尸在线"直接表现为"消息延迟/丢失且无提示"。

### 🔴 P0-2：`onDisconnect` 无条件删除在线状态——多设备/竞态丢推送

`userConnections.ts:131-134`：任意 socket 断开即 `DEL user:online:{userId}`，且**不校验** `userId2Socket` 中当前注册的 socket 是否就是这个断开的 socket。

**故障场景**（同用户多设备，或快速重连）：
- 用户在手机和平板各连一个 socket。手机断开 → DEL Redis key → 平板仍在线但 Redis 显示"不在线" → 发给该用户的推送被 `routes/message.ts:61-70` 的 `if (senderOnlineNode)` 静默跳过（`logger.error` 记一条 `eventMessageForClientByUserId failed` 就结束）。**通知丢失，且客户端无离线补偿机制（见 P1-4），消息实际只能靠客户端自己轮询/重新打开会话时才看到。**
- 快速重连竞态：旧 socket 的 `disconnect` 事件晚于新 socket 的 `onConnect` 到达 → 新连接刚写的 Redis key 被旧连接的断开事件删掉。

另外注意：`userId2Socket` 是 `Map<userId, socket>` 单值结构（`userConnections.ts:18`），**同一用户在同一节点的第二个 socket 会覆盖第一个**，旧 socket 变成"幽灵连接"（还在推、但不在 Map 里）。

### 🟠 P1-1：RabbitMQ 消息零可靠投递保证

`mqRabbitMQ.ts` 中 IPC 队列 `assertQueue(QUEUE_IPC, { durable: false })`，消费端 `noAck: true`（`mqRabbitMQ.ts:188-197`），生产端 `sendToQueue` 未检查返回值。这意味着：

- **noAck 自动确认**：目标节点收到消息但处理前崩溃（或消费回调抛错）→ 消息已确认，**永久丢失**；
- **非持久队列**：RabbitMQ broker 重启 → 所有 `/novi_node/*/ipc` 队列清空 → 在途通知全部丢失；
- **生产端无确认**：`producerChannel` 短暂为 null 时 `sendToNoviNode` 直接 `return`（`mqRabbitMQ.ts:149-152`），通知静默丢失；
- **目标节点宕机**：消息滞留在 A 的队列里。A 重启后重新 `assertQueue`（non-durable），旧队列里的消息**随队列消失**——即"离线期间的事件通知全部丢失"。

结合"通知只是信号、数据走 HTTP"的设计，丢失通知 ≈ 用户要等到下次**主动**拉取（打开会话/刷新）才能看到。对 IM 应用，这是可感知的体验缺陷（"为什么我没收到提醒，消息却已经在那了"）。

**注意**：数据本身没丢（在 Mongo 里），丢的是"及时性"。但"已读回执 / crypto ack"这类事件丢失还会造成两端状态不一致（A 已读，B 永远显示未读，直到 B 重新拉取）。

### 🟠 P1-2：`NOVI_NODE` 手动配置 → 节点身份冲突风险

`NOVI_NODE` 是人工分配的环境变量。运维失误（复制实例时忘了改）会导致两个实例声明同一节点 ID：

- 两者 `assertQueue` 同一个 `/novi_node/N/ipc`，RabbitMQ 默认工作模式变成**竞争消费**——一个发给用户 X 的事件通知可能被"另一个同 ID 节点"抢走，而该节点上没有 X 的 socket → `eventMessageForClientByUserId failed` → **通知丢失**；
- Redis `user:online` 指向 N，无法区分是哪个实例。

没有任何启动期校验或心跳上报来检测 ID 冲突。

### 🟠 P1-3：Redis 成为全集群单点强依赖

每个认证请求（`middlewareAuth.ts:34`）+ 每次 socket 连接/心跳 + 每次推送前的 2 次查节点，都同步依赖 Redis：

- **Redis 抖动**（主从切换、大 key、慢查询）→ 所有 HTTP 请求 500/超时 + socket 全部拒绝连接 + 所有推送失败，**全集群同时不可用**；
- `dbRedis.ts:18-20` 的 error handler 只打日志，没有重连状态对外暴露、没有熔断降级（例如 Redis 不可用时是否放行已验证过的 token）；
- 当前 docker-compose 是**单机 Redis**。生产必须上 Redis Sentinel/Cluster，且要注意：`user:auth` 的精确匹配语义在 Cluster 下按 key hash 分片没问题，但要确认客户端配置了 cluster 模式。

### 🟠 P1-4：无离线消息补偿（offline catch-up）机制

推送是 fire-and-forget：用户离线时事件直接丢弃（P1-1），在线但"错过窗口"时也无补发。客户端**必须**在重连/恢复前台后主动拉取。当前协议（`docs/plan.md` 的事件列表）中没有 "sync since timestamp" 之类的对账事件。

这意味着扩展方案的正确性**部分外包给了客户端实现**。任何漏掉重连拉取的端（新设备、旧版本客户端）都会出现状态不一致，且服务端无从发现。

### 🟡 P2-1：日志级别滥用导致告警噪音

`userConnections.ts` 大量使用 `logger.error` 记录**正常生命周期事件**（连接、断开、心跳、在线列表，如 `:92-100` 每 5 秒打印一次全量在线用户列表）。后果：

- 生产环境 ERROR 级别被监控采集时，**正常流量就是海量"错误"**，真正的故障被淹没（告警疲劳）；
- 5 秒一次的在线用户全量列表，在数千在线时本身成为性能/日志成本。

### 🟡 P2-2：Kafka 已接入但未使用，心跳队列是空转

`mqKafka.ts` 被 `noviNodeIPC.init()` 初始化但没有任何生产/消费路径；RabbitMQ 的 `/novi_node/{N}/heartbeat` 队列每 5 秒互发时间戳、收到只打日志（`mqRabbitMQ.ts:43-47, 85-90`）——**它没有参与任何在线状态判断**（在线状态走的是 Redis TTL）。这两个机制目前是"占位/未接线"状态：增加运维复杂度（Kafka broker 必须在线），却提供不了设计文档暗示的节点存活探测能力。

### 🟡 P2-3：网关层假设未落地

方案隐含假设 nginx 对 WS 做了**长连接保持**（Upgrade 后不重平衡）。如果网关配置了 round-robin + 定期回收，或用了不保持 WS 的负载均衡（某些云 LB 默认会周期性断开长连接），会出现"用户频繁被踢到不同节点"→ Redis 在线状态频繁抖动 → 推送命中率下降。文档/部署脚本中未见对应的 nginx `proxy_read_timeout`、`sticky session` 等配置说明。

### 🟡 P2-4：推送扇出无批量、无背压

`markreaded` 批量标记 N 条消息时，对每条 ×2 个方向各发一次 `sendToNode`（`routes/message.ts:284-297`）：N=100 时就是 200 次 RabbitMQ publish + 200 次 Redis GET，全部并发。没有：

- 按 `(node, userId)` 去重合并（同一用户同一事件多条消息可合并为一个"有新事件"信号）；
- 发布限速/队列背压（突发场景会瞬时打爆 RabbitMQ channel）。

### 🟡 P2-5：`sendToNode` 同步串行放大 RTT

`routes/message.ts:61-70` 中两次 `redisClient.get` 是 `await` 串行；虽然 `sendToNode` 本身是同步 publish（无 await），但整体路径 = 2×Redis RTT + 落库。在 Redis 与 Mongo 跨机房时延迟敏感。小优化：两次 get 可 `Promise.all`。

---

## 4. 安全性评估

### 做得对的
- **鉴权无状态化正确**：JWT + Redis 吊销，任意节点可验证，登出全集群立即生效；
- **JWT secret fail-fast**（`jwt.ts:8-11`）：缺密钥拒绝启动，避免空密钥签发；
- **Socket.IO 握手强制 JWT + Redis 双重校验**（`userConnections.ts:33-72`），WS 通道不匿名；
- 推送载荷只含 ID/事件名，不含敏感明文（当前消息 content 明文问题见下，属于 E2E 未落地问题，与扩展方案本身无关）。

### 需要关注的
1. **RabbitMQ 无认证隔离**：节点间消息是明文 JSON（含 `forUserId`、事件内容摘要），依赖 `RABBITMQ_URI` 网络可达性。若 RabbitMQ 暴露在不可信网络，任何能连上 broker 的实体可读取全部节点间通信、伪造事件（`fromNode` 无签名/校验，`mqRabbitMQ.ts` 消费端不验证消息来源身份）。**改进**：RabbitMQ 启用 TLS + 每节点独立账号/权限；IPC 消息加 HMAC（用节点密钥签名 `fromNode`）防伪造。
2. **Redis 是安全边界的一部分**：`user:auth` 被篡改/删除即可实现 DoS 或（结合其他漏洞）会话劫持。Redis 必须仅内网可达 + 强密码 + TLS，绝不能暴露。
3. **`NOVI_NODE` 冲突（P1-2）本质是可用性问题**，但若攻击者能控制一个节点的 env 配置，可伪装节点 ID 抢消费队列，造成定向通知丢失（选择性 DoS）。
4. **CORS `*`**（`index.ts:36`）：生产应收敛（代码注释里已有正确写法）。
5. 明文消息存储（`routes/message.ts:53`）：E2E 未落地前，Mongo 即明文库，扩容时**每多一个节点 = 多一份可读取明文的攻击面**，Mongo 备份/从库的权限控制要求随之提高。

**结论：扩展机制本身没有引入新的严重安全漏洞，但它把 RabbitMQ/Redis 从"辅助组件"提升为"安全关键组件"，其网络隔离与认证配置必须按关键基础设施标准对待。**

---

## 5. 可行性 / 可靠性 / 安全性 结论

| 维度 | 结论 | 说明 |
|---|---|---|
| **可行吗** | ✅ 可行 | 架构方向（无状态 HTTP + Redis 路由 + MQ 点对点 + 通知/数据分离）是 IM 多节点部署的标准且正确做法，能支撑横向扩展 |
| **可靠吗** | ⚠️ 有条件可靠 | 数据可靠性高（Mongo 持久化 + 客户端可回拉），但**通知可靠性弱**：noAck、非持久队列、TTL 僵尸窗口、disconnect 竞态，任何一环都会造成"事件丢失 → 用户需手动刷新"。当前适合"最终一致、可容忍延迟"的场景，不适合要求即时送达保证的场景 |
| **安全吗** | ⚠️ 机制安全、部署敏感 | 鉴权模型正确；但 RabbitMQ/Redis 成为安全关键路径后，其认证、TLS、网络隔离必须到位，否则节点间通道可被窃听/伪造 |

---

## 6. 改进方案

### 6.1 短期（不改架构，补可靠性，建议 1-2 周）

| # | 改进 | 改动点 | 解决 |
|---|---|---|---|
| 1 | **`onDisconnect` 加守卫**：仅当 `userId2Socket.get(userId) === socket` 时才 `DEL` Redis；Map 改为 `Map<userId, Set<socket>>` 支持同节点多连接 | `userConnections.ts` | P0-2 |
| 2 | **缩短 TTL + 加快心跳**：TTL 90s，心跳每 20-30s 更新（去掉 3 分钟节流，Redis SET 成本极低）；或保留节流但把 TTL 缩到 2×心跳间隔 | `userConnections.ts` | P0-1 |
| 3 | **节点优雅下线**：`SIGTERM` 时先 `DEL` 本节点所有 `user:online:*`（或设置标记），再断开 socket，最后关 MQ 连接 | 新增 shutdown hook（`index.ts`） | P0-1 |
| 4 | **IPC 队列改 `durable: true`**，消费端去掉 `noAck` 改手动 ack（处理完再 ack）；生产端用 publisher confirm 或至少在 channel 为 null 时进入待发队列重试 | `mqRabbitMQ.ts` | P1-1 |
| 5 | **`NOVI_NODE` 启动自检**：启动时 `SETNX node:lock:{NOVI_NODE}` 成功才允许启动，否则 fail-fast 报错；或用"节点注册表"（Redis hash）+ 定期心跳，超时未心跳的节点 ID 自动失效 | `index.ts` + Redis | P1-2 |
| 6 | **日志分级修正**：正常生命周期事件改 `info`/`debug`，保留 `error` 给真故障；在线列表日志降为 debug 且加采样 | `userConnections.ts` | P2-1 |
| 7 | **Redis 健康暴露**：`redisClient.isReady` 接入 `/health` 端点；Redis 不可用时 HTTP 认证快速失败并返回 503（而非悬挂） | `index.ts` | P1-3 |

### 6.2 中期（协议补强，1-2 月）

1. **离线补偿协议**：事件信封加自增 `seq`（每用户一条 Redis INCR 或 Mongo 事件日志），客户端重连后带 `lastSeq` 调用 `GET /api/sync?since=seq` 拉取对账。这把"及时性"从纯推送变成**推送 + 对账双通道**，是 IM 可靠性的行业标准做法（类似 WhatsApp 的 pings/checkpoint、微信的 sync）。
2. **事件去重合并**：推送前按 `(userId, event)` 在短窗口（如 200ms）合并——"有 5 条新消息"与"有 1 条新消息"对客户端是同一个动作（拉一次），合并可大幅降低 MQ 扇出（解决 P2-4）。
3. **RabbitMQ → 评估替代**：若节点规模 >10，点对点队列的 N×N 管理成本上升，可考虑：
   - 保持 RabbitMQ 但改用 **topic exchange + 路由键 `novi.node.{id}`**（结构更清晰，便于加通配监听做运维）；
   - 或直接用 **Redis Pub/Sub**（少一个组件，但 Pub/Sub 无持久化、节点离线即丢——配合 6.2-1 的对账机制可接受）；
   - 或 **Kafka**（已有 broker，天然持久化 + 重放，但消费端要自己处理 offset，复杂度最高）。
   选择依据：通知丢失的容忍度。有对账机制后 Redis Pub/Sub 是最省运维的。
4. **清理空转组件**：删掉或真正接线 RabbitMQ heartbeat 队列（让它做"节点存活探测"：节点 A 的心跳消失 → 主动清理 Redis 中指向 A 的在线状态，**彻底解决 P0-1 的僵尸窗口**）；Kafka 不用则从 compose 移除。

### 6.3 长期（规模 >50 节点 / 高并发时）

1. **连接层独立**：把 Socket.IO 连接与 HTTP API 拆成两类实例（"WS 节点池"与"API 节点池"），WS 节点只负责连接保持与事件分发。收益：WS 长连接不再占用 API 节点的 worker；扩缩容互不影响。
2. **Redis 集群化**：Sentinel（3 主 3 从起步）或 Cluster；`user:auth` 与 `user:online` 的 key 天然分散，Cluster 直接可用。
3. **RabbitMQ 镜像/仲裁队列 → Quorum Queue**（3.13+ 默认推荐），防 broker 单点。
4. **可观测性**：给"推送失败率、Redis 指向不存在节点的次数、节点队列积压深度"加指标（Prometheus）——当前这些全是 log，无法告警。
5. **E2E 加密落地**（`docs/plan.md` 既定方向）：content 变密文后，推送/存储路径的载荷语义不变，但 Mongo 攻击面收窄，扩容的安全收益随之兑现。

### 6.4 部署侧清单（nginx / 编排）

- nginx：`proxy_http_version 1.1` + `Upgrade/Connection` 头 + `proxy_read_timeout 3600s`（WS 长连接保持）；
- 部署模板中 `NOVI_NODE` 必须自动注入（K8s StatefulSet ordinal / compose 循环变量），**禁止人工填写**；
- 滚动发布顺序：新节点先注册 → 网关放量 → 旧节点 SIGTERM 优雅下线（6.1-3）→ 摘除；
- 健康检查区分 liveness（进程活）与 readiness（Redis/Mongo/MQ 都可达）。

---

## 7. 总结

**这套横向扩展方案的方向是对的，骨架（无状态 HTTP + Redis 路由表 + MQ 点对点通知 + 通知/数据分离）是 IM 多节点部署的正确范式，可以支撑真实扩展。**

但它目前处于"**设计完成、可靠性未加固**"的状态，三个最该先修的问题：

1. **在线状态的死亡窗口与竞态**（P0-1/P0-2）——直接导致消息推送丢失且无告警；
2. **MQ 通知零投递保证**（P1-1）——把"及时性"完全押在客户端重连拉取上；
3. **节点身份手工管理**（P1-2）——运维一个失误就能造成静默丢通知。

修完短期清单（6.1）后，该方案即可用于生产多节点部署；中期补上**离线对账协议**后，才具备"IM 级"的可靠送达能力。安全上机制无硬伤，但 RabbitMQ 与 Redis 必须按安全关键基础设施配置（TLS、独立凭据、内网隔离）。
