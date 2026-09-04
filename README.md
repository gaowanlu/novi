# novi

**End-to-end encrypted chat. Each friendship, a unique encryption pair the platform can never see.**

novi is a friend-based chat application built around a single invariant: **the server stores only ciphertext and never holds the keys.** Cryptographic key material lives entirely on the client.

## How it works

- **Per-friendship key pairs.** Every friendship gets its own RSA key pair (identified by a `novicode` relationship version). Messages are RSA-encrypted and SHA256-signed by the sender; the receiver confirms successful decryption via a crypto-ack.
- **Stateless clients.** Clients keep no chat history — only the per-friend key 5-tuples `{friendId, novicode, ownPrivateKey, ownPublicKey, friendPublicKey}`.
- **Multi-node backend.** The API scales horizontally: a user's live socket connection is pinned to one node, and cross-node delivery is coordinated through Redis (presence) and RabbitMQ (node-to-node IPC). Socket.IO is used strictly for lightweight event *notifications* — message payloads always come back over HTTP.

> 📐 The full cryptographic design lives in [`novi-backend/docs/plan.md`](novi-backend/docs/plan.md). The server-side crypto path is designed and referenced but **not yet wired into the live message route** — see the doc for the intended flow.

## Repository layout

novi is a monorepo of two **independent** npm projects (no shared root `package.json`):

| Path | Stack |
| --- | --- |
| [`novi-backend/`](novi-backend/) | Express 5 + TypeScript API (Node ESM). MongoDB (primary store) · PostgreSQL (relational) · Redis (presence + token revocation) · RabbitMQ (IPC) · Socket.IO (event push) |
| [`novi-frontend/`](novi-frontend/) | Vite + React 19 + TypeScript SPA. Tailwind CSS v4 + shadcn/ui |

## Getting started

> Requires Node.js, npm, and Docker (the backend depends on five services).

### 1. Start the backing services

From the repository root:

```bash
docker compose -f novi-backend/environment/docker-compose.yml up -d
```

This brings up MongoDB, PostgreSQL, Redis, Kafka (controller + broker), and RabbitMQ, all bound to `127.0.0.1` with the same credentials as `novi-backend/.env.example`.

### 2. Configure the backend

```bash
cd novi-backend
cp .env.example .env
```

Key variables (see `.env.example` for the full list): `NOVI_NODE`, `NOVI_HOST`, `NOVI_PORT` (default `3000`), `NOVI_JWT_SECRET`, `MONGO_URI`, `PG_*`, `REDIS_*`, `KAFKA_BROKERS`, `RABBITMQ_URI`, and `EXPRESS_STATIC_PATH` (serve the built frontend in SPA mode when set).

### 3. Run the backend

```bash
npm install
npm run dev   # tsx watch, auto-restarts on change
```

### 4. Run the frontend

```bash
cd ../novi-frontend
npm install
npm run dev   # Vite dev server
```

> **Note:** the frontend's API host is currently hardcoded in [`novi-frontend/src/api/APIMacro.ts`](novi-frontend/src/api/APIMacro.ts) — point it at your local backend (`http://localhost:3000`) for local development.

## Scripts

**`novi-backend/`**

| Command | Description |
| --- | --- |
| `npm run dev` | Run with auto-restart (transpile-only) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |

**`novi-frontend/`**

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) + build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the production build locally |

Neither project has a test runner configured.

## License

[Add your license here]
