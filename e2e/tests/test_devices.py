"""The device inventory: creating, validating, searching and filtering."""

from __future__ import annotations

import time

import pytest

from api_client import Api
from pages import AddDeviceDialog, DevicesPage

pytestmark = pytest.mark.crud


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


@pytest.mark.smoke
def test_admin_creates_a_device_and_finds_it_in_the_list(
    as_admin, devices_page: DevicesPage, admin_api: Api, run_id: str, seed_project
):
    serial = f"SNADD{run_id}{int(time.time()) % 10000}"
    model = f"Galaxy Add {run_id}"

    devices_page.open_devices()
    dialog = devices_page.open_add_device()
    dialog.fill(
        brand="Samsung",
        model=model,
        os_name="Android",
        os_version="14",
        serial=serial,
        imei="353912100000001",
        accessories="Box, Cable, Charger",
        project=seed_project["name"],
        spec=("RAM", "8 GB"),
    )
    dialog.create()

    devices_page.wait_for_toast(f'Device "Samsung {model}" added')
    assert not dialog.is_open(timeout=5), "the dialog closes on success"
    assert devices_page.has_row(serial), "the new device shows up in the table"
    assert devices_page.cell_status(serial) == "Available"

    # Read back through the API: a toast is not proof the record landed.
    stored = admin_api.find_device_by_serial(serial)
    assert stored is not None, "device was not persisted"
    assert stored["brand"] == "Samsung"
    assert stored["model"] == model
    assert stored["project"]["name"] == seed_project["name"]
    assert stored["specs"]["RAM"] == "8 GB"
    assert stored["accessories"] == ["Box", "Cable", "Charger"]


@pytest.mark.validation
def test_add_device_requires_brand_model_os_and_serial(as_admin, devices_page: DevicesPage):
    devices_page.open_devices()
    dialog = devices_page.open_add_device()

    dialog.create()

    assert dialog.field_error("brand") == "Brand is required"
    assert dialog.field_error("model") == "Model is required"
    assert dialog.field_error("os") == "OS is required"
    assert dialog.field_error("serial") == "Serial is required"
    assert dialog.is_open(), "an invalid submit keeps the dialog open"


@pytest.mark.validation
@pytest.mark.parametrize(
    "field, value, expected",
    [
        ("serial", "ab c", "Letters and numbers only, at least 4, no spaces"),
        ("imei", "12ab", "IMEI is 8–20 digits, numbers only"),
    ],
)
def test_add_device_rejects_malformed_identifiers(
    as_admin, devices_page: DevicesPage, field: str, value: str, expected: str
):
    devices_page.open_devices()
    dialog = devices_page.open_add_device()
    dialog.fill(brand="Samsung", model="Galaxy Bad", os_name="Android", serial="SNGOOD123")

    dialog.type(getattr(AddDeviceDialog, field.upper()), value)
    dialog.create()

    assert dialog.field_error(field) == expected
    assert dialog.is_open()


@pytest.mark.validation
def test_duplicate_serial_is_refused_with_a_readable_message(
    as_admin, devices_page: DevicesPage, new_device, seed_project
):
    existing = new_device()

    devices_page.open_devices()
    dialog = devices_page.open_add_device()
    # A project is now mandatory, so supply one — otherwise the form stops at
    # "Pick a project or a squad" and never reaches the serial check.
    dialog.fill(
        brand="Samsung", model="Clone", os_name="Android",
        serial=existing["serial"], project=seed_project["name"],
    )
    dialog.create()

    error = dialog.banner_error.lower()
    assert "serial" in error or "already" in error or "exists" in error, (
        f"expected a duplicate-serial message, got {dialog.banner_error!r}"
    )
    assert dialog.is_open(), "the typed work stays on screen after a server refusal"


def test_cancelling_the_dialog_creates_nothing(
    as_admin, devices_page: DevicesPage, admin_api: Api, run_id: str
):
    serial = f"SNCANCEL{run_id}"

    devices_page.open_devices()
    dialog = devices_page.open_add_device()
    dialog.fill(brand="Nokia", model="Cancelled", os_name="Android", serial=serial)
    dialog.cancel()

    assert not dialog.is_open(timeout=5)
    assert admin_api.find_device_by_serial(serial) is None, "cancel must not save"


@pytest.mark.smoke
def test_search_narrows_the_table_to_one_device(
    as_admin, devices_page: DevicesPage, new_device
):
    target = new_device()
    new_device()  # a second device, so a match of one is meaningful

    devices_page.open_devices()
    devices_page.search(target["serial"])

    devices_page.wait_for_row_count(1)
    assert devices_page.has_row(target["serial"])


def test_search_with_no_match_explains_itself(as_admin, devices_page: DevicesPage):
    devices_page.open_devices()

    devices_page.search("zzz-nothing-matches-this-zzz")

    assert devices_page.is_visible(devices_page.EMPTY_MESSAGE)
    assert devices_page.row_count() == 0


def test_search_terms_survive_in_the_url(as_admin, devices_page: DevicesPage, new_device):
    """Filters mirror into the query string so the back button keeps them."""
    target = new_device()

    devices_page.open_devices()
    devices_page.search(target["serial"])

    assert target["serial"] in devices_page.path


def test_status_filter_shows_only_available_devices(
    as_admin, devices_page: DevicesPage, new_device, admin_api: Api
):
    fresh = new_device()

    devices_page.open_devices()
    devices_page.filter_status("Available")
    devices_page.search(fresh["serial"])

    devices_page.wait_for_row_count(1)
    assert devices_page.cell_status(fresh["serial"]) == "Available"
    assert "status=available" in devices_page.path


def test_header_search_jumps_to_the_devices_page(as_admin, devices_page: DevicesPage, new_device):
    target = new_device()

    as_admin.go_to("Dashboard")
    as_admin.search_globally(target["serial"])

    as_admin.wait_for_path("/devices")
    assert target["serial"] in devices_page.path
    devices_page.wait_for_row_count(1)
    assert devices_page.has_row(target["serial"])


def test_clicking_a_row_opens_that_device(as_admin, devices_page: DevicesPage, new_device):
    target = new_device()

    devices_page.open_devices()
    devices_page.search(target["serial"])
    devices_page.wait_for_row_count(1)
    devices_page.open_device(target["serial"])

    devices_page.wait_for_path(f"/devices/{target['id']}")
    devices_page.wait_for_text(target["model"])
    devices_page.wait_for_text(target["serial"])


@pytest.mark.rbac
def test_tester_cannot_add_or_import_devices(as_tester, devices_page: DevicesPage, new_device):
    target = new_device()

    devices_page.open_devices()

    assert not devices_page.is_visible(devices_page.ADD_BUTTON, timeout=2), (
        "Add device is staff-only"
    )
    assert not devices_page.is_visible(devices_page.IMPORT_BUTTON, timeout=2), (
        "Import Excel is staff-only"
    )
    # A tester can still see the inventory and ask for a device.
    devices_page.search(target["serial"])
    devices_page.wait_for_row_count(1)
    assert devices_page.has_request_button(target["serial"])
