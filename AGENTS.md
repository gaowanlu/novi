# AGENTS.md

Guidance for working in this repository. The root README covers the design; this file captures the non-obvious, code-level facts that are easy to get wrong.

## Two independent packages — no root tooling

There is **no root `package.json`, build, or install**. `novi-backend/` and `novi-frontend/` are not linked; always run commands inside the subproject you're editing.

```bash
# From repo root — start the 5 backing services (Mongo, Postgres, Redis, Kafka, RabbitMQ)
docker compose -f novi-backend/environment/docker-compose.yml up -d

cd novi-backend   && cp .env.example .env   # one-time; .env is gitignored
cd novi-backend   && npm run dev            # tsx watch, auto-restart
cd novi-frontend  && npm run dev            # vite dev server
```

- **Backend lint is broken**: `npm run lint` is declared but no ESLint config file exists in `novi-backend/`. Don't assume it passes; gate on `npm run build` (`tsc`).
- **No test runner** in either package. `novi-backend/test/*.ts` are ad-hoc scripts run with `npx tsx test/<file>.ts` — not unit tests. `test/e2eCryptoRoundtrip.ts` is a Node-crypto self-check that mirrors the frontend's WebCrypto; keep the two in sync.
- **Frontend** gates: `npm run lint` then `npm run build` (build runs `tsc -b`).

## Environment gotchas

- `NOVI_JWT_SECRET` is **fail-fast**: `src/config/jwt.ts` throws at startup if unset/empty. The process won't boot without it — by design.
- `EXPRESS_STATIC_PATH` (backend): when set, serves the built frontend in SPA mode (static + `index.html` fallback).
- Frontend API host is **not hardcoded** — it reads `VITE_NOVI_HOST` from `novi-frontend/.env` (gitignored). Local dev: set `VITE_NOVI_HOST=http://localhost:3000`. (An older mock-server flow was removed in commit `b9f4c0f`.)

## Invariants — do not break

1. **The server never sees plaintext or private keys.** Every message persists only `content` (ciphertext, base64), `iv`, `wrappedKey`, `wrappedKeySelf` (optional), `sig`, `preHash`, `currHash` — all `required()` (except `wrappedKeySelf`). The server stores/routes; it never decrypts, signs, or holds key material. Client crypto lives in `novi-frontend/src/crypto/`.
2. **No in-memory user state that must survive across nodes.** The backend scales horizontally; a user's socket is pinned to one node, so all cross-node coordination goes through Redis (presence + token) and RabbitMQ (`mq/noviNodeIPC.ts`).
3. **Push = notification, data = HTTP.** Socket.IO (`/api/ws`) carries only lightweight event notifications; the client always pulls the actual payload over a follow-up HTTP request. New push events follow the existing `pushToUsers` pattern in `comm/push.ts`.
4. **Auth is JWT + Redis equality, not just signature.** `middlewareAuth` and the Socket.IO middleware both reject a token unless it exactly matches `user:auth:{_id}` in Redis. That equality check *is* the revocation mechanism (logout deletes the key, heartbeat re-extends TTL). Do not reduce it to a signature check.

## Message / friendship data model

- **`novicode` = relationship generation.** Server-assigned, monotonic (`count of all FriendRequest history + 1`). Records only flip `status`, never hard-delete, so it only grows. Each generation has its own key pair and hash chain; a new generation makes old ciphertext undecryptable. Friend-delete **cascade-deletes** that generation's `FriendMessage`s, and unread aggregation (`/message/allfriend`) filters to the current `novicode`. Don't let old-generation messages leak into unread counts or pull windows.
- **`crypto/ack` gates `read`.** `cryptoAckAt` (receiver confirmed decryption) must be set before `readAt`; `PUT /message/markreaded` only marks rows where `readAt == null` **and** `cryptoAckAt != null`. Preserve the dependency.
- **`seq`** increments per `(sender, receiver, noviCode)` with a unique **partial** index (only rows where `seq` is a number — legacy plaintext rows have `seq: null`; a plain unique index would collide on nulls). Concurrent inserts hitting E11000 retry up to 5×.

## TypeScript conventions (differ per package)

- **Backend** is `module: NodeNext` / ESM. **Every relative import must end in `.js`** even though the file is `.ts` (`import { logger } from '../logger.js'`). Forgetting the suffix breaks `tsc`/runtime.
- **Frontend** is `moduleResolution: bundler` + `verbatimModuleSyntax` + `allowImportingTsExtensions`. Use `import type` for type-only imports; the `@` alias maps to `./src`.

## Frontend structure

- Routes are flat in `src/page/App.tsx`; pages live in `src/page/`. Auth is a React context (`src/context/AuthContext.tsx`, `useAuth()`) persisted to `localStorage`.
- All endpoint URLs are centralized in `src/api/APIMacro.ts` — add new endpoints there, not scattered. `src/api/request.ts` (`apiFetch`) injects the Bearer header and redirects to `/signin` on 401.
- UI is Tailwind v4 + shadcn/ui; generated components in `src/components/ui/`, app panels in `src/components/`. `components.json` holds the shadcn config (use the `shadcn` skill when touching UI).
- **WhatsApp-inspired design system.** The brand is a green (shadcn `--primary`) and the whole app reads like WhatsApp. Chat surfaces use a dedicated palette in `src/index.css` (light + dark): `--wa-*` tokens → `wa`, `wa-header`, `wa-panel`, `wa-wallpaper`, `wa-bubble`, `wa-bubble-in`, `wa-ink`, `wa-muted`, `wa-line`, plus a `wa` color *scale* (50/100/500/600/700/800/900) registered in `components.json`. The `.chat-wallpaper` utility (defined in `index.css`) paints the faint doodle backdrop of the message area. Use these for chat UI; use normal shadcn tokens for auth/marketing pages.
- **Bubbles are hardcoded WhatsApp colors** in `MessagePannel.tsx` (mine `#d9fdd3`/`#005c4b`, theirs `#ffffff`/`#202c33`, ticks `#8ed6bb`), *not* token variables — because `bubble.tsx`'s variants use `bg-primary` which would break on the `destructive` (error) variant. If you restyle bubbles, keep them self-contained so `destructive` stays red.
- **Control sizing: use the shadcn *default* sizes, don't hand-size.** `Button` (no `size`) is `h-9`; `Input` is `h-9` — do not add `h-*`/`size-*` overrides that diverge from the generated defaults (e.g. the home hero uses `size="lg"` / `h-11` *on purpose*; a normal form/button must not). Match the sign-in page: full-width `Button` with no `size` prop, `Input` with no height override.
