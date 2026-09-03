"""The loan lifecycle, driven entirely through the browser.

request → approve → hand over → check in

This is the flow the product exists for, so it gets the most careful
assertions: after every UI step the test checks both what the screen says and
what the API now holds.
"""

from __future__ import annotations

import pytest

from api_client import Api
from pages import (
        SECTION_OUT_NOW,
    SECTION_PENDING,
    DevicesPage,
    LoginPage,
    RequestsPage,
)

pytestmark = pytest.mark.lifecycle


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


@pytest.mark.smoke
def test_a_device_goes_out_and_comes_back(
    login_page: LoginPage,
    devices_page: DevicesPage,
    requests_page: RequestsPage,
    accounts,
    admin_api: Api,
    new_device,
    seed_project,
):
    device = new_device(accessories=["Box", "Charger"])
    label = device["model"]
    tester = accounts["tester"]

    # --- 1. the tester asks for the device ------------------------------
    _sign_in(login_page, tester)
    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Available"
    assert devices_page.cell_holder(device["serial"]) == "—"

    dialog = devices_page.open_request_for(device["serial"])
    dialog.choose_project(seed_project["name"])
    dialog.enter_reason("Regression pass on the new billing screens")
    dialog.pick_first_free_range(span_days=2)
    assert dialog.submit_enabled(), "a complete form should be submittable"
    dialog.submit()

    requests_page.wait_for_toast("Request submitted")
    requests_page.wait_for_path("/requests")
    assert requests_page.has_row(label)

    # --- 2. nobody held it, so it is already theirs ----------------------
    # There is no approval step for a phone on the shelf: asking for it is
    # taking it, and the device changes hands in the same call.
    assert requests_page.own_state_of(label) == "Active"

    stored = admin_api.find_request_for_device(device["id"])
    assert stored is not None and stored["state"] == "active"
    assert stored["requester"]["name"] == tester["name"]
    assert stored["project"]["name"] == seed_project["name"]

    assigned = admin_api.device(device["id"])
    assert assigned["status"] == "assigned"
    assert assigned["holder"]["name"] == tester["name"]

    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Assigned"
    assert tester["name"] in devices_page.cell_holder(device["serial"])

    # --- 3. the desk takes it back ---------------------------------------
    _sign_in(login_page, accounts["admin"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_OUT_NOW, label), "the loan shows as out"
    ret = requests_page.check_in(label)
    ret.submit()
    requests_page.wait_for_toast("Returned — device is available again")

    closed = admin_api.find_request_for_device(device["id"])
    assert closed["state"] == "returned"
    back = admin_api.device(device["id"])
    assert back["status"] == "available"
    assert back.get("holder") in (None, {}), "the device should have no holder again"

    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Available"
    assert devices_page.cell_holder(device["serial"]) == "—"


@pytest.mark.validation
def test_a_request_needs_a_reason_a_project_and_a_date_range(
    login_page: LoginPage,
    devices_page: DevicesPage,
    accounts,
    new_device,
    seed_project,
):
    device = new_device()

    _sign_in(login_page, accounts["tester"])
    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    dialog = devices_page.open_request_for(device["serial"])

    # No range picked yet: the submit button is the guard.
    assert not dialog.submit_enabled(), (
        "Submit must stay disabled until a time range exists"
    )

    dialog.pick_first_free_range()
    assert dialog.submit_enabled()

    dialog.submit()
    assert dialog.field_error("reason") == "Tell the approver why you need it"

    dialog.enter_reason("too short")
    dialog.submit()
    assert dialog.field_error("reason") == "At least 10 characters"

    dialog.enter_reason("A perfectly reasonable justification for this loan")
    dialog.submit()
    dialog.wait_for_toast("Request submitted")


def test_a_rejected_request_carries_the_reason_back_to_the_requester(
    login_page: LoginPage,
    devices_page: DevicesPage,
    requests_page: RequestsPage,
    accounts,
    admin_api: Api,
    pending_request,
):
    """Only a device somebody is holding can be rejected — a free one is
    simply taken. So the person holding it is the one who says no, and the
    reason has to travel back to whoever asked."""
    device, req, holder = pending_request()
    label = device["model"]
    note = "Reserved for the release test that week"

    _sign_in(login_page, holder)
    requests_page.open_requests()
    reject = requests_page.reject_as_holder(label)
    reject.with_note(note)
    reject.submit()
    requests_page.wait_for_toast("reject")

    stored = admin_api.request_by_id(req["id"])
    assert stored["state"] == "rejected"
    assert admin_api.device(device["id"])["status"] == "assigned", (
        "a rejection leaves the phone with whoever already had it"
    )

    # The requester sees the verdict and the reason under "all".
    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    requests_page.show_all()
    assert requests_page.has_row(label)
    assert requests_page.state_of(label) == "Rejected"
    requests_page.wait_for_text(note)


def test_a_damaged_return_sends_the_device_to_repairs(
    login_page: LoginPage,
    devices_page: DevicesPage,
    requests_page: RequestsPage,
    shell,
    accounts,
    admin_api: Api,
    new_device,
    seed_project,
):
    device = new_device(accessories=["Box", "Charger"])
    label = device["model"]
    damage = "Screen cracked in the bottom-left corner"

    _sign_in(login_page, accounts["tester"])
    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    dialog = devices_page.open_request_for(device["serial"])
    dialog.choose_project(seed_project["name"])
    dialog.enter_reason("Drop-test scenarios for the camera module")
    dialog.pick_first_free_range()
    dialog.submit()
    requests_page.wait_for_toast("Request submitted")

    # Free device, so the tester already has it — the desk only checks it
    # back in.
    _sign_in(login_page, accounts["admin"])
    requests_page.open_requests()
    ret = requests_page.check_in(label)
    ret.uncheck_accessory("Charger")
    ret.mark_damaged(damage)
    ret.submit()
    requests_page.wait_for_toast("Returned — sent to repairs")

    after = admin_api.device(device["id"])
    assert after["status"] == "in_repair", f"expected in_repair, got {after['status']}"
    assert after["damageNote"] == damage

    # The repairs page is where the lab picks this up next.
    shell.go_to("Repairs")
    shell.wait_for_path("/repairs")
    shell.wait_for_text(label)
