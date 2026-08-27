# Azercell Device Management

Internal lending library for QA test devices (phones, tablets): find a free
device, request it for a date range, get approval, hand it over, return it.
Every action is audited.

Docs: `docs/GOALS.md` → `docs/ARCH.md` → `docs/STACK.md` → `docs/ROADMAP.md`.
Deployment: **`DEPLOY.md`**.

## What's inside

| Path | What |
|---|---|
| `apps/api` | NestJS (Fastify) API — rules, auth, jobs, migrations |
| `apps/web` | React + Vite single-page app, served by nginx |
| `deploy/nginx.conf` | nginx config baked into the web image |
| `docker-compose.yml` | Postgres + Redis for local development |
| `env.example` | Every environment variable the API reads |
| `.github/workflows/ci.yml` | lint → test → build → push images |

## Run locally

```bash
docker compose up -d      # postgres :5433, redis :6380
pnpm install
pnpm dev:api              # API on :8080 (migrations run on boot)
pnpm dev:web              # web on :5173, proxies /api to :8080
```

First login: `admin@devicedesk.local` / `admin123` — the app forces a new
password on first sign-in.

### Without Docker

If Postgres and Redis run as local services on the default ports (5432 /
6379) instead of docker-compose (5433 / 6380), point the API at them. Copy
`env.example` to `.env` at the repo root — the API loads it on boot — or
export the variables:

```bash
DATABASE_URL=postgres://devmgmt:devmgmt@localhost:5432/devmgmt
REDIS_URL=redis://localhost:6379
```

Only the `devmgmt` role and database need to exist; migrations create the
rest on first boot.

### Notes for test automation

- The seeded admin always gets the mandatory password-change dialog. Create
  a run-scoped admin over the API (`POST /api/v1/users` as admin) and sign
  in with that instead.
- Load-bearing elements carry `data-testid` (rows, action buttons, dialog
  root, chips, nav links, login form) — prefer those over visible copy.
- The app shell shows a 2-second brand splash on every load (a product
  decision); waits should allow for it.

## Roles

- **Admin** — everything, incl. users and settings
- **Manager** — approve, hand over, check in, projects, reports, audit log
- **Tester** — request, extend, return devices
