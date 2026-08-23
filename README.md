# DeviceDesk — Device Management

Internal lending library for Azercell QA test devices. Docs-first:
`docs/GOALS.md` → `ARCH.md` → `STACK.md` → `ROADMAP.md`.

## Status (2026-08-24)

All roadmap slices **S0–S7 built and verified locally** against the clickable
mockup (`mockups/index.html`):

- S0 walking skeleton (deployed once to devices.scifilab.space to prove the pipe)
- S1 auth (JWT, pluggable identity), roles Admin/Manager/Tester, append-only audit
- S2 devices + projects, search/filters, Excel import with dry-run
- S3 request flow: request → approve → handover → active; Postgres exclusion
  constraint blocks double-booking
- S4 return check-in (accessory checklist, damage path), hourly overdue scan
- S5 notifications: event→channel rules, in-app bell, email outbox + sender
- S6 repair lifecycle: reported → repair requested → in repair → fixed/written off
- S7 idle-device report, mobile pass

**S1–S7 are committed locally and NOT yet pushed/deployed** (by decision —
push to main auto-deploys via CI + Flux).

## Local dev

```bash
docker compose up -d      # postgres :5433, redis :6380
pnpm install
pnpm dev:api              # NestJS on :8080 (migrations run on boot)
pnpm dev:web              # Vite on :5173, proxies /api
```

Seed login: `admin@devicedesk.local` / `admin123` (change after first login).
