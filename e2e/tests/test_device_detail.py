"""The single-device page: specs, history, editing, damage and soft delete."""

from __future__ import annotations

import pytest

from api_client import Api
from pages import DeviceDetailPage, DevicesPage

pytestmark = pytest.mark.crud


@pytest.fixture
def detail(driver, base_url) -> DeviceDetailPage:
    return DeviceDetailPage(driver, base_url)


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


@pytest.mark.smoke
def test_the_specs_tab_shows_what_the_lab_needs_to_identify_a_device(
    as_admin, detail: DeviceDetailPage, new_device, seed_project
):
    device = new_device(imei="353912100000123", accessories=["Box", "Cable"], specs={"RAM": "8 GB"})

    detail.open_device(device["id"])

    assert detail.heading == f"{device['brand']} {device['model']}"
    assert detail.status == "Available"
    assert detail.spec_value("Serial") == device["serial"]
    assert detail.spec_value("IMEI") == "353912100000123"
    assert detail.spec_value("Current holder") == "— (lab desk)"
    assert detail.spec_value("Project") == seed_project["name"]
    assert detail.spec_value("Accessories") == "Box · Cable"
    assert detail.spec_chip("RAM"), "free-form specs render as chips"


def test_history_records_who_created_the_device(
    as_admin, detail: DeviceDetailPage, new_device, accounts
):
    device = new_device()

    detail.open_device(device["id"])
    detail.show_history()

    actions = detail.history_actions()
    assert any("created" in a for a in actions), f"expected a 'created' entry, saw {actions}"
    detail.wait_for_text(accounts["admin"]["name"])


def test_a_device_with_no_repairs_says_so(as_admin, detail: DeviceDetailPage, new_device):
    device = new_device()

    detail.open_device(device["id"])
    detail.show_repairs()

    assert "Repairs (0)" in detail.repairs_tab_label()
    detail.wait_for_text("No repairs. Long may it last.")


@pytest.mark.smoke
def test_editing_a_device_saves_and_shows_the_new_values(
    as_admin, detail: DeviceDetailPage, admin_api: Api, new_device, seed_project
):
    device = new_device(os_version="13")

    detail.open_device(device["id"])
    edit = detail.open_edit()
    assert not edit.has_serial_field(), "the serial identifies the hardware and stays fixed"
    assert edit.is_visible(edit.SERIAL_NOTE)

    edit.type(edit.OS_VERSION, "15")
    edit.type(edit.IMEI, "353912100000999")
    edit.type(edit.ACCESSORIES, "Box, Charger, SIM tray")
    edit.save()

    detail.wait_for_toast("saved")
    assert not edit.is_open(timeout=5)
    assert detail.spec_value("IMEI") == "353912100000999"
    assert detail.spec_value("Accessories") == "Box · Charger · SIM tray"

    stored = admin_api.device(device["id"])
    assert stored["osVersion"] == "15"
    assert stored["accessories"] == ["Box", "Charger", "SIM tray"]


@pytest.mark.validation
def test_editing_rejects_an_empty_brand_and_a_bad_imei(
    as_admin, detail: DeviceDetailPage, new_device
):
    device = new_device()

    detail.open_device(device["id"])
    edit = detail.open_edit()

    edit.type(edit.BRAND, "")
    edit.type(edit.IMEI, "12ab")
    edit.save()

    assert edit.field_error("brand") == "Brand is required"
    assert edit.field_error("imei") == "IMEI is 8–20 digits, numbers only"
    assert edit.is_open()


def test_retiring_a_device_takes_it_out_of_circulation(
    as_admin, detail: DeviceDetailPage, admin_api: Api, new_device, seed_project
):
    device = new_device()

    detail.open_device(device["id"])
    edit = detail.open_edit()
    edit.select_by_visible_text(edit.STATUS, "Retired")
    edit.save()
    detail.wait_for_toast("saved")

    assert detail.status == "Retired"
    assert admin_api.device(device["id"])["status"] == "retired"
    assert not detail.is_visible(detail.REQUEST_BUTTON, timeout=2), (
        "a retired device cannot be requested"
    )


@pytest.mark.smoke
def test_reporting_damage_opens_a_repair_and_flags_the_device(
    as_tester, detail: DeviceDetailPage, admin_api: Api, new_device
):
    device = new_device()
    issue = "Back glass cracked after a drop"

    detail.open_device(device["id"])
    dialog = detail.open_report_damage()
    dialog.describe(issue)
    dialog.submit()

    detail.wait_for_toast("report")
    assert detail.is_visible(detail.DAMAGE_BANNER), "the damage note is called out on the page"
    detail.wait_for_text(issue)

    repair = admin_api.find_repair_for_device(device["id"])
    assert repair is not None and repair["state"] == "reported"
    assert repair["issue"] == issue
    assert admin_api.device(device["id"])["damageNote"] == issue


@pytest.mark.validation
def test_a_damage_report_needs_a_real_description(
    as_tester, detail: DeviceDetailPage, new_device
):
    device = new_device()

    detail.open_device(device["id"])
    dialog = detail.open_report_damage()

    dialog.submit()
    assert dialog.field_error("issue") == "Describe the problem"

    dialog.describe("oops")
    dialog.submit()
    assert dialog.field_error("issue") == "At least 5 characters"
    assert dialog.is_open()


def test_a_second_report_on_the_same_device_is_refused(
    as_tester, detail: DeviceDetailPage, reported_damage
):
    """One open repair per device — a duplicate would split the history."""
    device, _ = reported_damage()

    detail.open_device(device["id"])
    dialog = detail.open_report_damage()
    dialog.describe("Something else is broken too")
    dialog.submit()

    assert "already has an open repair" in dialog.banner_error


def test_deleting_a_device_hides_it_and_an_admin_can_restore_it(
    as_admin, detail: DeviceDetailPage, devices_page: DevicesPage, admin_api: Api, new_device
):
    device = new_device()

    detail.open_device(device["id"])
    edit = detail.open_edit()
    edit.delete()

    detail.wait_for_path("/devices")
    devices_page.search(device["serial"])
    assert devices_page.is_visible(devices_page.EMPTY_MESSAGE), (
        "a deleted device leaves the normal list"
    )

    devices_page.filter_status("Deleted 🗑")
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(device["serial"]) == "Deleted"
    assert not devices_page.has_request_button(device["serial"], timeout=2), (
        "a deleted device cannot be requested"
    )

    devices_page.click(
        (
            devices_page.row_for(device["serial"])[0],
            devices_page.row_for(device["serial"])[1] + "//button[normalize-space()='Restore']",
        )
    )
    devices_page.wait_for_toast("Device restored")
    assert admin_api.device(device["id"])["status"] == "available"


@pytest.mark.rbac
def test_a_tester_sees_the_device_but_not_the_edit_button(
    as_tester, detail: DeviceDetailPage, new_device
):
    device = new_device()

    detail.open_device(device["id"])

    assert detail.is_visible(detail.REQUEST_BUTTON), "a tester can still ask for the device"
    assert detail.is_visible(detail.REPORT_DAMAGE), "and can still report damage"
    assert not detail.is_visible(detail.EDIT, timeout=2), "editing is staff-only"


def test_the_edit_dialog_preselects_the_devices_current_project(
    as_admin, detail: DeviceDetailPage, new_device, seed_project
):
    """Opening Edit must show the project the device already belongs to.

    This was F-12: the selects used `defaultValue` while their options were
    still loading, so they opened on "— none —" and a save cleared the
    device's grouping. They are controlled now; this test guards the fix.
    """
    device = new_device()

    detail.open_device(device["id"])
    edit = detail.open_edit()

    assert edit.grouping_is_preselected(), (
        "the dialog opened with no project selected, although the device has one"
    )
