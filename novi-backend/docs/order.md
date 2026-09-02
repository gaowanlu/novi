# Order 模块文档

> 路由前缀：`/api/order`（`src/index.ts` 中 `app.use('/api/order', orderRouter)`）
> 源文件：`src/routes/order.ts`
> 数据层：`models/postgresModel.ts` + `db/dbPostgres.ts`（**PostgreSQL**，非 MongoDB）

本模块是 novi 里唯一走 **PostgreSQL** 的模块，对应 `plan.md` 中「Postgres 存用户相关的一些非常非常重要的数据」。当前只有一张 `orders` 表，用于演示「极重要数据」的存储范式。

> ⚠️ 与其它模块最大的不同：**order 模块没有任何鉴权**（没有 `middlewareAuth`），且用数字型 `user_id`（INT）而非 MongoDB 的 ObjectId 标识用户。这导致它与 user/auth 模块的用户体系**完全脱节**（见问题 1）。

---

## 一、数据模型（PostgreSQL `orders` 表）

由 `db/dbPostgres.ts` 的 `updateDatabaseNovi()` 在连接时自动创建：

```sql
CREATE TABLE IF NOT EXISTS orders(
    id          SERIAL PRIMARY KEY,        -- 自增主键
    user_id     INT NOT NULL,              -- 用户ID（数字，非 ObjectId）
    amount      INT NOT NULL,              -- 金额，单位为「分」
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
```

TypeScript 接口（`dbPostgres.ts`）：
```ts
interface Order { id: number, user_id: number, amount: number, created_at: Date }
```

连接池 `pgPool` 在模块加载时即创建（`new PgPool(...)`，读 `PG_*` 环境变量），连接事件打日志。

---

## 二、接口清单

### 1. `POST /api/order/` — 创建订单

**请求体**（`postOrderSchema`）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `user_id` | number | 整数，必填 |
| `amount` | number | 整数（单位：分），必填 |

**响应**：`201` 返回新订单对象（`INSERT ... RETURNING *`）；`400` 参数校验；`500` DB 错误。

**实现原理**：
1. `middlewareValidate(postOrderSchema)` 校验（Joi `Joi.number().integer()`）；
2. handler 里又做了一次 `typeof user_id !== 'number' || Number.isNaN` 的**重复校验**（见问题 3）；
3. `createOrder(user_id, amount)` 执行 `INSERT INTO orders (user_id, amount, created_at) VALUES ($1, $2, NOW()) RETURNING *`，返回 `rows[0]`。

---

### 2. `GET /api/order/?user_id=` — 查询某用户全部订单

**查询参数**（`getOrderSchema`，走 `middlewareValidate(..., 'query')`）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `user_id` | number | 整数，**schema 里可选**，但 handler 里强制必填（见问题 3） |

**响应**：`200` 返回 `Order[]`；`400 缺少 user_id 参数` / `400 user_id 非法`；`500`。

**实现原理**：
1. 读 `req.query.user_id`，缺失 → 400；
2. `parseInt` 转数字，NaN → 400；
3. `selectOrderByUserId(user_id)` 执行 `SELECT * FROM orders WHERE user_id = $1`。

> ⚠️ schema 里 `user_id` 是 `Joi.number().integer()`（无 `.required()`），但 query 参数经 Joi 校验时**字符串 `"123"` 会被 coerce 成 number 123**（Joi 对 number 有默认转换），所以能过校验。不过「可选」与「handler 强制必填」的语义不一致（见问题 3）。

---

### 3. `DELETE /api/order/?id=&user_id=` — 按 id + user_id 删除订单

**查询参数**（`deleteOrderSchema`，走 `middlewareValidate(..., 'query')`）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | number | 整数 |
| `user_id` | number | 整数 |

**响应**：`200` 返回被删除的 `Order[]`（`DELETE ... RETURNING *`；未匹配到则返回 `[]`）；`400` 缺参/非法；`500`。

**实现原理**：
1. 读 `id`、`user_id`，任一缺失 → 400；
2. `parseInt`，NaN → 400；
3. `deleteOrderByIdAndUserId(id, user_id)` 执行 `DELETE FROM orders WHERE id = $1 AND user_id = $2 RETURNING *`；
4. `rowCount === 0` 时记 info 日志并返回 `[]`。

> `AND user_id = $2` 这层是「归属校验」，防止删别人的订单——但**前提是调用方诚实传入了自己的 user_id**，因为没有鉴权（见问题 1）。

---

## 三、数据访问层（postgresModel.ts）

三个纯函数，都用 `pgPool.query(sql, params)` 参数化查询（**无 SQL 注入风险**）：

| 函数 | SQL | 说明 |
|---|---|---|
| `createOrder(user_id, amount)` | `INSERT ... RETURNING *` | 返回 `rows[0]` |
| `selectOrderByUserId(user_id)` | `SELECT * FROM orders WHERE user_id=$1` | 返回 `rows` |
| `deleteOrderByIdAndUserId(id, user_id)` | `DELETE ... RETURNING *` | rowCount 0 时返回 `[]` |

每个函数内部都有 try/catch，记日志后 `throw err` 上抛，由 route 的 catch 转成 500。

---

## 四、代码不合理之处与修改方案

### 问题 1：无鉴权 + user_id 与用户体系脱节 ⚠️ 高（最严重）
- **完全没有 `middlewareAuth`**：任何人（甚至匿名）都能 `POST /api/order/` 创建、`GET`/`DELETE` 任意 `user_id` 的订单。「按 user_id 归属校验」形同虚设，因为攻击者可以传任意 user_id 读/删他人数据。
- **`user_id` 是 INT**，而 user/auth 模块用的是 MongoDB ObjectId 字符串（24 位 hex）。两套 ID 体系毫无关联，`orders.user_id` 根本对不上任何真实用户。

**修改方案**：
1. 加 `middlewareAuth`，用 `req.noviUser._id` 作为当前用户，**不再信任客户端传入的 user_id**：
   - `POST /api/order/`：`user_id` 取自 `req.noviUser._id`（去掉请求体里的 user_id 字段）；
   - `GET /api/order/`：默认查自己，去掉 `user_id` 查询参数（或仅允许带 `?user_id=自己`）；
   - `DELETE /api/order/?id=`：归属用 `WHERE id=$1 AND user_id=<jwt 的 _id>`。
2. **ID 体系统一**：`orders.user_id` 改为 `TEXT`（存 ObjectId 字符串）或 `CHAR(24)`，与 `User._id` 对齐。迁移：`ALTER TABLE orders ALTER COLUMN user_id TYPE TEXT`（需先做数据映射）。
   > 若坚持用 Postgres 自增 INT 做业务主键，则需引入一张 `id ↔ ObjectId` 映射表，复杂度更高，不推荐。

---

### 问题 2：金额 `amount` 用 INT 存「分」，但未校验非负/上限 ⚠️ 中
`amount` 语义是「金额，单位为分」，但 schema 只校验 `Joi.number().integer()`，**允许负数、0、超大值**。负金额订单在业务上无意义，超大值可能溢出 INT（>2147483647 分 ≈ 2147 万元）或造成下游计算异常。

**修改方案**：
```ts
amount: Joi.number().integer().min(0).max(2_147_483_647).required()
```
若金额可能更大或需小数，改用 `NUMERIC`/`DECIMAL` 列 + `Joi.number()`。

---

### 问题 3：重复校验 + schema 与 handler 语义不一致 ⚠️ 中（可维护性）
- `POST /` 的 handler 在 Joi 校验**之后**又手写 `typeof user_id !== 'number' || Number.isNaN(user_id)`——Joi 的 `Joi.number().integer()` 已经保证了是整数，这段是死代码/冗余。
- `GET /` 的 schema 里 `user_id` 是可选，但 handler 里 `if (!userIdRaw)` 强制必填，两处语义打架。
- `GET/DELETE` 里 `parseInt(String(userIdRaw), 10)` + `Number.isNaN` 的转换，与 Joi 已做的 number coerce 重复。

**修改方案**：
- 删除 handler 里所有冗余类型检查，**信任 Joi**（Joi 已通过则必为合法整数）；
- `GET /` 的 schema 把 `user_id` 标 `.required()`（若确实必填），或 handler 去掉必填判断（若确实可选）——二选一，保持一致；
- 统一「Joi 负责校验，handler 只管业务」的分工。

---

### 问题 4：`SELECT *` / `RETURNING *` 直接返回整行 ⚠️ 低
三处都用 `*` 返回。当前列少问题不大，但一旦表加列（如敏感字段），会**自动外泄**给前端。

**修改方案**：显式列名 `SELECT id, user_id, amount, created_at FROM ...`，或用 DTO 投影，控制返回面。

---

### 问题 5：`connectPostgres` 拿了 client 却不归还，且建表不在事务 ⚠️ 中（资源/健壮性）
`db/dbPostgres.ts` 的 `connectPostgres`：
```ts
const client = await pgPool.connect();   // 从池里借出
await updateDatabaseNovi();              // 用的是 pgPool 而不是这个 client
// ❌ client 从未 release 回池
```
- 借出的 `client` 没有 `release()`，每次调用（虽然目前只在启动调一次）都会**泄漏一个连接**，多次调用会耗尽池；
- `updateDatabaseNovi()` 实际用的是 `pgPool.query`（多语句），与借出的 `client` 无关，借 client 这一步是多余且有害的。

**修改方案**：
```ts
export const connectPostgres = async (): Promise<void> => {
    // 直接探测连接 + 建表，不手动借 client
    await pgPool.query('SELECT 1');
    await updateDatabaseNovi();
    logger.info('Postgres connected & schema ready');
}
```
若需要多语句建表，`pgPool.query(sql)`（非 client）已支持多语句，无需借 client。

---

### 问题 6：`SELECT*` 缺空格 ⚠️ 低（风格）
`postgresModel.ts:34` `'SELECT* from orders where user_id=$1'`——`SELECT*` 之间无空格。Postgres 恰好能解析（token 化时 `SELECT` 后跟 `*` 没问题），但极易误导阅读，且换个解析严格的客户端/ORM 会炸。

**修改方案**：改为 `'SELECT * FROM orders WHERE user_id = $1'`，顺带统一大小写风格。

---

### 问题 7：金额单位「分」硬编码在注释里，无文档化契约 ⚠️ 低
「amount 单位为分」只写在 SQL 注释和函数 JSDoc 里，接口文档层（本文档 + 前端）容易误解为「元」。

**修改方案**：在 schema 字段名或响应里显式体现单位，如 `amount_cents`，或在 API 文档中强制标注，避免前后端单位错位。

---

## 五、与其它模块的关系

- 目前 order 模块是**孤立**的：不引用 `User`（Mongo）、不经过 auth、ID 体系独立。它更像「Postgres 存储范式的 demo」。
- 若要让它真正承载「极重要数据」（`plan.md` 的设想），必须按问题 1 接入用户体系与鉴权，否则它只是隔离在 Mongo 世界之外的孤岛。
- 连接初始化在 `index.ts` 的 `startServer()` 中：`connectPostgres()` 与 Mongo/Redis 并行 await，失败会 `throw` 导致进程退出（fail-fast，合理）。
