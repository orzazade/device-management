"""One device, followed end to end, through both roles.

The other files test each screen. This one tests the *hand-offs* — the points
where work passes between a Tester and the Admin — because that is where a
role boundary either holds or leaks, and no single-role test can see it.

The story, in the order the lab actually lives it:

    Admin   adds a phone and files it under a project
    Tester  asks for it — and since nobody was holding it, it is his at once
    Tester  damages it and sends it to repair
    Admin   takes it through the repair queue and back to available
    Admin   sees the whole thing in the audit log, and does the things only
            an Admin can do
"""

from __future__ import annotations

import time

import pytest

from api_client import Api
from pages import (
        SECTION_PENDING,
    AuditPage,
    DeviceDetailPage,
    DevicesPage,
    LoginPage,
    RepairsPage,
    RequestsPage,
    UsersPage,
)

pytestmark = [pytest.mark.lifecycle, pytest.mark.rbac]


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


@pytest.fixture
def detail(driver, base_url) -> DeviceDetailPage:
    return DeviceDetailPage(driver, base_url)


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


@pytest.fixture
def repairs_page(driver, base_url) -> RepairsPage:
    return RepairsPage(driver, base_url)


@pytest.fixture
def audit_page(driver, base_url) -> AuditPage:
    return AuditPage(driver, base_url)


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


@pytest.mark.smoke
def test_one_phone_through_the_admin_and_a_tester(
    login_page: LoginPage,
    devices_page: DevicesPage,
    detail: DeviceDetailPage,
    requests_page: RequestsPage,
    repairs_page: RepairsPage,
    audit_page: AuditPage,
    accounts,
    admin_api: Api,
    seed_project,
    run_id: str,
):
    serial = f"SNJRNY{run_id}{int(time.time()) % 10000}"
    model = f"Galaxy Journey {run_id}"
    tester, admin = accounts["tester"], accounts["admin"]

    # ---- 1. ADMIN puts a phone into the lab ----------------------------
    _sign_in(login_page, admin)
    devices_page.open_devices()
    add = devices_page.open_add_device()
    add.fill(
        brand="Samsung",
        model=model,
        os_name="Android",
        os_version="15",
        serial=serial,
        accessories="Box, Charger",
        project=seed_project["name"],
    )
    add.create()
    devices_page.wait_for_toast("added")

    device = admin_api.find_device_by_serial(serial)
    assert device["status"] == "available"
    assert device["project"]["name"] == seed_project["name"]

    # ---- 2. TESTER asks for it -----------------------------------------
    _sign_in(login_page, tester)
    devices_page.open_devices()
    devices_page.search(serial)
    devices_page.wait_for_row_count(1)

    dialog = devices_page.open_request_for(serial)
    dialog.choose_project(seed_project["name"])
    dialog.enter_reason("Regression pass on the payments screens before release")
    dialog.pick_first_free_range(span_days=2)
    dialog.submit()
    requests_page.wait_for_toast("Request submitted")
    requests_page.wait_for_path("/requests")

    # ---- 3. nobody held it, so it is his the moment he asks ------------
    assert requests_page.own_state_of(model) == "Active"
    assert not requests_page.has_section(SECTION_PENDING, timeout=3), (
        "the approval queue must not be visible to a tester"
    )

    handed_over = admin_api.device(device["id"])
    assert handed_over["status"] == "assigned"
    assert handed_over["holder"]["name"] == tester["name"]

    # ---- 4. TESTER breaks it and sends it to repair --------------------
    _sign_in(login_page, tester)
    detail.open_device(device["id"])
    damage = detail.open_report_damage()
    damage.describe("Dropped during a field test — screen cracked across the top")
    damage.submit()
    detail.wait_for_toast("Damage reported")

    repair = admin_api.find_repair_for_device(device["id"])
    assert repair["state"] == "reported"
    assert repair["reportedBy"]["name"] == tester["name"]

    # A tester can see the queue but cannot move anything in it.
    repairs_page.open_repairs()
    assert repairs_page.has_row(model)
    assert not repairs_page.has_button(model, "Request repair →", timeout=3), (
        "moving a repair along is staff work"
    )

    # ---- 5. MANAGER runs the repair to completion ----------------------
    _sign_in(login_page, admin)
    repairs_page.open_repairs()
    repairs_page.advance(model)                       # → repair requested
    repairs_page.wait_for_toast("moved forward")
    repairs_page.wait_for_state(model, "Repair requested")

    repairs_page.advance(model)                       # → in repair
    repairs_page.wait_for_toast("moved forward")
    repairs_page.wait_for_state(model, "In repair")
    assert admin_api.device(device["id"])["status"] == "in_repair"

    # Scrapping the phone is an Admin decision, and the Admin is signed in,
    # so the option is theirs to see.
    assert repairs_page.has_button(model, "Write off…", timeout=3), (
        "an admin should be offered the write-off option"
    )

    repairs_page.advance(model)                       # → fixed
    repairs_page.wait_for_toast("moved forward")
    repairs_page.show_closed()
    repairs_page.wait_for_state(model, "Fixed")

    back = admin_api.device(device["id"])
    assert back["status"] == "available", "a fixed phone returns to the pool"
    assert back["project"]["name"] == seed_project["name"], "and keeps its project"

    # ---- 6. ADMIN reviews the trail and uses admin-only powers ---------
    _sign_in(login_page, accounts["admin"])

    audit_page.open_audit()
    audit_page.wait_for_entry("device", "created", admin["name"])
    audit_page.filter_actor(tester["name"])
    actors = audit_page.actors()
    assert actors and all(a == tester["name"] for a in actors), (
        f"the tester's actions should be attributable to them, saw {set(actors)}"
    )

    # Two things only an Admin may do, checked against the same journey.
    users_page = UsersPage(login_page.driver, login_page.base_url)
    users_page.open_users()
    users_page.search(tester["email"])
    assert users_page.roles_of(tester["email"]) == ["Lab Tester"], (
        "the row should say what the tester actually holds"
    )
    assert users_page.can_edit_roles(tester["email"], timeout=5), (
        "only an admin is offered a way to change somebody's roles"
    )

    from pages import SettingsPage

    settings = SettingsPage(login_page.driver, login_page.base_url).open_settings()
    assert settings.is_visible(settings.FLOW_HEADING), (
        "the admin can read how devices change hands"
    )
    assert settings.is_visible(settings.NOTIFICATIONS_HEADING), (
        "and owns the notification rules"
    )
