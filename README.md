# Azercell Device Manager

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

## Roles

- **Admin** — everything, incl. users and settings
- **Manager** — approve, hand over, check in, projects, reports, audit log
- **Tester** — request, extend, return devices
