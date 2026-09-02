# Message 模块文档

> 路由前缀：`/api/message`（`src/index.ts` 中 `app.use('/api/message', messageRouter)`）
> 源文件：`src/routes/message.ts`
> 数据模型：`FriendMessage`（MongoDB，`models/mongoModel.ts`）

本模块是**消息收发主链路**：向好友发消息、拉取未读汇总、按好友分页拉取消息、标记已读、确认解密。所有接口需 `middlewareAuth`。

> ⚠️ **端到端加密尚未落地**：当前 `content` 以**明文**存入 MongoDB（见问题 1）。`noviCode` 字段只是关系版本号占位，`cryptoAckAt` 字段已就位但无实际加密逻辑配合。`plan.md` 描述的目标态（RSA 加密 + SHA256 签名 + 客户端本地存密钥 5 元组）尚未接入消息路径。

---

## 一、数据模型速览（FriendMessage）

```ts
{
  _id: ObjectId,
  noviCode: string,          // 关系版本号（密钥版本同步用），当前仅占位
  sender:   ObjectId (ref: user),
  receiver: ObjectId (ref: user),
  content:  string,          // 消息正文，当前为明文
  sentAt:   Date,
  cryptoAckAt: Date | null,  // 接收者确认解密时间
  readAt:    Date | null,    // 接收者确认已读时间
  updatedAt: Date            // timestamps
}
// 索引：
//   { sender: 1, receiver: 1, sentAt: -1 }
//   { receiver: 1, readAt: 1, sentAt: -1 }
```

两个索引分别服务「按会话拉历史」（sender+receiver+sentAt）与「查未读」（receiver+readAt）。

---

## 二、接口清单

### 1. `POST /api/message/` — 向好友发送消息

**请求体**（`postFriendMessage`）：

| 字段 | 约束 |
|---|---|
| `noviCode` | string，1–10，必填 |
| `receiver` | string，10–100，必填（接收者 ObjectId） |
| `content` | string，1–200，必填 |

**响应**：
- `200`：返回新建的 `FriendMessage` 文档；
- `400 无法向自己发送消息`（**注意：此分支漏了 `return`，见问题 2**）；
- `400 不能向非好友用户发送消息`。

**实现原理**：
1. `receiver === myUserId` → 400（但缺 return，见问题 2）；
2. 校验好友关系：`FriendRequest.findOne({ $or: [A→B, B→A], status: 'accepted' })`，不是好友 → 400；
3. `new FriendMessage({ noviCode, sender, receiver, content, sentAt: now }).save()`；
4. **双推** `novi_friend_message_comming`：分别给 sender 与 receiver 所在节点发事件（让双方都收到「有新消息」通知，前端再 HTTP 拉取）；
5. 返回文档。

> 推送包体直接携带整个 `saveNewFriendMessage`（含明文 content）。在 E2E 落地前，这意味着**明文消息正文经 RabbitMQ 节点间传输**，见问题 1。

---

### 2. `GET /api/message/allfriend` — 拉取全部好友的未读汇总

**请求**：无参数。

**响应** `200`：数组，每项：
```json
{
  "sender": "<id>",
  "unreadCount": 3,
  "content": "最新消息预览",
  "sentAt": "...",
  "lastMessageID": "<id>",
  "noviCode": "...",
  "senderInfo": { "_id": "<id>", "userName": "..." }
}
```
按「最新消息时间倒序」排列，供前端渲染会话列表的未读角标。

**实现原理**（一条聚合流水线）：
1. `$match`：`receiver == me AND readAt == null`（只统计发给我且未读的）；
2. `$sort { sentAt: -1 }`（先倒序，保证 `$first` 取到最新）；
3. `$group` 按 `sender` 分组：`latestMessage = $first($$ROOT)`（每组最新一条）、`unreadCount = $sum(1)`；
4. `$lookup` 关联 `users` 取发送者信息；`$unwind`（同样存在用户已删则整条丢弃的问题，见问题 4）；
5. `$project` 重排字段；
6. 末尾再 `$sort { sentAt: -1 }`。

---

### 3. `GET /api/message/pull/unread/byfriend?sender=&before=&after=` — 按好友分页拉取消息

**查询参数**（`getMessagePullUnreadByFriend`，走 `middlewareValidate(..., 'query')`）：

| 字段 | 约束 |
|---|---|
| `sender` | string，必填（**注意**：语义是「对方」，但字段名叫 sender） |
| `before` | date，可选——拉取该时间（含）之前的 30 条 |
| `after` | date，可选——拉取该时间（含）之后的 30 条 |

**响应** `200`：`FriendMessage[]`（`lean()`，纯对象）。

**三种分支**：
1. **有 `before`**：`{ sender, receiver: me, sentAt <= before }` 倒序取 30，**再 `.reverse()` 转正序**返回（向上翻历史）。
2. **有 `after`**：`{ sender, receiver: me, sentAt >= after }` 正序取 30（向下追新）。
3. **都没有**（默认，进会话时调用）：
   - 找**第一条未读** `findOne({ sender, receiver: me, readAt: null }).sort(sentAt: 1)`；
   - 没有未读 → 取最新 10 条倒序返回；
   - 有未读 → 取「第一条未读**之前**最多 30 条」（倒序取再 reverse 转正序，作上下文）+「从第一条未读**开始**最多 30 条」（含该条），拼接返回。

> ⚠️ 注意此接口的 `sender` 参数实际指的是「会话对端」，无论对方是发还是收。查询里 `sender` 恒等于对端、`receiver` 恒等于自己，意味着**只能拉取「对端发给我」的消息**，拉不到「我发给对端」的消息。见问题 3。

---

### 4. `PUT /api/message/markreaded` — 批量标记已读

**请求体**（`markMessageReadedScheme`）：

| 字段 | 约束 |
|---|---|
| `messageIds` | string[24] 数组，长度 ≥1，必填（ObjectId 字符串） |

**响应** `200`：`{ message, modifiedCount, unreadMessages }`；若无未读可标则 `{ message: '没有可标记的未读消息', updatedIds: [] }`。

**实现原理**：
1. 把 id 数组转 ObjectId；
2. `find({ _id ∈ ids, receiver == me, readAt: null })` 过滤出「确实是我的且未读」的消息（防止越权标记别人的消息，见问题 5）；
3. `updateMany` 设 `readAt: now`；
4. 对每条**双推** `novi_friend_message_readed` 给双方（`forEach(async ...)`，见问题 6）。

---

### 5. `PUT /api/message/crypto/ack` — 批量确认解密成功

**请求体**（`messageCryptoAckScheme`）：`messageIds` 同上。

**响应** `200`：`{ message, modifiedCount, unAckMessages }`；无则可确认 → `{ message: '没有可确认解密的消息', updatedIds: [] }`。

**实现原理**：与 `markreaded` 几乎完全相同，只是把字段换成 `cryptoAckAt`、事件名换成 `novi_friend_message_crypto_ack`。

> 这个接口是 E2E 流程的「接收端解密成功回执」，但**当前没有配套的加密发送逻辑**（问题 1），所以 `cryptoAckAt` 实际无人会真正因「解密成功」而置位——它现在是空转的占位。

---

## 三、推送机制

与 friend 模块相同的双推模式：落库后读 `user:online:{userId}` 定位节点，`noviNodeIPC.sendToNode` 经 RabbitMQ 投到目标节点，最终 `eventMessageForClientByUserId` emit 事件。本模块用到的事件：

| 场景 | 事件名 |
|---|---|
| 新消息 | `novi_friend_message_comming` |
| 消息已读 | `novi_friend_message_readed` |
| 消息解密确认 | `novi_friend_message_crypto_ack` |

**关键约定**：Socket.IO 只负责「通知 + 轻量数据」，客户端收到事件后必须再发 HTTP 拉取完整数据（拉未读、拉会话）。

---

## 四、代码不合理之处与修改方案

### 问题 1：端到端加密未落地，content 明文入库 + 明文经 MQ 传输 ⚠️ 高（核心卖点未实现）
`plan.md` 的整个价值主张是「每条好友关系一对唯一密钥，平台永远看不到明文」。但当前：
- `content` 明文写进 MongoDB；
- `novi_friend_message_comming` 事件包体携带**明文 content** 经 RabbitMQ 节点间流转；
- `cryptoAckAt` / `crypto/ack` 接口空转。

**修改方案**（按 `plan.md` + `test/generateRSAKeyPair.ts` 参考实现）：
1. 客户端本地持有密钥 5 元组 `{friendId, novicode, 自己私钥, 自己公钥, 对方公钥}`；
2. 发送端：`明文 → sha256 签名 → RSA(对方公钥) 加密`，把**密文 + 签名 + noviCode** 作为 `content` 发上服务器（服务器只存密文）；
3. 服务器**永不接触私钥**，只做密文中转；
4. 接收端：RSA 私钥解密 → 校验 sha256 签名 → 成功后调 `PUT /crypto/ack`；
5. `noviCode` 作为关系版本号，密钥轮换时递增，保证旧消息仍可用旧版密钥解密。
> 落地后 `content` 字段语义变为「密文」，所有现有读写逻辑不变，只是内容不可读。建议加一个 `encrypted: boolean` 字段或按 noviCode 约定，便于灰度。

---

### 问题 2：`POST /` 中「向自己发消息」分支漏 `return` ⚠️ 高（真实 bug）
`message.ts:26-28`：
```ts
if (receiver === myUserId) {
    res.status(400).json({ message: '无法向自己发送消息' });
    // ❌ 这里没有 return！
}
```
漏了 `return`，于是「向自己发消息」会**继续往下执行**：先返回 400，随后又去查好友关系（自己不是自己的好友 → 返回 `400 不能向非好友用户发送消息`，这次覆盖了响应）。更糟的是若逻辑变化，可能在已 `res.json()` 后继续操作数据库。

**修改方案**：补上 `return`：
```ts
if (receiver === myUserId) {
    res.status(400).json({ message: '无法向自己发送消息' });
    return;
}
```
（顺带：这条校验放在 try 外，若 `req.noviUser` 为 undefined 时 `myUserId` 是 undefined，比较行为也需留意。）

---

### 问题 3：`pull/unread/byfriend` 只能拉「对方发给我」的消息 ⚠️ 中（功能缺陷）
接口 3 的查询恒为 `{ sender: <对端>, receiver: me }`，因此**永远拉不到「我发给对端」的消息**。聊天界面若需要展示双向对话，这个接口是不够的。

**修改方案**：查询改为双向：
```ts
{ $or: [
    { sender: me, receiver: peer },
    { sender: peer, receiver: me }
], sentAt: ... }
```
并将参数 `sender` 更名为 `peer`（或 `friendId`）以反映真实语义。

---

### 问题 4：`allfriend` 聚合的 `$unwind` 会丢弃已删用户 ⚠️ 中
同 friend 模块问题 4：`{ $unwind: "$senderInfo" }` 无 `preserveNullAndEmptyArrays`，发送者账号已删时整条未读汇总被静默丢弃。

**修改方案**：`preserveNullAndEmptyArrays: true` + `$project` 里对 `senderInfo.userName` 用 `$ifNull` 兜底为「对方账号已注销」。

---

### 问题 5：`markreaded` / `crypto/ack` 的 `find` 与 `updateMany` 存在 TOCTOU 竞态 ⚠️ 中
先 `find` 出待更新集合，再 `updateMany({ _id ∈ idsToUpdate })`。两步之间若状态被并发修改，`updateMany` 的过滤条件**只有 `_id ∈ ids`，没有再带 `receiver == me, readAt: null`**，理论上可能把并发已读/别人的消息也改掉（虽然 `_id` 唯一，风险低，但语义不严谨）。

**修改方案**：让 `updateMany` 的过滤条件与 `find` 完全一致，直接一步到位：
```ts
const result = await FriendMessage.updateMany(
    { _id: { $in: objectIds }, receiver: myObjectId, readAt: null },
    { $set: { readAt: new Date() } }
);
```
然后若需要「被改动的 sender 列表」用于推送，可在 updateMany 后按 `result.modifiedCount` 或先 select 出来。这样原子且无竞态。

---

### 问题 6：推送用 `forEach(async ...)` 且未等待 ⚠️ 中
`markreaded`/`crypto/ack` 里 `unreadMessages.forEach(async (item) => { ... await redisClient.get(...) ... })`：
- `forEach` 不会 await 内部的 async 回调，所有 redis 读 + MQ 发送**并发无序**执行，且**不阻塞响应**；
- 某条抛错只被内部 try/catch 吞掉记日志，不影响其它条，这点 OK；
- 但「响应返回时推送可能还没发完」，客户端可能先收到「已标记已读」的 200，稍后事件才到，时序上可接受但需前端容错。

**修改方案**：
- 若要求「推送全部发完再返回」：改用 `for...of` + `await`，或 `await Promise.all(messages.map(push))`；
- 若接受 fire-and-forget：至少把 `async` 回调改成不依赖 forEach 语义的显式 `Promise.allSettled`，让错误可统一收集。
推荐后者（不阻塞响应），但用 `Promise.allSettled` 显式化。

---

### 问题 7：分页接口用「时间戳 + limit」分页，存在重复/遗漏风险 ⚠️ 中
`before`/`after` 分支用 `sentAt <= beforeTime` + `limit(30)` 分页。若同一毫秒内有多条消息，翻页时边界消息可能**重复出现或遗漏**（经典的时间戳分页缺陷）。

**修改方案**：
- 改用游标分页：以「上一页最后一条的 `_id` + `sentAt`」作为游标，`sort({ sentAt: -1, _id: -1 })`，条件 `sentAt < cursor.sentAt OR (sentAt == cursor.sentAt AND _id < cursor._id)`；
- 或至少把排序键加上 `_id` 作为次级排序，保证稳定。

---

### 问题 8：`content` 长度上限 200 偏短 ⚠️ 低（产品）
`postFriendMessage` 限制 `content` max 200。E2E 落地后 `content` 是**密文**，RSA 加密后长度远大于明文 200 字（一段 200 字明文 RSA 分段加密后可能是数 KB 的 Base64）。当前上限会在加密后立刻不够用。

**修改方案**：E2E 落地后把 `content` 上限调大（如 65535，配合 MongoDB 文档大小），或把消息正文改为引用存储。当前明文阶段 200 可保留，但需在加密方案里同步调整。

---

## 五、与其它模块的契约

- 发送前依赖 friend 模块的「存在 accepted 好友关系」判定；
- `noviCode` 来自客户端维护的关系版本号（friend 关系建立/密钥轮换时递增）；
- 推送依赖 Redis `user:online:{id}`（由 Socket.IO 心跳维护）；
- 客户端**不缓存聊天记录**，每次进会话都靠接口 2/3 拉取（符合 `plan.md`）。
