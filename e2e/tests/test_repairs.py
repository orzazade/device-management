"""The repair queue and its state machine.

reported → repair requested → in repair → fixed, with cancel and write-off
as the two ways out. The forward button relabels itself at each step, which
is the clearest evidence the state actually moved.
"""

from __future__ import annotations

import pytest

from api_client import Api
from pages import DeviceDetailPage, DevicesPage, RepairsPage

pytestmark = pytest.mark.crud


@pytest.fixture
def repairs(driver, base_url) -> RepairsPage:
    return RepairsPage(driver, base_url)


@pytest.fixture
def detail(driver, base_url) -> DeviceDetailPage:
    return DeviceDetailPage(driver, base_url)


@pytest.mark.smoke
def test_a_reported_repair_walks_the_whole_state_machine(
    as_admin, repairs: RepairsPage, admin_api: Api, reported_damage
):
    device, _ = reported_damage("Charging port loose")
    label = device["model"]

    repairs.open_repairs()
    assert repairs.has_row(label)
    assert repairs.state_of(label) == "Reported"
    assert repairs.issue_of(label) == "Charging port loose"

    repairs.advance(label)  # Request repair →
    repairs.wait_for_toast("Repair moved forward")
    repairs.wait_for_state(label, "Repair requested")

    repairs.advance(label)  # Send to repair →
    repairs.wait_for_toast("Repair moved forward")
    repairs.wait_for_state(label, "In repair")
    assert admin_api.device(device["id"])["status"] == "in_repair", (
        "a device being repaired must not look borrowable"
    )

    repairs.advance(label)  # Mark fixed ✓
    repairs.wait_for_toast("Repair moved forward")

    # Fixed repairs leave the Open tab for Closed.
    repairs.show_closed()
    repairs.wait_for_state(label, "Fixed")
    assert admin_api.find_repair_for_device(device["id"])["state"] == "fixed"
    assert admin_api.device(device["id"])["status"] == "available", (
        "a fixed device returns to the pool"
    )


def test_the_open_tab_counts_only_unfinished_repairs(
    as_admin, repairs: RepairsPage, reported_damage
):
    device, _ = reported_damage()

    repairs.open_repairs()
    before = repairs.open_count()
    assert repairs.has_row(device["model"])

    repairs.show_closed()
    assert not repairs.has_row(device["model"], timeout=3), (
        "an open repair does not belong under Closed"
    )

    repairs.show_open()
    assert repairs.open_count() == before


def test_cancelling_a_mistaken_report_clears_the_damage_note(
    as_admin, repairs: RepairsPage, detail: DeviceDetailPage, admin_api: Api, reported_damage
):
    device, _ = reported_damage("Reported by mistake")
    label = device["model"]

    repairs.open_repairs()
    confirm = repairs.cancel_report(label)
    assert "Cancel this damage report?" in confirm.title
    confirm.cancel()
    assert repairs.state_of(label) == "Reported", "dismissing the dialog changes nothing"

    confirm = repairs.cancel_report(label)
    confirm.confirm()
    repairs.wait_for_toast("Report cancelled")

    assert admin_api.device(device["id"])["damageNote"] in (None, ""), (
        "a cancelled report must not leave the device flagged"
    )
    detail.open_device(device["id"])
    assert not detail.is_visible(detail.DAMAGE_BANNER, timeout=3)


def test_only_an_admin_can_write_a_device_off(
    login_page, accounts, repairs: RepairsPage, admin_api: Api, reported_damage
):
    device, repair = reported_damage("Board damage after a drop")
    label = device["model"]
    admin_api.post(f"/repairs/{repair['id']}/advance")  # -> repair_requested

    # A tester can watch the queue but not touch it, and certainly not
    # scrap hardware.
    login_page.login(accounts["tester"]["email"], accounts["tester"]["password"])
    repairs.open_repairs()
    assert not repairs.has_button(label, "Write off…", timeout=2), (
        "scrapping hardware is an admin decision"
    )
    assert not repairs.has_button(label, "Send to repair →", timeout=2), (
        "a tester cannot move the queue along either"
    )

    login_page.clear_session()
    login_page.login(accounts["admin"]["email"], accounts["admin"]["password"])
    repairs.open_repairs()
    dialog = repairs.write_off(label)
    dialog.submit()
    assert dialog.field_error("reason") == "Say why this device is being scrapped"

    dialog.with_reason("Repair quote exceeds the value of the device")
    dialog.submit()
    repairs.wait_for_toast("written off")

    assert admin_api.device(device["id"])["status"] == "retired"
    repairs.show_closed()
    repairs.wait_for_state(label, "Written off")


@pytest.mark.rbac
def test_a_tester_can_read_the_queue_but_not_move_anything(
    as_tester, repairs: RepairsPage, reported_damage
):
    device, _ = reported_damage()

    repairs.open_repairs()

    assert repairs.has_row(device["model"]), "testers can see what is broken"
    assert not repairs.has_button(device["model"], "Request repair →", timeout=2)
    assert not repairs.has_button(device["model"], "Cancel report", timeout=2)


def test_a_repair_shows_up_on_the_device_page_too(
    as_admin, detail: DeviceDetailPage, reported_damage
):
    device, _ = reported_damage("Speaker rattles at volume")

    detail.open_device(device["id"])
    detail.show_repairs()

    assert "Repairs (1)" in detail.repairs_tab_label()
    detail.wait_for_text("Speaker rattles at volume")


def test_the_sidebar_badge_counts_open_repairs(as_admin, reported_damage):
    reported_damage()

    as_admin.open("/")
    as_admin.wait_heading("Hi,")

    badge = as_admin.nav_badge("Repairs")
    assert badge and int(badge) >= 1, f"expected an open-repair badge, saw {badge!r}"
