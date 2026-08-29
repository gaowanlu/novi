# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**novi** is an end-to-end-encrypted, friend-based chat app. Its core value proposition (stated in the README): *"Each friendship, a unique encryption pair the platform can never see."* The server stores only ciphertext and never holds the keys — the cryptographic key material lives entirely on the client.

This is a **monorepo of two independent npm projects** (no root `package.json`; they are not linked):

- `novi-backend/` — Express 5 + TypeScript API (Node ESM, `type: module`)
- `novi-frontend/` — Vite + React 19 + TypeScript SPA

Work inside the relevant subdirectory; there is no root-level build, lint, or install that spans both.

## Commands

All commands run **inside the subproject directory** (`cd novi-backend` or `cd novi-frontend`).

### Dependencies (both)
The backend needs five services. Start them with Docker:
```bash
docker compose -f novi-backend/environment/docker-compose.yml up -d   # from repo root
```
This brings up MongoDB, PostgreSQL, Redis, Kafka (controller + broker), and RabbitMQ, all bound to `127.0.0.1` with the same credentials as `novi-backend/.env.example`.

The backend needs a `.env` (gitignored). Copy the example to get started:
```bash
cd novi-backend && cp .env.example .env
```

### Backend (`novi-backend/`)
```bash
npm run dev      # ts-node-dev, auto-restart on change (transpile-only, fast)
npm run build    # tsc -> dist/
npm start        # node dist/index.js
```
`npm run lint` is declared but there is **no ESLint config file present** in this package, so lint will fail until one is added.

### Frontend (`novi-frontend/`)
```bash
npm run dev      # vite dev server
npm run build    # tsc -b && vite build -> dist/
npm run lint     # eslint .
npm run preview  # serve the production build locally
```
There is **no test runner configured** in either project. (`novi-backend/test/*.ts` are ad-hoc scratch scripts run with `npx tsx`, not unit tests.)

## Environment variables (backend)

Driven by `novi-backend/.env` (see `.env.example`): `NOVI_NODE` (node id), `NOVI_HOST`, `NOVI_PORT` (3000), `NOVI_SOCKETIO_CORS_ORIGIN`, `NOVI_JWT_SECRET`, `NOVI_JWT_TOKEN_TTL`, `MONGO_URI`, `PG_*`, `REDIS_*`, `KAFKA_BROKERS`, `RABBITMQ_URI`, `EXPRESS_STATIC_PATH`.

`EXPRESS_STATIC_PATH` is how the backend serves the built frontend: when set, it serves static files and falls back to `index.html` for all routes (SPA mode). The frontend's API host is currently **hardcoded** to a deployed origin in `novi-frontend/src/api/APIMacro.ts` (`http://mfavant.xyz:3000`) — point it at your local backend for local dev.

## Architecture

### Backend: distributed multi-node design

The backend is designed to run as **many horizontally-scaled node instances** behind a gateway (nginx). Key consequence for any change: a user's live connection is tied to *one specific node*, so cross-node coordination is done through Redis + RabbitMQ rather than in-memory state.

- **`connections/userConnections.ts`** — Socket.IO server (mounted at `/api/ws`). Authenticates each socket with the JWT. On connect it records the user's online status in Redis at key `user:online:{userId}` = value `$NOVI_NODE` with a 5-minute TTL, refreshed by a heartbeat. Holds a local `userId → socket` map. **Socket.IO is used only to push lightweight *event notifications*, never to carry message payloads** — message data always comes back over a subsequent HTTP request.
- **`mq/noviNodeIPC.ts`** — node-to-node messaging over **RabbitMQ**. `sendToNode(node, msg)` + `createNewMessage(userId, event, payload)` build a `{fromNode, forUserId, event, message, timestamp}` envelope; the receiving node dispatches to the local socket via `userConnections.eventMessageForClientByUserId`.
- **`db/dbRedis.ts`** — Redis client, the source of truth for (a) which node a user is on (`user:online:{id}`) and (b) the live auth token (`user:auth:{id}`).

**The notification pattern** (repeated across `routes/friend.ts` and `routes/message.ts`): after any mutation, look up the recipient's node via `redisClient.get('user:online:{id}')`, then `noviNodeIPC.sendToNode(...)` to make the recipient's node emit a Socket.IO event. The client then issues an HTTP call to pull the actual data. Follow this same pattern for any new push event.

Socket.IO event names (the client/server contract, defined in `novi-backend/docs/plan.md`): `novi_friend_request_comming`, `novi_friend_request_processed`, `novi_friend_friend_deleted`, `novi_friend_message_comming`, `novi_friend_message_readed`, `novi_friend_message_crypto_ack`.

### Three datastores, three distinct roles

- **MongoDB** (`db/dbMongo.ts` + `models/mongoModel.ts`, via Mongoose) — the primary store: `User`, `FriendRequest`, `FriendMessage`. `connectMongo` calls `onMongoConnected()` which `syncIndexes()` all schemas.
- **PostgreSQL** (`db/dbPostgres.ts` + `models/postgresModel.ts`, via `pg`) — for "very important" relational data; currently just an `orders` table (auto-created on connect).
- **Redis** (`db/dbRedis.ts`) — transient online status + token TTL, as above.

### Auth: JWT + Redis revocation

`middlewareAuth` (HTTP) and the Socket.IO middleware both require the presented JWT to **match the token stored in Redis at `user:auth:{_id}`**. This gives server-side revocation: `logout` deletes the Redis key, and `heartbeat` extends the token TTL. So a valid-but-rotated JWT is still rejected. Don't bypass the Redis check.

### End-to-end encryption (the intended end-state)

`novi-backend/docs/plan.md` is the authoritative design doc (in Chinese). The intended flow: each friendship gets a `novicode` (a relationship *version number*); each client maintains a 5-tuple per friend — `{friendId, novicode, ownPrivateKey, ownPublicKey, friendPublicKey}`. Messages are RSA-encrypted and SHA256-signed by the sender; the server stores only ciphertext; a receiver confirms successful decryption via `crypto/ack`. The client is meant to store **no chat history**, only the per-friend key 5-tuples.

**Status: designed and referenced, not yet wired into the live message path.** `routes/message.ts` currently persists `content` as plaintext (there is a `novicode` field on the model but it is just a version tag, and no RSA/SHA256 is applied in the route). `novi-backend/test/generateRSAKeyPair.ts` is a reference implementation of the intended RSA encrypt/decrypt round-trip. If you are implementing the crypto, build on that test script and keep the "server never sees keys" invariant.

## TypeScript conventions (differ per project)

- **Backend** is `module: NodeNext` / ESM. **Every relative import must end in `.js`** even though the source file is `.ts` (e.g. `import ... from './logger.js'`). Forgetting this breaks the build.
- **Frontend** is `moduleResolution: bundler` with `verbatimModuleSyntax` and `allowImportingTsExtensions` — use `import type` for type-only imports, and the `@` alias maps to `./src` (in both `vite.config.ts` and `tsconfig.app.json`).

## Frontend structure

- **Routing** (`src/page/App.tsx`): flat routes for `/` (Home), `/signin`, `/signup`, `/logout`, `/functional`, `/user/info`, `/new/friend`, `/about`. Pages live in `src/page/`.
- **Auth** (`src/context/AuthContext.tsx`): a React context persisted to `localStorage` (`jwtToken`, `userInfo`). `useAuth()` is the hook. On logout it clears storage and redirects to `/signin`.
- **API** (`src/api/`): `request.ts` exports `apiFetch`, which injects the `Authorization: Bearer` header and redirects to `/signin` on any 401. `APIMacro.ts` centralizes all endpoint URLs (host + path) — add new endpoints here rather than scattering URLs.
- **UI**: Tailwind CSS v4 + shadcn/ui (style `new-york`, icon lib `lucide`). Generated components are in `src/components/ui/`; app-specific panels in `src/components/` (e.g. `MessagePannel.tsx`, `FriendPannel.tsx`). `components.json` holds the shadcn config. Toasts use `sonner` (`Toaster` mounted in `main.tsx`).
