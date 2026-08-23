# ROADMAP — Device Management

Build in vertical slices. Every slice ends **deployed to
devices.scifilab.space and clickable** — never weeks of invisible backend.
A slice is done only when its tests pass and it runs live.

## S0 — Walking skeleton (infrastructure proof)

- pnpm workspace: `apps/api` (NestJS + Fastify), `apps/web` (React + Vite)
- Postgres + Redis in docker-compose for local dev
- TypeORM wired: `AppDbContext`, `withTransaction`, SnakeNamingStrategy,
  first migration runs
- Dockerfiles for both apps; GitHub Actions CI (lint, test, build, push to
  ghcr.io/orzazade); Flux manifests in the `infrastructure` repo
- Live proof: web page shows "ok" + api `/api/v1/health` shows db + redis up

Smallest possible slice that proves the whole pipe: code → CI → image →
Flux → cluster → URL. Everything after this is just features.

## S1 — Users, auth, roles

- Local `IdentityProvider` (email + password), sessions
- Roles: Admin / Manager / Tester; RBAC guards on API routes
- Seed: one Admin; Managers can create users
- Login page, user list (admin), profile
- Audit module lands here: every mutation from S1 on writes audit rows

## S2 — Devices + projects

- Device entity full CRUD (brand, model, OS + version, specs, serial/IMEI,
  status, damage status, accessories list); Project entity + attachment
- Search + filters (brand, OS, status, holder, project)
- Excel import with dry-run report (N OK / M broken, row-by-row reasons)
- Device detail page with history placeholder

## S3 — The request flow (the product)

- Request: device + reason + time range → pending
- Approve / reject (Manager), Admin final gate, `approval_mode` config flag
- On approve: previous holder notified (in-app), confirms handover → device
  assigned, request active
- Booking-overlap exclusion constraint in Postgres (btree_gist) + friendly
  app-side check
- Admin time-range override; on-behalf-of requests
- Request state machine fully tested — densest tests in the repo

## S4 — Return, due dates, overdue

- Return check-in: accessory checklist verification, device → available
- BullMQ repeatable jobs: due-soon scan, overdue scan (re-registered on boot)
- Overdue state + reminders; request history on device + user pages

## S5 — Notifications done properly

- Event → channel rules table (event type × in-app/email/both), admin UI
- In-app bell (unread count, list)
- Email outbox in Postgres + BullMQ sender worker + retries; failed sends
  visible with errors, never dropped
- SMTP via our infra; Exchange swap is config, not code

## S6 — Repairs

- Damage report → repair request → in repair → fixed / written off
- Device auto-unavailable while in repair; holder + admin notified
- Repair history on device page

## S7 — Polish + ship to the team

- Audit log viewer (Admin)
- Dashboard: my devices, my requests, pending approvals
- Empty states, error states, mobile-friendly pass
- Idle-device report (simple version — it sells the tool to managers)

## Later (post-v1, in GOALS)

- Azercell LDAP/AD provider + Exchange SMTP; move to their infra
- QR stickers + scan handover/return
- Waitlist; auto-approve free devices (flip `approval_mode`); usage analytics

## Order rationale

Auth before devices (everything needs identity + audit). Devices before
requests (can't book what doesn't exist). The request flow (S3) is the
earliest moment the tool is genuinely useful — after S3 the wife's team can
pilot it for real; S4-S7 make it trustworthy.
