# Friend 模块文档

> 路由前缀：`/api/friend`（`src/index.ts` 中 `app.use('/api/friend', friendRouter)`）
> 源文件：`src/routes/friend.ts`
> 数据模型：`FriendRequest`（MongoDB，`models/mongoModel.ts`）

本模块管理 **好友关系的全生命周期**：发起申请、查询申请列表、同意/拒绝、解除好友、撤回申请、查询当前好友列表。所有接口都需要 `middlewareAuth`。

好友关系的唯一存储就是 `FriendRequest` 文档，其 `status` 字段是状态的「单一事实来源」：

| status | 含义 |
|---|---|
| `pending` | 已发起、待对方处理 |
| `accepted` | 已接受 → 成为好友 |
| `rejected` | 被拒绝 |
| `canceled` | 发起者撤回 |
| `deleted` | 好友关系被解除 |

> 注意：「是好友」的判定 = 存在一条 `status: 'accepted'` 的记录（requester/receiver 任意方向）。没有独立的好友表。

---

## 一、接口清单

### 1. `POST /api/friend/request` — 发起好友申请

**请求体**（`postFriendRequest`）：

| 字段 | 约束 |
|---|---|
| `targetUserId` | string，10–100，必填（目标用户的 ObjectId 字符串） |

**响应**：
- `200`：返回 `FriendRequest` 文档（新创建，或已存在的 pending/accepted 记录）。
- `400 不能添加自己为好友` / `400 目标用户不存在`。

**实现原理**：
1. 校验 `myUserId !== targetUserId`；
2. `User.findOne({ _id: targetUserId })` 确认目标存在；
3. 查是否已存在 `status ∈ {accepted, pending}` 的任意方向记录，**有则直接返回该记录**（幂等，不重复建单）；
4. 否则 `new FriendRequest({ requester, receiver, status: 'pending' }).save()`；
5. 保存成功后走**推送**：分别读 `user:online:{myUserId}` 和 `user:online:{targetUserId}` 拿到各自所在节点，`noviNodeIPC.sendToNode(node, createNewMessage(userId, 'novi_friend_request_comming', doc))`，让双方所在节点各发一条 `novi_friend_request_comming` 事件。

---

### 2. `GET /api/friend/request` — 查询与自己相关的好友申请

**请求**：无参数（用 `req.noviUser._id`）。

**响应** `200`：`FriendRequestResponse[]`，每条结构：
```json
{
  "friendRequestId": "<id>",
  "status": "pending|accepted|...",
  "createdAt": "...",
  "requester": { "userId": "<id>", "userName": "..." },
  "receiver":  { "userId": "<id>", "userName": "..." }
}
```

**实现原理**：一条聚合流水线（`FriendRequest.aggregate`）：
1. `$match`：`requester == me OR receiver == me`（不限 status，所以会返回所有历史申请）；
2. 两次 `$lookup` 分别把 `requester`、`receiver` 关联到 `users` 集合，只 `project` 出 `_id`、`userName`；
3. 两次 `$unwind`（**注意**：若用户已被删除，`$lookup` 结果为空数组，`$unwind` 会**丢弃整条记录**——见问题 4）；
4. 最终 `$project` 重排字段。

---

### 3. `PUT /api/friend/request` — 处理好友申请（同意/拒绝）

**请求体**（`putFriendRequest`）：

| 字段 | 约束 |
|---|---|
| `friendRequestId` | string，必填 |
| `status` | `'accepted'` 或 `'rejected'`，必填 |

**响应**：`200` 返回更新后的文档；`400` 各种前置校验失败。

**实现原理**（前置校验链）：
1. `findOne({ _id: friendRequestId })`，不存在 → `400 未找到目标申请记录`；
2. `myUserId !== receiver` → `400 这不是向您发起的好友申请`（**只有接收方能处理**，发起方不能替对方同意）；
3. `status !== 'pending'` → `400 无法重复处理目标好友申请`；
4. `updateOne` 设 `status` + `respondedAt: now`；
5. 重新 `findOne` 取最新文档；
6. **推送** `novi_friend_request_processed` 给双方（receiver 与 requester 所在节点）。

> 幂等性由第 3 步保证：重复处理同一申请会被拒。

---

### 4. `DELETE /api/friend/?targetUserId=&friendRequestId=` — 解除好友关系

**查询参数**（`deleteFriend`，走 `middlewareValidate(..., 'query')`）：

| 字段 | 约束 |
|---|---|
| `targetUserId` | string，必填 |
| `friendRequestId` | string，必填 |

**响应**：`200` 返回被置为 `deleted` 的文档；`400 在非好友状态下无法解除好友关系`；`500 标记解除好友关系异常`。

**实现原理**：
1. `findOne({ status: 'accepted', $or: [{_id: friendRequestId}, {requester: me, receiver: target}, {requester: target, receiver: me}] })`——三重条件放宽匹配，确保能定位到那条 accepted 记录；
2. `updateOne` 设 `status: 'deleted'`，并严格校验 `matchedCount === 1 && modifiedCount === 1`，否则 500；
3. 重读文档；
4. **推送** `novi_friend_friend_deleted` 给双方。

> ⚠️ 这里 `status` 被改成 `deleted` 而非删除文档，是**软删除**，保留了历史记录。但 `plan.md` 的设想是「解除好友直接删好友关系文档与二人之间的聊天记录」。当前实现**不会删除 `FriendMessage`**（见问题 5）。

---

### 5. `DELETE /api/friend/request?friendRequestId=` — 撤回好友申请

**查询参数**（`deleteFriendRequest`）：`friendRequestId` 必填。

**响应**：`200` 返回被置为 `canceled` 的文档；`400 找不到符合要求的好友申请`。

**实现原理**：
1. `findOne({ _id, requester: myUserId, status: 'pending' })`——**只有发起者能撤回**，且必须是 pending；
2. `updateOne` 设 `status: 'canceled'`，校验 `matchedCount/modifiedCount === 1`；
3. 重读返回。

> 注意：撤回**不推送**任何事件给对方（对方那条 pending 申请仍留在其列表里，只是状态变 canceled）。是否需要通知对方见问题 6。

---

### 6. `GET /api/friend/` — 查询当前好友列表

**请求**：无参数。

**响应** `200`：`FriendRequestResponse[]`，结构同接口 2，但只含 `status === 'accepted'` 的记录。

**实现原理**：与接口 2 几乎相同的聚合，唯一区别是 `$match` 多了 `status: 'accepted'`。

---

## 二、推送机制（贯穿全模块）

每个会改变「与某用户相关状态」的写操作，都在落库后执行同一段「双推」逻辑（见 `noviNodeIPC.ts`）：

```
for (userId in [self, other]):
    node = await redisClient.get(`user:online:${userId}`)   // 该用户所在节点
    if (node):
        noviNodeIPC.sendToNode(node,
            noviNodeIPC.createNewMessage(userId, <event>, <doc>))
```

- `user:online:{userId}` 的值是本节点 ID（由 Socket.IO 连接时写入，见 `userConnections.ts`），TTL 5 分钟。
- `sendToNode` 经 RabbitMQ 把 `{fromNode, forUserId, event, message, timestamp}` 信封投到目标节点的 `/novi_node/{node}/ipc` 队列；
- 目标节点消费后调 `userConnections.eventMessageForClientByUserId(forUserId, event, message)`，向该用户本地 Socket emit 事件；
- **Socket.IO 只传「通知 + 轻量数据」，真正的完整数据客户端拿到事件后再走 HTTP 拉取**（符合 `plan.md` 的设计）。

事件名对照（`plan.md` 定义）：

| 场景 | 事件名 |
|---|---|
| 新好友申请到达 | `novi_friend_request_comming` |
| 好友申请被处理 | `novi_friend_request_processed` |
| 好友被删除 | `novi_friend_friend_deleted` |

---

## 三、代码不合理之处与修改方案

### 问题 1：`DELETE` 用 query string 传参数，而非 body/params ⚠️ 中
接口 4、5 用 `DELETE /api/friend/?a=&b=`，参数放 query。虽然功能正确（`middlewareValidate(..., 'query')` 专门处理），但：
- REST 习惯上 DELETE 的资源标识放 **URL path**（`/api/friend/request/:id`），而非 query；
- query 会出现在访问日志、浏览器历史、Referer 中，这里虽不敏感，但风格不统一（POST/PUT 用 body，DELETE 用 query）；
- `deleteFriend` 的 schema 里 `targetUserId` 其实**没被 handler 用到**（handler 只用 `friendRequestId` 与 `myUserId`），属于多余参数。

**修改方案**：
- 撤回申请改为 `DELETE /api/friend/request/:friendRequestId`；
- 解除好友改为 `DELETE /api/friend/:friendRequestId`（或 `DELETE /api/friend/:targetUserId`），去掉无用的 `targetUserId` 冗余；
- 统一用 `req.params` + `middlewareValidate(schema, 'params')`。

---

### 问题 2：接口 2 与接口 6 的聚合流水线大段重复 ⚠️ 低（可维护性）
`getFriendRequestHandler`（接口 2）和 `getFriendListHandler`（接口 6）约 50 行聚合逻辑几乎完全相同，只差 `$match` 里的 `status: 'accepted'`。将来改字段/改 lookup 要改两处，易漏。

**修改方案**：抽出 `buildFriendRequestPipeline(myUserId: string, status?: string)` 工厂函数，两处调用，`status` 为可选过滤条件。

---

### 问题 3：「是否已好友」的判定散落且方向不对称 ⚠️ 中
判定「两人是否已存在关系」在多处重复手写 `$or: [{requester: A, receiver: B}, {requester: B, receiver: A}]`（接口 1、message 模块的发消息校验）。逻辑分散，且依赖「status 集合」这个隐式约定。

**修改方案**：在 `models/mongoModel.ts` 或新建 `services/friendService.ts` 提供 `findRelationship(aId, bId)` / `isFriend(aId, bId)` 工具函数，统一封装方向无关的查询，路由只调用它。

---

### 问题 4：`$unwind` 会静默丢弃用户已删除的申请记录 ⚠️ 中
接口 2/6 用 `{ $unwind: '$requester' }`（无 `preserveNullAndEmptyArrays`）。若申请中某一方账号已被 `user.ts` 的 `/delete` 删除，`$lookup` 得到空数组，`$unwind` 会把**整条记录丢弃**——用户会看到「申请凭空消失」，且无任何错误提示。

**修改方案**：二选一，取决于产品语义：
- 若希望展示「对方已注销」：`{ $unwind: { path: '$requester', preserveNullAndEmptyArrays: true } }`，并配合 `$project` 用 `$ifNull` 给占位值；
- 若希望干净地不展示已删用户的记录：保留现状，但在文档中**明确声明**该行为。
推荐前者，前端显示为「对方账号已注销」。

---

### 问题 5：解除好友不清理聊天记录，与 plan.md 设想不符 ⚠️ 中（设计）
`plan.md` 明确：「解除好友关系直接删好友关系文档与二人之间的聊天记录」。当前 `DELETE /api/friend/` 只把 `FriendRequest.status` 置 `deleted`，`FriendMessage` 集合里二人之间的消息**原封不动保留**。这既是隐私问题（用户以为删除了其实还在库里），也与「最大程度无痕」的卖点冲突。

**修改方案**：
- 解除好友时，按 `(sender, receiver)` 双向 `deleteMany` 对应的 `FriendMessage`；
- 由于 `FriendMessage` 每条带 `noviCode`（关系版本号），也可按「两人之间 + 该 novicode」精确删除；
- 同时向对方推送 `novi_friend_friend_deleted`，让**对方客户端**也删除本地密钥 5 元组（客户端侧职责，服务端只需发对事件）。
> 注意：若将来实现 `plan.md` 的「消息区块链式哈希链」，删除策略需重新评估，但当前纯明文阶段应直接删除。

---

### 问题 6：撤回申请不通知对方 ⚠️ 低（体验）
接口 5 撤回 pending 申请时不推送事件，对方列表里那条 pending 记录仍显示为「待处理」，直到对方刷新或去处理时才发现已被撤回（处理时因 status 非 pending 会收到 `400 无法重复处理`）。

**修改方案**：撤回成功后向对方推送一条事件（可复用 `novi_friend_request_processed` 或新增 `novi_friend_request_canceled`），让对端及时更新 UI。

---

### 问题 7：`POST /request` 幂等返回已存在记录时状态码语义模糊 ⚠️ 低
接口 1 在「已存在 pending/accepted 记录」时返回 `200` + 旧记录，与「新建成功」无法区分。前端难以判断是否真的发出了新申请。

**修改方案**：新建返回 `201`，命中已存在记录返回 `200` 并加字段（如 `{ ...doc, duplicated: true }`）或返回 `409`。

---

## 四、数据模型速览（FriendRequest）

```ts
{
  _id: ObjectId,
  requester: ObjectId (ref: user),
  receiver:  ObjectId (ref: user),
  status: 'pending' | 'accepted' | 'rejected' | 'deleted' | 'canceled',  // 默认 pending
  createdAt: Date,        // timestamps
  updatedAt: Date,        // timestamps
  respondedAt?: Date      // 接收者处理时间
}
// 索引：{ requester: 1, receiver: 1 }
```
