# ARCH — Device Management

Shape: **modular monolith + one PostgreSQL**. Two deployable containers
(web static + api) plus a disposable Redis for job queues. No microservices —
at 100 users, splitting services buys nothing and costs operability.

## Modules (NestJS)

- `auth` — login, sessions, pluggable identity provider (local now, LDAP later)
- `users` — profiles, roles (Lab Owner / Admin / Requester), RBAC
- `devices` — device CRUD, accessories, status, Excel import
- `projects` — project entity, device attachment
- `requests` — booking lifecycle: request → approve → handover → return
- `repairs` — damage report → repair lifecycle
- `notifications` — event → channel rules → in-app + email outbox
- `audit` — append-only change log, written inside the same transaction

## CQRS — the light version (decided)

`@nestjs/cqrs`: controllers dispatch **commands** (writes) and **queries**
(reads); command handlers emit **domain events** consumed by event handlers
(notifications, side effects). Hard limits:

- ONE database. No event sourcing. No separate read store.
- A command handler runs in ONE transaction: state change + audit row +
  outbox rows commit together or not at all.
- Events are in-process signals, not a message broker.

## State machines (the heart)

Server-side enforced transitions; any other jump is a 409 error.

- **Request**: `pending → approved | rejected`; `approved → active` (handover
  confirmed) `| cancelled`; `active → returned | overdue`; `overdue → returned`.
- **Device**: `available ↔ assigned`; `any → in_repair → available | retired`.
- **Repair**: `reported → repair_requested → in_repair → fixed | written_off`.

Approval policy is a config flag: `approval_mode = all | busy_only`
(launch: `all`). Flipping it must not require code changes.

## Booking conflicts — enforced by the database

Approved/active bookings for one device must not overlap in time.
Postgres exclusion constraint (`btree_gist`, `tstzrange`) — the app checks
first for a friendly error, but the constraint is the real gate. App bugs
cannot double-book.

## Audit — append-only

One table: actor, entity type + id, action, old → new (jsonb), timestamp.
INSERT-only; no UPDATE/DELETE grants. Written in the command's transaction —
an unaudited change is impossible, not just unlikely.

## Notifications — outbox pattern

1. Domain event fires (request created, approved, handover pending, due soon,
   overdue, repair update).
2. Rules table (event type × channel) says: in-app, email, or both.
3. In-app: notification row, web bell reads it.
4. Email: row in `email_outbox` (Postgres). BullMQ worker sends via SMTP with
   retries. Failed rows stay visible with the error — never silently dropped.

Schedulers (due-soon, overdue scans) are BullMQ repeatable jobs, re-registered
on boot. **Redis is disposable: all truth in Postgres, Redis carries only
"do work now" signals.**

## Excel import — dry run first

Upload → parse → per-row validation report ("97 OK, 3 broken: row 12 missing
brand...") → user confirms → single transaction commit. No silent partial
imports; the report is the contract.

## Auth — pluggable from day one

`IdentityProvider` interface: `local` (email + password) now; `ldap`
(Azercell AD) later as a second implementation behind the same interface.
Sessions/JWT and RBAC live above the interface and don't change.

## API

REST JSON, versioned under `/api/v1`. RBAC enforced server-side per route;
the frontend only hides buttons, never protects anything.
