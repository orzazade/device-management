# Deploying Azercell Device Management

Three containers + one database. No vendor-specific parts.

## Pieces

| Container | Image | Port | Notes |
|---|---|---|---|
| `web` | `apps/web/Dockerfile` (nginx, static files) | 80 | `GET /healthz` → `ok` |
| `api` | `apps/api/Dockerfile` (Node 22) | 8080 | `GET /api/v1/health` checks DB + Redis |
| `redis` | `redis:7` | 6379 | queue + scheduler state, disposable |
| `postgres` | `postgres:17` | 5432 | the only thing that needs backups |

Build images from the repo root (the Dockerfiles expect the monorepo context):

```bash
docker build -f apps/api/Dockerfile -t device-mgmt-api .
docker build -f apps/web/Dockerfile -t device-mgmt-web .
```

CI (`.github/workflows/ci.yml`) does the same and pushes to
`ghcr.io/<repo-owner>/device-mgmt-{api,web}` on every push to `main`.

## Routing (important)

The web app calls the API on the **same origin** under `/api`. The reverse
proxy (Traefik, nginx, ingress — anything) must route:

- `https://<host>/api/*` → `api:8080`
- everything else → `web:80`

TLS terminates at the proxy. No CORS setup is needed.

## API environment

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/dbname` |
| `REDIS_URL` | yes | `redis://host:6379` |
| `JWT_SECRET` | **yes in production** | long random string; the API refuses to boot without it |
| `APP_URL` | yes | public URL, used in email links, e.g. `https://devices.example.com` |
| `NODE_ENV` | yes | `production` |
| `PORT` | no | default `8080` |
| `JWT_TTL` | no | token lifetime, default `12h` |
| `SEED_ADMIN_PASSWORD` | no | first-boot admin password; default `admin123` (forced change on first login) |
| `SMTP_URL`, `SMTP_FROM` | no | e.g. `smtp://user:pass@mail.corp.local:587`; unset = emails wait in the outbox (visible under Settings) |

See `env.example` for the same list with comments.

## First boot

1. Start Postgres and Redis, then the API. Migrations run automatically on
   boot (`migrationsRun: true`); nothing to run by hand.
2. The first migration seeds one admin: `admin@devicedesk.local`.
3. Sign in; the app forces a password change. Until that happens, every
   production boot logs `SECURITY: admin account ... still uses the
   factory-default password`.
4. Create projects, then users (Admin → Users), or import devices from Excel
   (Devices → Import Excel → download the template).

## Operations

- **Backups:** the Postgres volume only. Redis holds nothing durable.
- **Scaling:** one replica each is plenty for ~100 users. The API is
  stateless (JWT), so more replicas work if needed.
- **Logs:** both containers log to stdout.
- **Caching:** the web image already sends `Cache-Control: no-cache` for
  `index.html` and `immutable` for hashed assets; no CDN config needed.
- **Corporate login:** the identity provider is pluggable
  (`apps/api/src/auth/identity-provider.ts`); LDAP/SSO can replace the local
  email+password provider without touching the rest.

## Local development

See `README.md` (docker-compose gives you Postgres on :5433 and Redis on :6380).
