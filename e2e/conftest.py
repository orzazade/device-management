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

* **The seeded admin is never disturbed.** `admin@devicedesk.local` still has
  the factory password, which forces a password-change dialog on every UI
  sign-in. Tests therefore drive a run-scoped admin created over the API, and
  exercise the forced-change flow on a throwaway account instead.
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
MANAGER_PASSWORD = "E2eManager2026"
TESTER_PASSWORD = "E2eTester2026"
DEFAULT_PASSWORD = "admin123"  # the app's factory default, on purpose

SEED_ADMIN_EMAIL = "admin@devicedesk.local"


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
    """Signed in as the seeded admin — used only to mint the run's accounts."""
    api = Api(api_url)
    try:
        api.login(SEED_ADMIN_EMAIL, DEFAULT_PASSWORD)
    except Exception as exc:  # pragma: no cover - fixture guard
        pytest.exit(
            f"Cannot reach the API at {api_url} as {SEED_ADMIN_EMAIL}.\n"
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
        "manager": {
            "name": "QA Automation Manager",
            "email": "qa.manager@devicedesk.local",
            "password": MANAGER_PASSWORD,
            "role": "manager",
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
def as_manager(login_page, accounts, shell) -> AppShell:
    login_page.login(accounts["manager"]["email"], accounts["manager"]["password"])
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


def skip_if_handover_blocked() -> None:
    """Kept as a no-op marker of where F-11 used to bite.

    F-11 (the API reading "today" from UTC while the lab runs on Asia/Baku)
    is fixed: `localDay()` now backs every calendar-day comparison. Handovers
    work at any hour, so nothing is skipped. The call sites are left in place
    because they mark the tests that would fail first if the bug returned.
    """
    return


def _iso(days_ahead: int) -> str:
    return (server_today() + timedelta(days=days_ahead)).isoformat()


@pytest.fixture
def pending_request(new_device, tester_api: Api, seed_project):
    """A device with a request already waiting for approval.

    Arranged over the API so a test about approving, rejecting or overriding
    does not have to re-drive the request dialog first.
    """

    def _make(days_ahead: int = 0, span: int = 2, reason: str = "Seeded regression run") -> tuple[dict, dict]:
        device = new_device()
        req = tester_api.create_request(
            device["id"],
            seed_project["id"],
            reason,
            _iso(days_ahead),
            _iso(days_ahead + span),
        )
        return device, req

    return _make


@pytest.fixture
def active_loan(pending_request, admin_api: Api):
    """A device already out in the tester's hands: requested, approved, handed
    over. The starting point for extend / return / overdue scenarios."""

    def _make(days_ahead: int = 0, span: int = 2) -> tuple[dict, dict]:
        skip_if_handover_blocked()
        device, req = pending_request(days_ahead=days_ahead, span=span)
        # Free devices auto-approve under the 'busy_only' and 'holder'
        # policies, and approving an approved request is a 409 — so only
        # approve when it is actually still waiting.
        if req.get("state") == "pending":
            admin_api.approve(req["id"])
        admin_api.handover(req["id"])
        return device, admin_api.find_request_for_device(device["id"])

    return _make


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
def approval_mode(admin_api: Api):
    """Switch the lab's approval policy for one test and put it back after.

    The policy is global server state, so a test that leaves it changed
    silently rewrites what every later test means.
    """
    original = admin_api.settings()["approvalMode"]

    def _set(mode: str) -> None:
        admin_api.set_approval_mode(mode)

    yield _set
    if admin_api.settings()["approvalMode"] != original:
        admin_api.set_approval_mode(original)


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
