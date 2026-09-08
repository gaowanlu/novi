# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**novi** is an end-to-end-encrypted, friend-based chat app. Its core invariant (README): *"the server stores only ciphertext and never holds the keys."* Every friendship has its own RSA key pair (`novicode` = relationship version) that lives **only on the client device**. The backend's job is to store and route ciphertext, never to decrypt, sign, or hold key material.

This is the **backend** half of a monorepo of two **independent** npm projects (no shared root `package.json`; they are not linked):

- `novi-backend/` (this directory) — Express 5 + TypeScript API, Node ESM (`type: module`)
- `novi-frontend/` (sibling) — Vite + React 19 SPA that does all the crypto client-side

There is **no root-level install/build/lint** spanning both — run commands inside `novi-backend/`.

## Commands

The backend depends on **five** backing services. Start them from the repo root:

```bash
docker compose -f novi-backend/environment/docker-compose.yml up -d   # from ../ (repo root)
```

Brings up MongoDB, PostgreSQL, Redis, Kafka (controller + broker), RabbitMQ — all bound to `127.0.0.1` with the same credentials as `.env.example`.

Then, inside `novi-backend/`:

```bash
cp .env.example .env   # one-time; .env is gitignored
npm run dev            # tsx watch, auto-restart on change
npm run build          # tsc -> dist/
npm start              # node dist/index.js
```

- `npm run lint` is declared (ESLint 9) but **no ESLint config file exists in this package**, so it will error until one is added. Don't assume lint passes.
- **No test runner is configured.** `test/*.ts` are ad-hoc scratch scripts run manually with `npx tsx test/<file>.ts` (e.g. `e2eCryptoRoundtrip.ts` is a Node-crypto round-trip self-check, not a unit test).

## Environment (`.env`, see `.env.example`)

`NOVI_NODE` (node id, multi-node), `NOVI_HOST`/`NOVI_PORT` (3000), `NOVI_SOCKETIO_CORS_ORIGIN`, `NOVI_JWT_SECRET`, `NOVI_JWT_TOKEN_TTL`, `MONGO_URI`, `PG_*`, `REDIS_*`, `KAFKA_BROKERS`, `RABBITMQ_URI`, `EXPRESS_STATIC_PATH`.

Two that matter most for behavior:
- **`NOVI_JWT_SECRET` is fail-fast** — `config/jwt.ts` throws at startup if unset (an empty secret would let tokens be forged). Missing it = the process won't boot, by design.
- **`EXPRESS_STATIC_PATH`** — when set, the backend serves the built frontend in SPA mode (static files + `index.html` fallback for all routes). This is how a single backend can host the compiled frontend.

## Architecture

### Multi-node: Redis + RabbitMQ, Socket.IO is notification-only

The backend is designed to run as **many horizontally-scaled node instances** behind a gateway. Consequence for any change: a user's live socket is pinned to *one* node, so all cross-node coordination goes through Redis/RabbitMQ, **never in-memory state**.

- **`connections/userConnections.ts`** — Socket.IO server at `/api/ws`. JWT-authenticates each socket, records `user:online:{userId} → $NOVI_NODE` in Redis (5-min TTL, heartbeat-refreshed), keeps a local `userId → socket` map.
- **`mq/noviNodeIPC.ts`** — node-to-node envelope over RabbitMQ: `{fromNode, forUserId, event, message, timestamp}`.
- **`db/dbRedis.ts`** — source of truth for (a) which node a user is on and (b) the live auth token.

**The push pattern** (repeated in `routes/friend.ts` and `routes/message.ts`): after any mutation, call `pushToUsers(userIds, event, payload)` — it reads each recipient's node from Redis and forwards via RabbitMQ to that node, which emits locally. Offline users are skipped silently; one failure never blocks others. **Socket.IO carries lightweight event *notifications* only — the actual message payload is always fetched over a follow-up HTTP request.** Follow this pattern for any new push event.

Socket.IO event names (client/server contract): `novi_friend_request_comming`, `novi_friend_request_processed`, `novi_friend_friend_deleted`, `novi_friend_message_comming`, `novi_friend_message_readed`, `novi_friend_message_crypto_ack`, plus `noviheartbeat`.

### Three datastores, three roles

- **MongoDB** (`db/dbMongo.ts` + `models/mongoModel.ts`, Mongoose) — primary store: `User`, `FriendRequest`, `FriendMessage`. `connectMongo` runs `onMongoConnected()` which `syncIndexes()` all schemas and back-fills legacy `novicode`.
- **PostgreSQL** (`db/dbPostgres.ts` + `models/postgresModel.ts`, `pg`) — relational "very important" data; currently just an auto-created `orders` table.
- **Redis** (`db/dbRedis.ts`) — transient online status + token revocation (see Auth below).

### Auth: JWT + Redis revocation (double check)

`middlewareAuth` (HTTP) **and** the Socket.IO middleware both require the presented JWT to **exactly match the token stored in Redis at `user:auth:{_id}`** — not just be validly signed. This is what makes logout (`DEL` the key) and token rotation actually revoke. `heartbeat` re-extends the TTL. **Do not bypass the Redis equality check** — it is the revocation mechanism.

### End-to-end encryption (live)

E2E crypto is **wired into the live message path** (see `routes/message.ts`): every message persists `content` (ciphertext, base64), `iv`, `wrappedKey`, `wrappedKeySelf`, `sig`, `preHash`, `currHash` — all `required()`. The client does the real crypto (WebCrypto, in `novi-frontend/src/crypto/`); the server only stores and forwards these opaque fields. The matching algorithm params are documented in `novi-frontend/src/crypto/crypto.ts` and mirrored by the Node self-check `test/e2eCryptoRoundtrip.ts` — **keep the two in sync** if you touch crypto.

Key mechanics that depend on the data model:
- **`novicode` (relationship generation).** Server-assigned, monotonic: `count(all bidirectional FriendRequest history) + 1`. Records only *flip status*, never hard-delete, so the count only grows (first add = `"1"`, delete-then-re-add = `"2"`…). The client pre-derives the same value from a fresh `GET` and self-heals (relabels) if the server's differs. Each generation has its own key pair and hash chain.
- **Generation isolation.** Because a new generation uses new keys, old-generation ciphertext is undecryptable after re-adding. So: `friend`-delete **cascade-deletes the old `FriendMessage`s**, and the unread aggregation (`GET /message/allfriend`) filters to only the *current* accepted generation's `novicode`. Don't reintroduce old-generation messages into unread counts or pull windows.
- **`crypto/ack` gates `read`.** `cryptoAckAt` (receiver confirmed successful decryption) must be set before `readAt`; `PUT /message/markreaded` only marks messages that are `readAt: null` **and** `cryptoAckAt != null`. Preserve that dependency.
- **`seq` + unique partial index.** `seq` increments per `(sender, receiver, noviCode)`; a unique *partial* index (only rows where `seq` is a number — legacy plaintext rows have `seq=null`, and Mongo unique indexes would collide on null) enforces it. Concurrent inserts that hit the index (E11000) are retried up to 5×.
- **`wrappedKeySelf`** is the same data key RSA-wrapped under the *sender's own* public key, so a sender can re-read their own history after the recipient's side is gone. It is `.optional()` for backward compat with older clients.

## TypeScript convention (will break the build if wrong)

Backend is `module: NodeNext` / ESM. **Every relative import must end in `.js`** even though the file is `.ts` (e.g. `import { logger } from '../logger.js'`). Forgetting the `.js` suffix fails `tsc`/runtime resolution. (The frontend differs: `moduleResolution: bundler` + `@` → `./src`.)

## Invariants to preserve

1. **The server never sees plaintext or private keys.** Public keys are stored for the key-exchange handshake only — that is fine. Anything that would let the server decrypt or derive key material violates the product.
2. **No in-memory user state** that must survive across nodes — use Redis/RabbitMQ.
3. **Push = notification, data = HTTP.** New events follow `pushToUsers`; clients pull the payload.
4. **Keep WebCrypto ↔ Node-crypto params identical** (`test/e2eCryptoRoundtrip.ts` is the reference).

## Note

The authoritative design doc `docs/plan.md` referenced in the root README and in `novi-frontend/src/crypto/*` comments was **deleted** (commit `b9f4c0f` "delete: mock"). The invariants now live in the root README and these source comments. If the README/old docs still say the crypto "is not yet wired into the live message route," that is stale — it *is* wired (see `routes/message.ts`).
