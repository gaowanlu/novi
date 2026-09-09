# novi

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Your encrypted identity belongs to no company.**

novi is a friend-based chat application built around a single invariant: **the server stores only ciphertext and never holds the keys.** Your per-friendship encryption pairs live entirely on your device — not on a platform's servers, not in a platform's database, portable to any device you own.

## How it works

- **Your identity, portable.** Every friendship gets its own RSA key pair (identified by a `novicode` relationship version) that lives **only on your device**. Messages are RSA-encrypted and SHA256-signed by the sender; the receiver confirms successful decryption via a crypto-ack. When a platform shuts down or bans you, your encryption pairs — and the encrypted history they protect — move with you, because no platform ever held them.
- **Stateless clients.** Clients keep no chat history — only the per-friend key 5-tuples `{friendId, novicode, ownPrivateKey, ownPublicKey, friendPublicKey}`. Private keys are never stored in plaintext on disk: they are wrapped in a local, password-derived AES-256-GCM vault (PBKDF2, ~310k iterations) and live **in memory only** while the session is unlocked. You can export a key backup and re-import it on a new device.
- **Multi-node backend.** The API scales horizontally: a user's live socket connection is pinned to one node, and cross-node delivery is coordinated through Redis (presence) and RabbitMQ (node-to-node IPC). Socket.IO is used strictly for lightweight event *notifications* — the actual ciphertext is persisted and pulled back over HTTP.

> 🔐 The end-to-end crypto is **live**: the send route persists the full encrypted envelope (`content` ciphertext, `iv`, `wrappedKey`, `wrappedKeySelf`, `sig`, `preHash`, `currHash`) and the receiver decrypts locally in the browser via WebCrypto. See [`novi-frontend/src/crypto/`](novi-frontend/src/crypto/) for the client implementation and [`novi-backend/test/e2eCryptoRoundtrip.ts`](novi-backend/test/e2eCryptoRoundtrip.ts) for a self-contained Node-crypto round-trip check. The server still never sees plaintext or private keys.

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
# Create a local .env (gitignored) — there is no committed .env.example:
printf 'VITE_NOVI_HOST=http://localhost:3000\n' > .env
npm run dev   # Vite dev server
```

> **Note:** the frontend's API host is configurable via `VITE_NOVI_HOST` in [`novi-frontend/.env`](novi-frontend/.env) (gitignored, no committed `.env.example`). Point it at your local backend for local development; it falls back to the deployed host when the variable is absent.

## Scripts

**`novi-backend/`**

| Command | Description |
| --- | --- |
| `npm run dev` | Run with auto-restart (transpile-only) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run lint` | Lint (declared; currently broken — no ESLint config) |

**`novi-frontend/`**

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) + build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the production build locally |

## Verification

Neither project has a unit/integration test runner. Quality gates per package:

- **Backend** — `npm run build` (TypeScript compile) is the gate. `npm run lint` is declared but **currently broken** (no ESLint config file present).
- **Frontend** — `npm run lint` (works) then `npm run build`.

`novi-backend/test/` holds ad-hoc scripts (run with `npx tsx <file>`), the most useful being `e2eCryptoRoundtrip.ts`, which exercises the full encrypt → sign → chain → decrypt → verify cycle and tamper detection in Node crypto. Keep its parameters in sync with the frontend's WebCrypto implementation.

## License

This project is licensed under the **Apache License, Version 2.0** — see the [LICENSE](LICENSE) file for details.
