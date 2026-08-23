# STACK — Device Management

Decided 2026-08-24 with the user. TypeScript everywhere.

## Backend

- **NestJS (latest) on the Fastify adapter** — modules, DI, guards for RBAC
- **@nestjs/cqrs** — commands/queries/events, light version (see ARCH.md)
- **TypeORM** (user preference over Prisma) — **explicit migrations only;
  `synchronize: false` everywhere outside local dev**
- **PostgreSQL 17** — single source of truth; `btree_gist` for the booking
  exclusion constraint
- **BullMQ + Redis** — scheduled jobs (due-soon/overdue scans) and the email
  outbox worker. Redis is ephemeral/disposable by design
- **nodemailer** — SMTP (our own first, Azercell Exchange later)
- **passport-local** now; **ldapauth** strategy later behind the
  `IdentityProvider` interface
- Excel parsing: **exceljs** (server-side)

### Data access conventions (EF Core style — decided 2026-08-24)

- **`AppDbContext`**: one injectable class holding every repository
  (`ctx.devices`, `ctx.requests`, `ctx.auditLog`, ...) — the EF DbContext
  shape. Handlers depend on it, never on scattered `@InjectRepository`.
- **`ctx.withTransaction(fn)`**: yields a transaction-scoped context; all
  writes in a command handler go through it, so state change + audit row +
  outbox rows commit atomically. TypeORM has no EF change tracker — the
  transaction wrapper is the discipline that replaces SaveChanges.
- **Naming**: camelCase properties in code, snake_case in the database, via
  `SnakeNamingStrategy` (typeorm-naming-strategies). Column names are never
  hand-typed in entities; raw SQL (migrations, constraints) uses snake_case.

## Frontend

- **React (latest) + Vite (latest)**, TypeScript
- **TanStack Query** for server state — no Redux; server data is the state
- **React Router** for pages
- **Tailwind CSS v4** + **shadcn/ui** for components (same family as portfolio)
- Same-origin `/api` — no CORS in production (Traefik routes one host)

## Testing

- **Vitest** on both ends; **supertest** against the Nest app for API tests
- The state machines and the booking-overlap rule get the densest tests —
  they are the product

## Repo layout

```
device-management/
  apps/api/        NestJS
  apps/web/        React + Vite
  docs/            GOALS, ARCH, STACK, ROADMAP
  deploy/          Dockerfiles, k8s notes (manifests live in infrastructure repo)
```

pnpm workspaces, one lockfile.

## Deploy

- Two images to **ghcr.io/orzazade**: `device-mgmt-api`, `device-mgmt-web`
  (nginx static); Redis from the standard image
- **scifilab K3s** via the existing Flux image-automation pipeline; Traefik +
  cert-manager; secrets via SOPS in the `infrastructure` repo
- Host: **devices.scifilab.space** first; Azercell infra later — the app only
  needs "somewhere to run 3 containers + Postgres", nothing scifilab-specific
  baked in
