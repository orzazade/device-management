# Selenium E2E suite — Azercell Device Management

Browser tests that drive the real React app against the real NestJS API,
Postgres and Redis. Headed Chrome by default, because watching a UI suite run
is half of what it is for.

```bash
./run-e2e.sh                        # everything, headed
./run-e2e.sh -m smoke               # the core paths only
./run-e2e.sh --headless             # CI
./run-e2e.sh --slow 0.3             # slow enough to follow along
./run-e2e.sh tests/test_login.py    # one file
./run-e2e.sh -k lifecycle -x        # one flow, stop on first failure
```

`run-e2e.sh` starts Postgres, Redis, the API and Vite if they are not already
up, waits for each to answer, and stops only what it started. Anything already
running is reused and left alone.

## Layout

| Path | What |
|---|---|
| `conftest.py` | Chrome driver, run-scoped accounts, seeded fixtures, screenshot-on-failure |
| `api_client.py` | REST helper used to arrange preconditions and read state back |
| `pages/` | Page objects — one class per screen or dialog |
| `tests/` | The tests, grouped by area |
| `screenshots/` | Written automatically when a test fails |
| `.logs/` | API and Vite output from `run-e2e.sh` |

## What is covered

| File | Area |
|---|---|
| `test_login.py` | sign-in, sign-out, session expiry, the forced first-login password change |
| `test_navigation_and_roles.py` | sidebar routing, page titles, role-based access, legacy redirects, 404 |
| `test_devices.py` | inventory table, add-device dialog, validation, search and filters |
| `test_device_detail.py` | specs, history, editing, damage reports, soft delete and restore |
| `test_projects_and_users.py` | projects, accounts, role changes, duplicate handling |
| `test_request_lifecycle.py` | request → approve → hand over → check in, plus reject and damaged return |
| `test_request_actions.py` | cancel, extend, tester hand-back, refused handover, desk time override |
| `test_repairs.py` | the repair state machine, cancel, write-off, role limits |
| `test_admin_screens.py` | approval policy, notification matrix, email outbox, audit log, idle report |
| `test_dashboard_and_shell.py` | dashboard counters, theme switch, notification bell, global search |

Markers: `smoke`, `auth`, `rbac`, `crud`, `lifecycle`, `validation`.

## How the suite is built

**Preconditions over the API, assertions in the browser.** Arranging a device
through six dialogs before testing the seventh is how suites get slow and
flaky. Fixtures (`new_device`, `pending_request`, `active_loan`,
`reported_damage`) seed over REST; the browser is reserved for the behaviour
actually under test. Where an action matters, the test checks both what the
screen says *and* what the API now holds — a toast is not proof.

**Re-runnable without a database wipe.** Every run mints a `run_id` and hangs
its own accounts, project and devices off it, so nothing collides with data
left by earlier runs.

**The seeded admin is never used for UI sign-in.** `admin@devicedesk.local`
still holds the factory password, so signing in as it always raises the forced
password-change dialog. Tests use a run-scoped admin created over the API, and
exercise the forced-change flow on a throwaway account instead.

## Things the app made the suite work around

Worth knowing before adding tests — each is commented at the point it matters:

- **No `data-testid` anywhere.** Selectors lean on the `name` attribute that
  `VField` renders, on visible text, and on ARIA roles (toasts are
  `role="status"`). This is the single change that would most improve the
  suite's resilience.
- **A 2-second brand splash on every app-shell load.** Nothing inside the
  shell exists in the DOM until it clears, so waits have to outlast it.
- **`RequestTable` renders every row twice** — mobile cards and a table. Both
  are in the DOM; only one is visible. Row locators are anchored to `//table`.
- **Modals portal to the end of `<body>`**, but the row that opened them often
  carries a button with the same label, and that one comes first in document
  order. `BasePage.overlay_button()` scopes to the open dialog.
- **Sidebar count badges** sit inside the anchor with no separating
  whitespace, so `Requests` reads as `Requests3`. Nav locators match the
  anchor's first text node.
- **The audit log's actor filter drops characters when typed quickly.** It is
  a controlled input whose value round-trips through the URL, rewritten per
  keystroke; each re-render resets the box to the value the URL had already
  committed. Human typing is slow enough to avoid it, so the page object types
  one character at a time. Worth a fix in the app.

## Writing new tests

Four rules that came out of getting this suite green:

1. **Measure deltas, not absolutes.** The three run-scoped accounts accumulate
   state as the suite runs, so `assert stat("In my hands") == 1` is only true
   in isolation. Read the counter first, act, then assert `before + 1`.
2. **Empty states need their own account.** Use the `fresh_tester` fixture —
   the shared tester has requests and notifications by the time your test runs.
3. **When a test needs the same device twice, look requests up by id.**
   `find_request_for_device` returns the first match, which is the wrong one as
   soon as a device has been requested by two people.
4. **Poll with a short per-attempt timeout.** `wait_for_*` helpers pass
   `timeout=2` to their lookup on purpose; with the default 20s the first miss
   would consume the whole budget and the loop would only ever try once.

## Requirements

Chrome (Selenium Manager fetches the matching driver), Python 3.10+, and the
app's own stack. The first `run-e2e.sh` creates `.venv` and installs
`requirements.txt`.
