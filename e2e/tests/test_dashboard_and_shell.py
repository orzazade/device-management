"""The dashboard and the pieces of chrome that sit on every page:
counters, the theme switch, the notification bell and the global search.
"""

from __future__ import annotations

import pytest

from api_client import Api
from pages import AppShell, Dashboard, LoginPage, NotificationBell, ThemeToggle

pytestmark = pytest.mark.smoke


@pytest.fixture
def dashboard(driver, base_url) -> Dashboard:
    return Dashboard(driver, base_url)


@pytest.fixture
def theme(driver, base_url) -> ThemeToggle:
    return ThemeToggle(driver, base_url)


@pytest.fixture
def bell(driver, base_url) -> NotificationBell:
    return NotificationBell(driver, base_url)


# ------------------------------------------------------------------ dashboard


def test_the_dashboard_greets_the_person_and_counts_the_lab(
    as_admin, dashboard: Dashboard, accounts, admin_api: Api, new_device
):
    """"Available now" is stricter than status='available': it also excludes
    devices with an open repair or a booking covering today. So the tile is a
    subset of the raw count, and a clean new device must add exactly one."""
    dashboard.open_dashboard()
    dashboard.wait_for_text(f"Hi, {accounts['admin']['name'].split()[0]}")
    dashboard.wait_for_text("Here’s the lab right now.")

    before = dashboard.stat("Devices available now")
    raw_available = len([d for d in admin_api.devices() if d["status"] == "available"])
    assert before <= raw_available, (
        f"the tile ({before}) cannot exceed every available device ({raw_available})"
    )

    new_device()
    dashboard.open_dashboard()

    dashboard.wait_for_stat("Devices available now", before + 1)


def test_a_tester_with_nothing_checked_out_is_told_so(
    login_page: LoginPage, fresh_tester, dashboard: Dashboard
):
    login_page.login(fresh_tester["email"], fresh_tester["password"])
    dashboard.open_dashboard()

    assert dashboard.stat("In my hands") == 0
    assert dashboard.is_visible(dashboard.NOTHING_CHECKED_OUT)
    assert dashboard.is_visible(dashboard.NO_OPEN_REQUESTS)
    assert not dashboard.is_visible(
        (dashboard.MY_REQUESTS[0], "//div[normalize-space()='Waiting for approval']"), timeout=2
    ), "the approval queue tile is staff-only"


def test_a_device_in_my_hands_is_counted_and_listed(
    login_page: LoginPage, accounts, dashboard: Dashboard, active_loan
):
    """Measured as a delta, not an absolute: the shared tester account picks
    up loans from other tests, so "exactly one" would only hold in isolation."""
    login_page.clear_session()
    login_page.login(accounts["tester"]["email"], accounts["tester"]["password"])
    dashboard.open_dashboard()
    before = dashboard.stat("In my hands")

    device, req = active_loan()

    dashboard.open_dashboard()
    dashboard.wait_for_stat("In my hands", before + 1)
    assert device["model"] in " ".join(dashboard.held_device_names())
    dashboard.wait_for_text(f"due back {req['toDate']}")


def test_the_counters_are_links_into_the_pages_behind_them(as_admin, dashboard: Dashboard):
    dashboard.open_dashboard()

    dashboard.open_stat("Devices available now")

    dashboard.wait_for_path("/devices")


def test_a_pending_request_shows_up_in_the_staff_counter(
    as_admin, dashboard: Dashboard, pending_request
):
    pending_request()

    dashboard.open_dashboard()

    assert dashboard.stat("Waiting for approval") >= 1


# ---------------------------------------------------------------- theme switch


def test_the_theme_switch_flips_and_is_remembered(as_admin, theme: ThemeToggle):
    assert theme.theme() == "light", "the app starts light unless told otherwise"
    assert not theme.is_dark()
    assert theme.label() == "Switch to dark mode"

    theme.flip()

    assert theme.theme() == "dark"
    assert theme.is_dark()
    assert theme.label() == "Switch to light mode"
    assert theme.stored_theme() == "dark", "the choice belongs to this browser"

    # A reload must not flash back to light — index.html applies it pre-paint.
    theme.driver.refresh()
    theme.find(theme.SWITCH)
    assert theme.theme() == "dark"

    theme.flip()
    assert theme.theme() == "light"
    assert theme.stored_theme() == "light"


def test_the_theme_switch_is_available_before_sign_in(login_page: LoginPage, theme: ThemeToggle):
    """Someone on a dark-mode laptop should not be blinded by the login page."""
    login_page.open_login()

    theme.flip()
    assert theme.theme() == "dark"

    theme.flip()
    assert theme.theme() == "light"


# ------------------------------------------------------------------- the bell


def test_a_new_request_notifies_the_person_holding_the_device(
    login_page, shell, bell: NotificationBell, pending_request
):
    """The alert goes to whoever has to answer it.

    That is the person holding the phone, not the desk — they are the one
    being asked to give it up, and nobody else can decide it.
    """
    device, _, holder = pending_request()

    login_page.clear_session()
    login_page.login(holder["email"], holder["password"])
    shell.open("/")
    shell.wait_heading("Hi,")

    # The bell polls; give it a reload rather than waiting on its interval.
    bell.driver.refresh()
    bell.find(bell.BUTTON)
    bell.open_panel()

    texts = " ".join(bell.texts())
    assert device["model"] in texts, f"expected the new request in the bell, saw {texts[:300]!r}"


def test_marking_notifications_read_clears_the_badge(
    login_page: LoginPage, shell: AppShell, bell: NotificationBell, pending_request
):
    """Signed in as the holder, because they are who the request notifies.

    This used to run as the admin, who is told nothing about a request for a
    device somebody else is holding — that goes to the holder alone. It
    passed on whatever unread notifications the account had accumulated from
    earlier tests, and then marked them read, so a run that started with a
    clear badge failed here for a reason that had nothing to do with badges.
    """
    _, _, holder = pending_request()

    login_page.clear_session()
    login_page.login(holder["email"], holder["password"])
    shell.open("/")
    shell.wait_heading("Hi,")
    bell.driver.refresh()
    bell.find(bell.BUTTON)

    assert bell.unread_count() >= 1, "an unread notification should be badged"
    bell.open_panel()
    bell.mark_all_read()

    bell.wait(15).until(lambda d: bell.unread_count() == 0)


def test_a_tester_with_no_history_sees_an_empty_bell(
    login_page: LoginPage, fresh_tester, bell: NotificationBell
):
    login_page.login(fresh_tester["email"], fresh_tester["password"])

    bell.open_panel()

    assert bell.is_visible(bell.EMPTY), "an empty state beats an empty box"
    assert bell.unread_count() == 0


# --------------------------------------------------------------- global search


def test_the_global_search_is_on_every_page(as_admin):
    for label in ["Devices", "Requests", "Repairs", "Users"]:
        as_admin.go_to(label)
        assert as_admin.is_visible(as_admin.GLOBAL_SEARCH), (
            f"the header search vanished on {label}"
        )
