# QA findings — from building the Selenium E2E suite

**Date:** 2026-08-27 · **Source:** writing and running `e2e/` (109 automated browser tests)
**Audience:** engineers working on this app. The PO-facing summary is `e2e/reports/test-cases.pdf`.

This is a working document. Everything below was observed while driving the real app in a real
browser against a live API and database — not read off the source. Where a claim is unverified it
says so explicitly.

---

## 1. Test run results

| | |
|---|---|
| Test cases | 96 (109 executions — 9 are parameterised) |
| Result | **109 passed, 0 failed** |
| Duration | 10m24s, headed Chrome, sequential |
| Stack | Vite `:5173` → NestJS `:8080` → Postgres `:5432` + Redis `:6379` |
| Command | `cd e2e && ./run-e2e.sh` |

No application 500s occurred during a full run. The only errors in the API log were three
`no_overlapping_bookings` exclusion-constraint violations — those are the database correctly
refusing the double-booking test, and they surface to the user as a clean message.

**Coverage:** 15/15 routes, 11/11 pages, 19/21 components, **42/52 frontend→API operations (81%)**.
There is no instrumented line coverage; see §5.

---

## 2. Confirmed findings

Ranked by impact. Each was reproduced in the browser.

### F-01 · HIGH · Audit CSV export silently exports only the loaded page

**Where:** `apps/web/src/pages/Audit.tsx:89` — `const rowsFlat = pages.data?.pages.flat() ?? []`

The audit log is paginated with `useInfiniteQuery` at `PAGE = 100` (`Audit.tsx:20`). Export CSV
serialises **only the pages already fetched**. On a filtered view with 5,000 matching entries, a
user who has not clicked "Load older entries" 49 times gets a file containing the first 100 rows —
with no warning, no row count, and a filename that implies completeness.

**Why it matters:** this is the compliance feature of the product. An auditor handed a truncated
export has no way to tell it is truncated. Silent incompleteness is worse than a failed export.

**Suggested fix:** fetch the full filtered set server-side for the export (a dedicated
`GET /audit/export.csv` streaming endpoint honouring the same filters is the clean version), or at
minimum disable the button while `hasNextPage` is true and label it "Export loaded rows (100)".

**Not covered by a test.** `CFG-09` only asserts the button exists. Worth adding once fixed.

---

### F-02 · MEDIUM · Audit actor filter drops characters when typed at speed

**Where:** `apps/web/src/pages/Audit.tsx:26-36` — `actor` is read from the URL and written back
per keystroke via `setFilter`.

The input is controlled by a value that round-trips through the router. Each keystroke calls
`setParams`, and the re-render resets the box to whatever the URL had already committed — so
characters typed faster than that round-trip are lost. Typing `Admin` quickly leaves `n` in the box
and `?actor=n` in the URL.

**Reproduced:** Selenium `send_keys("Admin")` produced `?actor=n`. A human typing normally does not
hit it, which is why it has gone unnoticed — but paste-then-edit and fast typists will.

**Suggested fix:** keep the input's own local state and debounce the URL write (~250ms), the same
pattern `Devices.tsx:49-53` already uses for its search box. `Devices.tsx` is the model to copy.

**Test workaround in place:** `e2e/pages/admin_pages.py::AuditPage.filter_actor` types one
character at a time with a 120ms gap. Remove that once fixed.

---

### F-03 · MEDIUM · No `data-testid` anywhere in `apps/web`

Zero occurrences across the whole frontend. Every selector in the suite therefore rests on the
`name` attribute `VField` happens to render, on visible copy, or on Tailwind class fragments.

**Why it matters:** a copy edit to a button label breaks tests that have nothing to do with that
button. Three separate selector bugs during this work traced back to it (F-05, F-06, and the
overlay-button collision in §4).

**Suggested fix:** add `data-testid` to the load-bearing elements only — table rows, dialog roots,
primary action buttons, status chips. Roughly 30 attributes would remove most of the fragility.
Highest value: `RequestTable` rows and action buttons, `Modal` root, `Chip`.

---

### F-04 · MEDIUM · A 401 triggers a full page reload, and is handled twice

**Where:** `apps/web/src/lib/api.ts:32-35` and `apps/web/src/lib/auth.tsx:47-56`

`api()` responds to any non-login 401 with `window.location.href = '/login?expired=1'` — a hard
browser navigation that discards the SPA, the React Query cache and any unsaved form state.
Meanwhile `AuthProvider` *also* catches 401/403 on `/auth/me` and clears the token. Two code paths
own the same event, and the harder one wins the race.

**Why it matters:** a session that expires while a user is mid-form loses their typed work with no
warning. The hard reload also throws away the `from` location, so the "return to the page you asked
for" behaviour (tested as `AUTH-09`) does not apply on expiry.

**Suggested fix:** route the 401 through the router (`navigate('/login?expired=1', {state:{from}})`)
rather than `window.location`, and let `AuthProvider` be the single owner of session invalidation.

---

### F-05 · LOW-MEDIUM · Every app-shell load costs a fixed 2 seconds

**Where:** `apps/web/src/components/Layout.tsx:54-58` — `setTimeout(() => setBooting(false), 2000)`

A deliberate brand splash, minimum 2s, on every mount of the app shell: every hard reload, and
every sign-in. It is not per route change.

**Why it matters:** it is 2s of nothing on every refresh, and it is the single largest contributor
to the suite's 10-minute runtime (109 tests × at least one shell load each). For a tool people
reload all day, an unskippable splash is a tax.

**Suggested question for the PO, not a unilateral fix:** was 2s intentional, or a placeholder? A
common compromise is to show the splash only until the first data query resolves, capped at ~600ms.

---

### F-06 · LOW · Sidebar count badges have no separating whitespace

**Where:** `apps/web/src/components/Layout.tsx:140-149` — `<NavLink>Requests<Badge/></NavLink>`

The badge `<span>` follows the label text with no space, so the anchor's text content is
`Requests3`, not `Requests 3`. Screen readers announce it that way, and any text-based selector
sees it that way.

**Suggested fix:** add `aria-label` to the badge (`aria-label="3 items need attention"`) and a
space or `sr-only` separator in the markup.

---

### F-07 · LOW · `RequestTable` renders every row twice

**Where:** `apps/web/src/components/RequestTable.tsx:27` (mobile cards) and `:58` (table)

Both variants are always in the DOM; CSS hides one. For a lab-wide "All requests" view this doubles
the node count and duplicates every row's text for assistive technology and for `Ctrl+F`.

**Suggested fix:** low priority, but a single render with a CSS-driven layout, or a width hook that
renders one branch, would halve the DOM and remove the duplicate text.

---

### F-08 · LOW · Side effect during render in `ToastProvider`

**Where:** `apps/web/src/components/Toasts.tsx:41` — `emit = push;` sits in the component body.

Assigning to a module-level variable during render is not safe under StrictMode double-rendering or
concurrent features. It works today; it is the kind of thing that breaks on a React upgrade.

**Suggested fix:** move into `useEffect(() => { emit = push; return () => { emit = null; }; }, [push])`.

---

### F-09 · LOW · `document.title` effect runs on every render

**Where:** `apps/web/src/components/Layout.tsx:89-93` — `useEffect` with no dependency array.

Recomputes and reassigns the title on every render of the shell, including every badge poll
(three queries refetch on 30s/60s intervals). Harmless but wasteful.

**Suggested fix:** `}, [location.pathname]);`

---

### F-10 · LOW · Dialog buttons repeat the label of the row that opened them

Not a defect, but a real ambiguity. "Cancel booking", "Cancel report" and "Delete" each appear both
on a table row and inside the confirmation dialog that row opens. With the dialog open, the page
contains two identically-labelled buttons doing different things — a screen-reader user tabbing
around, or anyone using find-on-page, has no way to tell them apart.

**Suggested fix:** distinguish the dialog's confirm copy ("Yes, cancel this booking"), which also
makes the destructive action clearer.

---

### F-11 · HIGH · ~~Handovers are refused for four hours every night (UTC vs local date)~~ — **FIXED**

**Where:** `apps/api/src/requests/requests.commands.ts:380` (and `:304`), plus
`jobs/jobs.service.ts:109`, `:179`, `jobs/jobs.service.ts:73`, `audit/audit.controller.ts:57`

Six places compute "today" as `new Date().toISOString().slice(0, 10)` — that is **UTC**.
The database and the people using the app run on **Asia/Baku (UTC+4)**.

Between 00:00 and 04:00 local, UTC is still on the previous date. A booking that starts
today therefore looks like it starts *tomorrow*, and the handover guard refuses it:

> *"This booking starts 2026-08-28 — hand over on or after that day"*

**Reproduced** at 01:58 Baku on 2026-08-28: `psql` reports `CURRENT_DATE = 2026-08-28`
(TimeZone `Asia/Baku`) while the API computed `2026-08-27`. Every handover of a
same-day booking failed. Verified through both the UI and the API.

**Why it matters:** for four hours of every day, the lab desk physically cannot hand a
device over for a booking that starts that day. The same mistake in `jobs.service.ts`
means due-soon and overdue notifications are evaluated against the wrong day for part of
each day.

**Suggested fix:** one helper that formats the local date (`en-CA` gives `YYYY-MM-DD`, or
build it from `getFullYear/getMonth/getDate`) and use it in all six places. The database
already agrees with local time, so this aligns the API with both the DB and the user.

**Fixed** in `apps/api/src/dates.ts` — `localDay()` / `localDayOffset()` now back all six
comparisons, so the API agrees with both Postgres (`CURRENT_DATE`, Asia/Baku) and the
person holding the phone.

---

### F-12 · HIGH · ~~The device Edit dialog loses the device's project~~ — **FIXED**

**Where:** `apps/web/src/components/DeviceEditModal.tsx:135` (Project) and `:150` (Squad)

Both are uncontrolled `<select>` elements using `defaultValue={device.project?.id}`. React
applies `defaultValue` on the first render only — and on that render the options list is
still loading (`useQuery` for `/projects` and `/projects?kind=squad`), so the only option
present is `— none —`. When the options arrive a render later, an uncontrolled select keeps
what it already had: empty.

**Reproduced:** open a device page directly (bookmark, notification deep-link, or a typed
URL) and press Edit. Project and Squad both read `— none —` for a device that has a
project. Arriving via the Devices list masks it, because that page has already populated
the same query cache.

**Why it matters:** before squads landed, saving that dialog **silently cleared the
device's project** — data loss with no warning. The new project-or-squad rule now blocks
the save instead, so the damage is caught, but Edit is unusable on a cold cache until the
user notices and re-picks the project by hand.

**Suggested fix:** make both selects controlled (`value` + `onChange` from state seeded off
`device`), or hold the dialog until the two queries resolve.

**Fixed** by making the selects controlled in `DeviceEditModal.tsx` — and in
`RequestModal.tsx`, which had the identical defect on its own project select. Guarded by
`test_the_edit_dialog_preselects_the_devices_current_project`.

---

### F-13 · MEDIUM · The Devices search box drops characters when typed quickly

**Where:** `apps/web/src/pages/Devices.tsx:27` (URL → state) and `:39-46` (state → URL)

Two effects feed each other: one mirrors the search box into the query string, the other
resets the box from the query string whenever it changes. A URL update that lands while
someone is still typing resets the input to the value the URL already held, discarding
everything typed since.

**Reproduced:** searching a 19-character serial in a loop left `?q=SNe2e8` in the URL — the
first six characters — and the filter then matched the wrong devices.

**This is F-02's twin.** That fix (debounced URL write, local text kept in the box) was
applied to the audit log's actor filter only; the same pattern was left in place here, and
the header's global search feeds this box too.

**Suggested fix:** the same treatment as the audit filter — keep the typed text in local
state, debounce the write to the URL, and only accept a URL→state reset when the change did
not originate from typing.

**Worked around in** `DevicesPage.search()`, which verifies the box holds the whole term and
retypes if not. Remove that once the box is fixed.

---

## 3. Possible problems — not verified, worth a look

These were noticed while reading the code and are **not** backed by a reproduction.

- **`VForm` field registration may capture stale rules.** `VField`'s `useEffect` depends only on
  `[name]` (`VForm.tsx:101-111`), but the registered `validate` closes over `rules` from that
  render. Rules are static literals everywhere today, so it cannot bite yet — it would if a rule
  ever depended on state.
- **Brute-force lock is per-process.** `AuthController.fails` is an in-memory `Map`
  (`auth.controller.ts:49`). The comment already acknowledges it: correct for one replica, useless
  behind a load balancer. Redis is already a dependency and would be the natural home.
- **`.env` is never loaded.** `@nestjs/config` is a dependency but `ConfigModule.forRoot()` is never
  called; `config.ts` reads `process.env` directly. `env.example` says "Copy to `.env`", which does
  not work — the variables have to be exported by the caller. Either wire up `ConfigModule`, or use
  `node --env-file`, or correct the comment in `env.example`.
- **`RangeCalendar.kindOf` scans bookings twice per day cell** (`RangeCalendar.tsx:46-58`), 42 cells
  per render. Irrelevant at current data volumes; would matter for a heavily-booked device.

---

## 4. What the test suite had to work around

Recorded so the next person does not rediscover them. All are commented at the point they matter.

| Workaround | Because |
|---|---|
| 20s default waits | The 2s splash (F-05) plus cold Vite transforms |
| Row locators anchored to `//table` | `RequestTable` renders rows twice (F-07) |
| `BasePage.overlay_button()` | Modals portal to end-of-`<body>`, but the row behind has the same label and comes first in document order (F-10) |
| Nav locators match the first text node | Badges make the anchor read `Requests3` (F-06) |
| Actor filter typed character by character | F-02 |
| `aged_device` backdates `created_at` via SQL | The idle report keys off creation time and no API can produce an old device |

**Suite lesson worth keeping:** the four `wait_for_*` helpers were originally written as poll loops
whose per-attempt lookup used the default 20s timeout — so the first miss consumed the entire
budget and the loop never took a second look. They looked like polls and behaved like single
attempts, which produced one intermittent failure per full run that passed on every isolated
re-run. Poll helpers must pass a short timeout to their inner lookup.

---

## 5. Coverage gaps — the next tests to write

Ordered by value. Roughly 12–15 tests would close the substantive ones.

1. **Excel import** (`POST /devices/import`, `GET /devices/import/template`) — an entire feature
   with file upload, parsing and partial-failure reporting, currently untested. `ImportModal` is
   never even opened. **Highest value.**
2. **User edit / deactivate / delete / restore** (`PATCH`, `DELETE`, `POST /users/:id/restore`).
3. **Project edit / delete / restore** — including the promise in the delete copy that attached
   devices "get the tag back on restore", which nothing currently verifies.
4. **Overdue handling** — the dashboard banner, the "Overdue — chase these" section and the overdue
   chip. Needs a loan backdated past its due date; reuse the `aged_device` SQL approach.
5. **Server-unavailable states** — `LoadFailed` and the "Can't reach the server" retry screen are
   never rendered. Achievable with CDP request interception or by stopping the API mid-test.
6. **Mobile layout** — everything runs at 1440px. A second driver at ~390px would cover the card
   layout and the hamburger menu.
7. **Single notification click-through** (`POST /notifications/:id/read` and its deep link).
8. **Outbox retry** (`POST /email-outbox/:id/retry`) — needs a genuinely failed send.

**Also worth doing:** wire `vite-plugin-istanbul` into the dev build and collect `window.__coverage__`
after each test. That would replace the 81% feature estimate above with real line and branch numbers
per file, and would show which of `apps/web/src` the suite never executes.

---

## 6. Development environment notes

Recorded because they cost time to work out and are not in `README.md` or `DEPLOY.md`.

- **Docker is not required and not installed here.** `docker-compose.yml` maps Postgres to `5433`
  and Redis to `6380`; the Homebrew services used instead run on the **defaults, 5432 and 6379**.
  Anything reading the compose file will use the wrong ports.
- **The API needs its environment passed explicitly** — nothing loads `.env` (see §3):
  ```
  DATABASE_URL=postgres://devmgmt:devmgmt@localhost:5432/devmgmt
  REDIS_URL=redis://localhost:6379
  ```
- **Migrations run on boot** (`data-source.ts`, `migrationsRun: true`), so a fresh database only
  needs the `devmgmt` role and database to exist.
- **`pnpm` comes from `corepack`**, not a global install.
- **The seeded admin cannot be used for UI automation.** `admin@devicedesk.local` / `admin123`
  always raises the un-dismissable password-change dialog. The suite creates its own run-scoped
  admin over the API instead.
- **The suite leaves data behind.** Each run namespaces its records under a unique `run_id` so runs
  never collide, but the dev database grows. Deliberate — it keeps runs re-runnable without a wipe.
