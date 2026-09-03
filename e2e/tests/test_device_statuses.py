"""Devices in every status, each one attached to a project.

A device's status is not a field somebody types — it is the result of what
happened to the hardware. So each test here drives the real event that
produces the status, then checks the device list, the device page and the
stored record agree.

    Available  → a device that was just added, or has come back
    Assigned   → handed over to a person
    In repair  → sent to repair after damage
    Retired    → taken out of service by staff
    Deleted    → removed from the lists, restorable by staff

Every device created here is saved against the run's project, and each test
re-checks that the project tag survives the status change — a device that
loses its project when it breaks is a device nobody can account for.
"""

from __future__ import annotations

import time

import pytest

from api_client import Api
from pages import (
        SECTION_OUT_NOW,
    DeviceDetailPage,
    DevicesPage,
    LoginPage,
    RequestsPage,
)

pytestmark = pytest.mark.crud


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


@pytest.fixture
def detail(driver, base_url) -> DeviceDetailPage:
    return DeviceDetailPage(driver, base_url)


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


# ------------------------------------------------------------------ available


@pytest.mark.smoke
def test_a_device_added_through_the_ui_is_available_and_in_its_project(
    as_admin, devices_page: DevicesPage, admin_api: Api, seed_project, run_id: str
):
    """The starting status. An admin adds hardware and it is immediately
    borrowable, tagged to the project it was bought for."""
    serial = f"SNAVAIL{run_id}{int(time.time()) % 10000}"
    model = f"Galaxy Available {run_id}"

    devices_page.open_devices()
    dialog = devices_page.open_add_device()
    dialog.fill(
        brand="Samsung",
        model=model,
        os_name="Android",
        os_version="15",
        serial=serial,
        project=seed_project["name"],
    )
    dialog.create()
    devices_page.wait_for_toast("added")

    devices_page.search(serial)
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(serial) == "Available"
    assert devices_page.cell_holder(serial) == "—", "a free device has no holder"

    stored = admin_api.find_device_by_serial(serial)
    assert stored["status"] == "available"
    assert stored["project"]["name"] == seed_project["name"], "the project tag must stick"


# ------------------------------------------------------------------- assigned


@pytest.mark.smoke
@pytest.mark.lifecycle
def test_a_device_becomes_assigned_once_it_is_handed_over(
    login_page: LoginPage,
    devices_page: DevicesPage,
    requests_page: RequestsPage,
    detail: DeviceDetailPage,
    accounts,
    admin_api: Api,
    pending_request,
    seed_project,
):
    """Assigned is earned, not set: it is the person holding the phone saying
    yes that moves it, and the move happens in that same moment."""
    device, req, holder = pending_request()
    label = device["model"]

    login_page.clear_session()
    login_page.login(holder["email"], holder["password"])
    requests_page.open_requests()

    requests_page.approve_as_holder(label)
    requests_page.wait_for_toast("Approved")

    stored = admin_api.device(device["id"])
    assert stored["status"] == "assigned"
    assert stored["holder"]["name"] == accounts["tester"]["name"]
    assert stored["project"]["name"] == seed_project["name"], "still in its project"

    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Assigned"
    assert accounts["tester"]["name"] in devices_page.cell_holder(device["serial"])

    detail.open_device(device["id"])
    assert detail.status == "Assigned"
    assert detail.spec_value("Current holder") == accounts["tester"]["name"]
    assert detail.spec_value("Project") == seed_project["name"]


# ------------------------------------------------------------------ in repair


@pytest.mark.smoke
def test_a_device_sent_to_repair_shows_as_in_repair(
    login_page: LoginPage,
    devices_page: DevicesPage,
    detail: DeviceDetailPage,
    accounts,
    admin_api: Api,
    reported_damage,
    seed_project,
):
    """A broken device must stop looking borrowable the moment the lab takes
    it in — otherwise someone books hardware that is on a repair bench."""
    device, repair = reported_damage("Screen unresponsive along the bottom edge")

    # Reported alone does not take it out of the pool; the desk moving it does.
    assert admin_api.device(device["id"])["status"] == "available"
    admin_api.post(f"/repairs/{repair['id']}/advance")  # → repair requested
    admin_api.post(f"/repairs/{repair['id']}/advance")  # → in repair

    stored = admin_api.device(device["id"])
    assert stored["status"] == "in_repair"
    assert stored["project"]["name"] == seed_project["name"], "still in its project"

    login_page.clear_session()
    login_page.login(accounts["admin"]["email"], accounts["admin"]["password"])
    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "In repair"
    assert not devices_page.has_request_button(device["serial"], timeout=3), (
        "a device on the repair bench must not be requestable"
    )

    detail.open_device(device["id"])
    assert detail.status == "In repair"
    assert detail.is_visible(detail.DAMAGE_BANNER)


# -------------------------------------------------------------------- retired


def test_a_device_can_be_retired_and_leaves_circulation(
    as_admin, devices_page: DevicesPage, detail: DeviceDetailPage,
    admin_api: Api, new_device, seed_project,
):
    """End of life. The record stays for history, but nobody can book it."""
    device = new_device()

    detail.open_device(device["id"])
    edit = detail.open_edit()
    edit.select_by_visible_text(edit.STATUS, "Retired")
    edit.save()
    detail.wait_for_toast("saved")

    assert detail.status == "Retired"
    stored = admin_api.device(device["id"])
    assert stored["status"] == "retired"
    assert stored["project"]["name"] == seed_project["name"], "history keeps the project"
    assert not detail.is_visible(detail.REQUEST_BUTTON, timeout=2)

    devices_page.open_devices()
    devices_page.filter_status("Retired")
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Retired"


# -------------------------------------------------------------------- deleted


def test_a_deleted_device_leaves_the_list_and_can_be_brought_back(
    as_admin, devices_page: DevicesPage, detail: DeviceDetailPage,
    admin_api: Api, new_device, seed_project,
):
    """Deletion hides a device without destroying its history — a mistake has
    to be undoable."""
    device = new_device()

    detail.open_device(device["id"])
    detail.open_edit().delete()
    detail.wait_for_path("/devices")

    devices_page.search(device["serial"])
    assert devices_page.is_visible(devices_page.EMPTY_MESSAGE), "gone from the normal list"

    devices_page.filter_status("Deleted 🗑")
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Deleted"

    devices_page.click(
        (
            devices_page.row_for(device["serial"])[0],
            devices_page.row_for(device["serial"])[1] + "//button[normalize-space()='Restore']",
        )
    )
    devices_page.wait_for_toast("restored")

    stored = admin_api.device(device["id"])
    assert stored["status"] == "available", "restored devices come back borrowable"
    assert stored["project"]["name"] == seed_project["name"], "and keep their project"


# ------------------------------------------------- all statuses side by side


@pytest.mark.smoke
def test_the_status_filter_separates_every_status(
    as_admin,
    devices_page: DevicesPage,
    admin_api: Api,
    new_device,
    active_loan,
    reported_damage,
    seed_project,
    run_id: str,
):
    """One device in each status, all in the same project, then filter for
    each one in turn. This is the test that would catch a filter quietly
    returning the wrong set."""
    available = new_device()

    assigned, _ = active_loan()

    broken, repair = reported_damage("Battery swells under charge")
    admin_api.post(f"/repairs/{repair['id']}/advance")
    admin_api.post(f"/repairs/{repair['id']}/advance")

    retired = new_device()
    # PATCH runs the same project-or-squad rule as create, so the grouping has
    # to travel with the status change.
    admin_api.request(
        "PATCH",
        f"/devices/{retired['id']}",
        json={"status": "retired", "projectId": seed_project["id"]},
    )

    expected = {
        "Available": available,
        "Assigned": assigned,
        "In repair": broken,
        "Retired": retired,
    }

    # Every one of them belongs to the project, whatever happened to it.
    for label, device in expected.items():
        stored = admin_api.device(device["id"])
        assert stored["project"]["name"] == seed_project["name"], (
            f"the {label} device lost its project tag"
        )

    devices_page.open_devices()
    for label, device in expected.items():
        devices_page.filter_status(label)
        devices_page.search(device["serial"])
        devices_page.wait_for_row_count(1)
        assert devices_page.cell_status(device["serial"]) == label

        # and the others must NOT be in this filtered view
        for other_label, other in expected.items():
            if other_label == label:
                continue
            devices_page.search(other["serial"])
            assert devices_page.is_visible(devices_page.EMPTY_MESSAGE, timeout=6), (
                f"the {label} filter also returned the {other_label} device"
            )
