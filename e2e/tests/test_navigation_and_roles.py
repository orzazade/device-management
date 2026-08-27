"""Sidebar navigation, page titles, and what each role is allowed to reach.

Role rules under test (App.tsx / Layout.tsx):
  * admin and manager see the Manage section; testers do not
  * a tester who types a staff URL is bounced back to the dashboard
  * unknown routes render the 404 page inside the shell, not a blank screen
"""

from __future__ import annotations

import pytest
from selenium.webdriver.common.by import By

from pages import AppShell

pytestmark = pytest.mark.rbac

BACK_TO_DASHBOARD = (By.XPATH, "//a[normalize-space()='Back to the dashboard']")

# Sidebar label -> (route, page heading). The Reports page is a deliberate
# mismatch: its nav label reads "Idle devices" and so does its heading.
DESTINATIONS = {
    "Dashboard": ("/", "Hi,"),
    "Devices": ("/devices", "Devices"),
    "Requests": ("/requests", "Requests"),
    "Repairs": ("/repairs", "Repairs"),
    "Projects": ("/projects", "Projects"),
    "Users": ("/users", "Users"),
    "Idle devices": ("/reports", "Idle devices"),
    "Settings": ("/settings", "Settings"),
    "Audit log": ("/audit", "Audit log"),
}

STAFF_ONLY = ["Projects", "Users", "Idle devices", "Settings", "Audit log"]


@pytest.mark.smoke
@pytest.mark.parametrize("label", list(DESTINATIONS))
def test_admin_can_reach_every_sidebar_page(as_admin: AppShell, label: str):
    route, heading = DESTINATIONS[label]

    as_admin.go_to(label)

    as_admin.wait_for_path(route)
    as_admin.wait_heading(heading)


def test_page_title_follows_the_route(as_admin: AppShell):
    """document.title is what a tab full of the app looks like."""
    as_admin.go_to("Devices")
    as_admin.wait_for_path("/devices")
    as_admin.wait_heading("Devices")

    assert as_admin.document_title == "Devices · Azercell Device Management"

    as_admin.go_to("Dashboard")
    as_admin.wait_for_path("/")
    as_admin.wait_heading("Hi,")
    assert as_admin.document_title == "Dashboard · Azercell Device Management"


def test_manager_sees_the_manage_section(as_manager: AppShell):
    for label in STAFF_ONLY:
        assert as_manager.has_nav_link(label), f"a manager should see {label!r}"


def test_tester_sidebar_hides_every_staff_page(as_tester: AppShell):
    visible = as_tester.visible_nav_labels()

    assert visible == ["Dashboard", "Devices", "Requests", "Repairs"], (
        f"a tester's sidebar should hold only the Lab section, saw {visible}"
    )
    for label in STAFF_ONLY:
        assert not as_tester.has_nav_link(label, timeout=1), f"{label!r} leaked to a tester"


@pytest.mark.parametrize("route", ["/users", "/projects", "/settings", "/reports", "/audit"])
def test_tester_typing_a_staff_url_is_sent_back_to_the_dashboard(as_tester: AppShell, route: str):
    """The API refuses these anyway; the guard keeps a tester from ever
    landing on a staff screen and seeing a flash of it."""
    as_tester.open(route)

    as_tester.wait_for_path("/")
    as_tester.wait_heading("Hi,")


def test_unknown_route_renders_the_not_found_page(as_admin: AppShell):
    as_admin.open("/this-route-does-not-exist")

    as_admin.wait_for_text("This page doesn’t exist")
    assert as_admin.has_nav_link("Dashboard"), "the 404 stays inside the app shell"

    as_admin.click(BACK_TO_DASHBOARD)
    as_admin.wait_for_path("/")


def test_legacy_bookmarks_redirect_into_the_merged_requests_page(as_admin: AppShell):
    """/handovers, /approvals and /loans were merged into /requests."""
    for old in ["/handovers", "/approvals", "/loans"]:
        as_admin.open(old)
        as_admin.wait_for_path("/requests")
        as_admin.wait_heading("Requests")


def test_the_signed_in_user_is_named_in_the_header(as_tester: AppShell, accounts):
    assert as_tester.signed_in_name() == accounts["tester"]["name"]
    assert as_tester.signed_in_role() == "Tester"
