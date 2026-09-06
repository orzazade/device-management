"""Fixtures for the Selenium suite.

Design notes worth knowing before adding tests:

* **Headed by default.** `--headless` is opt-in, because watching the run is
  half the value of a UI suite. One Chrome window is shared by the whole
  session; each test resets the browser to a signed-out state instead of
  paying for a fresh launch.

* **Nothing is assumed about the database.** Every run mints a unique
  `run_id` and hangs its own project, devices and accounts off it, so the
  suite is re-runnable against a database that already holds data from
  previous runs — no wipe required between runs.

* **Preconditions are seeded over the API, assertions happen in the UI.**
  Arranging a device through six dialogs before testing the seventh is how
  suites get slow and flaky. Seeding is a fixture concern; the browser is
  reserved for the behaviour actually under test.

* **The suite bootstraps as qa.admin.** `admin@devicedesk.local` was retired
  by migration (its factory password made it useless for automation anyway).
  `qa.admin@devicedesk.local` is now seeded as a Super Admin with a known,
  non-default password, so the suite signs in as it directly to mint the
  run's accounts. The forced-change dialog is exercised on a throwaway
  account created with the factory default instead.
"""

from __future__ import annotations

import itertools
import os
import pathlib
import shutil
import subprocess
import time
from datetime import date, datetime, timedelta, timezone

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from api_client import Api
from pages import AppShell, LoginPage

SCREENSHOT_DIR = pathlib.Path(__file__).parent / "screenshots"

# Passwords used by the suite. All satisfy the app's rule (8+ chars, letters
# and digits) and none is a factory default, so they never trip the forced
# password-change dialog.
ADMIN_PASSWORD = "E2eAdmin2026"
TESTER_PASSWORD = "E2eTester2026"
DEFAULT_PASSWORD = "admin123"  # the app's factory default, on purpose

# The account the suite bootstraps through — seeded by migration as a Super
# Admin with this exact password, so it exists on any database the suite runs
# against without the suite having to create it first.
ROOT_EMAIL = "qa.admin@devicedesk.local"


# --------------------------------------------------------------------- options


def pytest_addoption(parser):
    parser.addoption("--headless", action="store_true", help="run Chrome without a window")
    parser.addoption(
        "--slow",
        action="store",
        default=None,
        metavar="SECONDS",
        help="pause after each interaction so a human can follow along (e.g. --slow 0.3)",
    )
    parser.addoption(
        "--base-url",
        action="store",
        default=os.environ.get("BASE_URL", "http://localhost:5173"),
        help="web app origin",
    )
    parser.addoption(
        "--api-url",
        action="store",
        default=os.environ.get("API_URL", "http://localhost:8080/api/v1"),
        help="API origin including the /api/v1 prefix",
    )
    parser.addoption(
        "--keep-open",
        action="store_true",
        help="leave the browser open when the run finishes",
    )


def pytest_configure(config):
    if config.getoption("--slow"):
        os.environ["E2E_SLOWMO"] = str(config.getoption("--slow"))


# ------------------------------------------------------------------ endpoints


@pytest.fixture(scope="session")
def base_url(pytestconfig) -> str:
    return pytestconfig.getoption("--base-url").rstrip("/")


@pytest.fixture(scope="session")
def api_url(pytestconfig) -> str:
    return pytestconfig.getoption("--api-url").rstrip("/")


@pytest.fixture(scope="session")
def run_id() -> str:
    """Short, unique-per-run tag stamped into every record the suite creates."""
    return f"e2e{int(time.time()) % 100000000}"


# --------------------------------------------------------------------- driver


@pytest.fixture(scope="session")
def driver(pytestconfig):
    options = Options()
    if pytestconfig.getoption("--headless"):
        options.add_argument("--headless=new")
    # A desktop-width window matters: RequestTable renders mobile cards below
    # the md breakpoint, and every row locator here targets the table.
    options.add_argument("--window-size=1440,960")
    options.add_argument("--disable-search-engine-choice-screen")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    # Chrome's password manager throws a "change your password" bubble over
    # the app the moment a login form is submitted.
    options.add_experimental_option(
        "prefs",
        {
            "credentials_enable_service": False,
            "profile.password_manager_enabled": False,
            "profile.password_manager_leak_detection": False,
        },
    )
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    if pytestconfig.getoption("--keep-open"):
        options.add_experimental_option("detach", True)

    drv = webdriver.Chrome(options=options)
    drv.set_page_load_timeout(60)
    yield drv
    if not pytestconfig.getoption("--keep-open"):
        drv.quit()


@pytest.fixture(autouse=True)
def fresh_session(driver, base_url):
    """Start every test signed out, without relaunching the browser."""
    if not driver.current_url.startswith(base_url):
        driver.get(f"{base_url}/login")
    driver.execute_script("localStorage.clear(); sessionStorage.clear();")
    yield


# ----------------------------------------------------------------- API clients


@pytest.fixture(scope="session")
def root_api(api_url) -> Api:
    """Signed in as qa.admin — used only to mint the run's accounts."""
    api = Api(api_url)
    try:
        api.login(ROOT_EMAIL, ADMIN_PASSWORD)
    except Exception as exc:  # pragma: no cover - fixture guard
        pytest.exit(
            f"Cannot reach the API at {api_url} as {ROOT_EMAIL}.\n"
            f"Start the stack first (see e2e/README.md). Underlying error: {exc}",
            returncode=3,
        )
    return api


@pytest.fixture(scope="session")
def accounts(root_api: Api) -> dict[str, dict]:
    """The three permanent accounts the UI tests sign in as.

    Fixed addresses, reused by every run and reset to a known state each
    time — creating three new users per run turned the real user list into
    hundreds of rows of test noise. Nothing here creates an account that did
    not already exist, after the first run.
    """
    made = {
        "admin": {
            "name": "QA Automation Admin",
            "email": "qa.admin@devicedesk.local",
            "password": ADMIN_PASSWORD,
            "role": "admin",
        },
        "tester": {
            "name": "QA Automation Tester",
            "email": "qa.tester@devicedesk.local",
            "password": TESTER_PASSWORD,
            "role": "tester",
        },
    }
    for acc in made.values():
        acc["id"] = root_api.ensure_user(
            acc["name"], acc["email"], acc["password"], acc["role"]
        )["id"]
    return made


@pytest.fixture
def spare_account(root_api: Api):
    """Get-or-create one of the suite's fixed side accounts, reset each time.

    For tests that must change an account (its password, its role) and would
    otherwise need a throwaway user.
    """

    def _get(key: str, role: str = "tester", password: str | None = None) -> dict:
        acc = {
            "name": f"QA Automation {key.title()}",
            "email": f"qa.{key}@devicedesk.local",
            "password": password or TESTER_PASSWORD,
            "role": role,
        }
        acc["id"] = root_api.ensure_user(
            acc["name"], acc["email"], acc["password"], acc["role"]
        )["id"]
        return acc

    return _get


@pytest.fixture(scope="session")
def admin_api(api_url, accounts) -> Api:
    """API client acting as the run's own admin, for seeding and read-back."""
    api = Api(api_url)
    api.login(accounts["admin"]["email"], accounts["admin"]["password"])
    return api


@pytest.fixture(scope="session")
def seed_project(admin_api: Api, run_id: str) -> dict:
    return admin_api.create_project(f"Project {run_id}", "Seeded by the Selenium suite")


# --------------------------------------------------------------- page objects


@pytest.fixture
def login_page(driver, base_url) -> LoginPage:
    return LoginPage(driver, base_url)


@pytest.fixture
def shell(driver, base_url) -> AppShell:
    return AppShell(driver, base_url)


@pytest.fixture
def as_admin(login_page, accounts, shell) -> AppShell:
    login_page.login(accounts["admin"]["email"], accounts["admin"]["password"])
    return shell


@pytest.fixture
def as_tester(login_page, accounts, shell) -> AppShell:
    login_page.login(accounts["tester"]["email"], accounts["tester"]["password"])
    return shell


# --------------------------------------------------------------- test devices


# One counter for the whole run, so no two devices can ever share a suffix.
# The previous scheme mixed in `time.time()*1000 % 100000`, which repeats every
# 100 seconds — over a 13-minute run two tests creating their first device at
# the same point in that cycle minted the same serial and the API (rightly)
# returned 409.
_device_seq = itertools.count(1)


@pytest.fixture
def new_device(admin_api: Api, run_id: str, seed_project):
    """Mint a device with a unique serial, so tests never collide.

    Returns a factory; call it once per device a test needs.
    """
    made: list[dict] = []

    def _make(brand: str = "Samsung", os_name: str = "Android", **extra) -> dict:
        # Zero-padded so no model name is a prefix of another: row
        # locators match on `contains()`, and "…-1" would otherwise
        # also match "…-11".
        suffix = f"{run_id}-{next(_device_seq):03d}"
        body = {
            "brand": brand,
            "model": extra.pop("model", f"Galaxy {suffix}"),
            "os": os_name,
            "osVersion": extra.pop("os_version", "14"),
            "serial": extra.pop("serial", f"SN{suffix}".replace("-", "")),
            "projectId": extra.pop("project_id", seed_project["id"]),
            **extra,
        }
        device = admin_api.create_device(**body)
        made.append(device)
        return device

    return _make


@pytest.fixture(scope="session")
def tester_api(api_url, accounts) -> Api:
    """API client acting as the run's tester, for arranging loans."""
    api = Api(api_url)
    api.login(accounts["tester"]["email"], accounts["tester"]["password"])
    return api


def server_today() -> date:
    """The date the API believes it is — now the same local day the user sees.

    Before F-11 was fixed this had to return the UTC date, because the API
    compared booking days against `new Date().toISOString()`. It now uses the
    local calendar day, so the two agree and fixtures can simply use today.
    """
    return date.today()


def in_utc_offset_window() -> bool:
    """True while the local calendar day is ahead of the server's (F-11)."""
    return date.today() != server_today()




def _iso(days_ahead: int) -> str:
    return (server_today() + timedelta(days=days_ahead)).isoformat()


@pytest.fixture
def pending_request(new_device, tester_api: Api, seed_project, spare_account, root_api: Api):
    """A request that is genuinely waiting for somebody to decide it.

    Only one situation produces one now: the device is already in another
    person's hands, so the request goes to that person. A device nobody holds
    is simply taken, so there is nothing to approve and no pending state to
    arrange. The fixture therefore parks the device with a second tester
    first, and returns that holder's account alongside the request — they are
    the only login that can decide it.
    """

    def _make(days_ahead: int = 0, span: int = 2, reason: str = "Seeded regression run"):
        device = new_device()
        holder_account = spare_account("holder", role="tester")
        holder = root_api.as_user(holder_account["email"], holder_account["password"])
        # Just today: the point is to put the device in somebody's hands, and
        # a long hold would also fill the calendar, which several tests read.
        holder.create_request(
            device["id"], seed_project["id"], "Holding it first", _iso(0), _iso(0)
        )
        req = tester_api.create_request(
            device["id"], seed_project["id"], reason, _iso(days_ahead), _iso(days_ahead + span),
        )
        assert req["state"] == "pending", (
            f"a request for a held device should wait for the holder, got {req['state']}"
        )
        return device, req, holder_account

    return _make


@pytest.fixture
def active_loan(new_device, tester_api: Api, seed_project, admin_api: Api):
    """A device already in the tester's hands.

    Taking a free device IS the handover now — no approval, no confirmation
    step — so this is just a request that starts today.
    """

    def _make(days_ahead: int = 0, span: int = 2) -> tuple[dict, dict]:
        assert days_ahead == 0, "a loan only becomes active on the day it starts"
        device = new_device()
        req = tester_api.create_request(
            device["id"], seed_project["id"], "Seeded active loan", _iso(0), _iso(span),
        )
        assert req["state"] == "active", f"expected an immediate loan, got {req['state']}"
        return device, admin_api.request_by_id(req["id"])

    return _make


@pytest.fixture
def overdue_loan(active_loan, admin_api: Api):
    """A loan the desk has already marked overdue.

    Real overdue-ness needs a due date in the past, which no dialog will
    accept, so the loan is created normally and then moved back with the
    desk's own "change time" endpoint before the sweep runs. That is the same
    code path the hourly job uses, so the resulting row is genuine, not a
    hand-written state.
    """

    def _make(days_late: int = 2) -> tuple[dict, dict]:
        device, req = active_loan(days_ahead=0, span=1)
        admin_api.set_time(req["id"], _iso(-days_late - 1), _iso(-days_late))
        admin_api.scan_overdue()
        fresh = admin_api.request_by_id(req["id"])
        assert fresh["state"] == "overdue", f"expected overdue, got {fresh['state']}"
        return device, fresh

    return _make


@pytest.fixture
def age_notifications():
    """Push a request's overdue notifications into the past.

    The repeat reminder deliberately stays quiet for three days after the
    last one, so nothing can be observed about it until the existing
    notifications look old. There is no API for that — the job reads
    `created_at` — so the rows are backdated directly, as with `aged_device`.
    """

    def _age(request_id: str, days: int = 4) -> None:
        _psql(
            "UPDATE notifications SET created_at = now() - interval '%d days' "
            "WHERE meta->>'requestId' = '%s'" % (days, request_id)
        )

    return _age


@pytest.fixture
def fresh_tester(root_api: Api) -> dict:
    """A permanent tester that deliberately never receives work.

    Empty-state tests need an account with no loans and no notifications.
    This one qualifies by convention: nothing in the suite may request a
    device as this user, hand one to them, or name them in a request. Keep it
    that way, or the empty-state tests start failing for the wrong reason.
    """
    account = {
        "name": "QA Automation Observer",
        "email": "qa.observer@devicedesk.local",
        "password": TESTER_PASSWORD,
        "role": "tester",
    }
    account["id"] = root_api.ensure_user(
        account["name"], account["email"], account["password"], "tester"
    )["id"]
    return account


@pytest.fixture
def aged_device(new_device):
    """A device that looks like it has been on the shelf for a while.

    The idle report keys off `created_at`, which the database sets — there is
    no API or UI that can produce an old device. Backdating the row directly
    is the only way to test the report's positive case, and it stays confined
    to this fixture.
    """

    def _make(days_old: int = 200, **kwargs) -> dict:
        device = new_device(**kwargs)
        _psql(
            "UPDATE devices SET created_at = now() - interval '%d days' WHERE id = '%s'"
            % (days_old, device["id"])
        )
        return device

    return _make


def _psql(sql: str) -> None:
    url = os.environ.get(
        "DATABASE_URL", "postgres://devmgmt:devmgmt@localhost:5432/devmgmt"
    )
    binary = shutil.which("psql") or "/usr/local/opt/postgresql@17/bin/psql"
    result = subprocess.run(
        [binary, url, "-v", "ON_ERROR_STOP=1", "-qc", sql],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"psql failed: {result.stderr.strip()}")


@pytest.fixture
def reported_damage(new_device, tester_api: Api):
    """A device with an open repair in the 'reported' state."""

    def _make(issue: str = "Screen flickers under load") -> tuple[dict, dict]:
        device = new_device()
        repair = tester_api.report_damage(device["id"], issue)
        return device, repair

    return _make


# ------------------------------------------------------ screenshot on failure


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" or not report.failed:
        return
    drv = item.funcargs.get("driver")
    if drv is None:
        return
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    target = SCREENSHOT_DIR / f"{item.name}.png"
    try:
        drv.save_screenshot(str(target))
        # The screenshot only shows the viewport, and this app's pages are
        # long — a row that failed to appear is usually below the fold. Save
        # the DOM too, so an intermittent failure is diagnosable from the
        # artefacts alone instead of needing a re-run to reproduce.
        html = SCREENSHOT_DIR / f"{item.name}.html"
        html.write_text(drv.page_source, encoding="utf-8")
        report.sections.append(
            ("Selenium", f"screenshot: {target}\ndom: {html}\nurl: {drv.current_url}")
        )
    except Exception:
        pass
