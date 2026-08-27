"""The branches of the loan flow that are not the happy path.

Cancelling, extending, a tester handing back, a holder refusing a handover,
and the desk moving someone's dates before approving.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from api_client import Api
from pages import (
    SECTION_HANDOVER,
    SECTION_OUT_NOW,
    SECTION_PENDING,
    DevicesPage,
    LoginPage,
    RequestsPage,
)

pytestmark = pytest.mark.lifecycle


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


def _iso(days_ahead: int) -> str:
    return (date.today() + timedelta(days=days_ahead)).isoformat()


def test_a_requester_can_withdraw_a_pending_request(
    login_page, accounts, requests_page: RequestsPage, admin_api: Api, pending_request
):
    device, _ = pending_request()
    label = device["model"]

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.own_state_of(label) == "Pending"

    requests_page.cancel_pending(label)
    requests_page.wait_for_toast("cancel")

    requests_page.show_all()
    requests_page.wait_for_own_state(label, "Cancelled")
    assert admin_api.find_request_for_device(device["id"])["state"] == "cancelled"
    assert admin_api.device(device["id"])["status"] == "available"


def test_cancelling_an_approved_booking_asks_first(
    login_page, accounts, requests_page: RequestsPage, admin_api: Api, pending_request
):
    """Releasing an approved booking cannot be undone, so it is confirmed."""
    device, req = pending_request()
    admin_api.approve(req["id"])
    label = device["model"]

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    requests_page.wait_for_own_state(label, "Awaiting handover")

    confirm = requests_page.cancel_booking(label)
    confirm.dismiss()
    assert requests_page.own_state_of(label) == "Awaiting handover", (
        "backing out of the dialog keeps the booking"
    )

    confirm = requests_page.cancel_booking(label)
    confirm.confirm()
    requests_page.wait_for_toast("cancel")

    assert admin_api.find_request_for_device(device["id"])["state"] == "cancelled"


@pytest.mark.smoke
def test_a_holder_can_extend_a_loan(
    login_page, accounts, requests_page: RequestsPage, admin_api: Api, active_loan
):
    device, req = active_loan(span=2)
    label = device["model"]
    later = _iso(9)

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    requests_page.wait_for_own_state(label, "Active")

    dialog = requests_page.extend(label)
    assert dialog.current_due_date() == req["toDate"], (
        "the dialog opens on the date the loan currently ends"
    )
    dialog.keep_until(later)
    dialog.submit()
    requests_page.wait_for_toast("Extended")

    assert admin_api.find_request_for_device(device["id"])["toDate"] == later


def test_an_extension_onto_someone_elses_booking_is_refused_with_the_reason(
    login_page,
    accounts,
    requests_page: RequestsPage,
    admin_api: Api,
    tester_api: Api,
    spare_account,
    active_loan,
    seed_project,
):
    """The calendar is the shared resource — an extension cannot quietly eat
    days another person already owns."""
    device, req = active_loan(days_ahead=0, span=1)
    label = device["model"]

    # A second person books the same device for a later, non-overlapping window.
    rival_account = spare_account("rival", role="tester")
    rival = admin_api.as_user(rival_account["email"], rival_account["password"])
    rival_req = rival.create_request(
        device["id"], seed_project["id"], "Later slot for the rival team", _iso(5), _iso(8)
    )
    admin_api.approve(rival_req["id"])

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    dialog = requests_page.extend(label)
    dialog.keep_until(_iso(6))  # straight into the rival's window
    dialog.submit()

    assert dialog.is_open(), "a refused extension must keep the dialog open"
    assert dialog.banner_error, "the refusal has to say something"
    # Look the loan up by id: this device now carries two requests, so a
    # device-based lookup could read the rival's row instead.
    assert admin_api.request_by_id(req["id"])["toDate"] == req["toDate"], (
        "the loan must be unchanged after a refused extension"
    )


def test_a_tester_returning_a_device_notifies_the_desk_instead_of_closing_the_loan(
    login_page, accounts, requests_page: RequestsPage, admin_api: Api, active_loan
):
    """Only staff can check hardware back in — that is the receipt."""
    device, _ = active_loan()
    label = device["model"]

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    requests_page.wait_for_own_state(label, "Active")

    confirm = requests_page.offer_return(label)
    confirm.confirm()
    requests_page.wait_for_toast("desk")

    assert admin_api.find_request_for_device(device["id"])["state"] == "active", (
        "the loan stays open until a manager physically accepts the device"
    )
    assert admin_api.device(device["id"])["status"] == "assigned"

    # The desk closes it for real.
    _sign_in(login_page, accounts["admin"])
    requests_page.open_requests()
    ret = requests_page.check_in(label)
    ret.submit()
    requests_page.wait_for_toast("Returned")
    assert admin_api.device(device["id"])["status"] == "available"


def test_a_holder_who_cannot_hand_over_cancels_the_booking_with_a_reason(
    login_page,
    accounts,
    requests_page: RequestsPage,
    admin_api: Api,
    active_loan,
    tester_api: Api,
    seed_project,
):
    """A device already in someone's hands can be requested by the next
    person; if the holder still needs it, they say so and the booking dies."""
    device, _ = active_loan(days_ahead=0, span=1)
    label = device["model"]

    # The desk books the same device for itself, starting after the loan.
    follow_up = admin_api.create_request(
        device["id"], seed_project["id"], "Next in line for the release test", _iso(3), _iso(4)
    )
    admin_api.approve(follow_up["id"])

    # The current holder is the one asked to hand it over.
    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_HANDOVER, label), (
        "the handover queue belongs to whoever holds the device"
    )

    dialog = requests_page.cant_hand_over(label)
    dialog.submit()
    assert dialog.field_error("note"), "a refusal without a reason helps nobody"

    dialog.with_note("Still needed for the release test until Friday")
    dialog.submit()
    requests_page.wait_for_toast("cancel")

    refreshed = [
        r for r in admin_api.requests_all() if r["id"] == follow_up["id"]
    ][0]
    assert refreshed["state"] == "cancelled"
    assert refreshed["decisionNote"], "the requester must be told why"


def test_the_desk_can_move_a_requested_time_range_before_approving(
    login_page, accounts, requests_page: RequestsPage, admin_api: Api, pending_request
):
    device, req = pending_request(days_ahead=1, span=1)
    label = device["model"]

    _sign_in(login_page, accounts["admin"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_PENDING, label)

    dialog = requests_page.override_time(label)
    dialog.pick_range(span_days=3)
    assert "Selected:" in dialog.selected_summary()
    dialog.submit()
    requests_page.wait_for_toast("Time range updated")

    after = admin_api.find_request_for_device(device["id"])
    assert (after["fromDate"], after["toDate"]) != (req["fromDate"], req["toDate"]), (
        "the override should have moved the window"
    )
    assert after["state"] == "pending", "moving the dates is not the same as approving"


def test_a_pending_request_blocks_nothing_but_warns_the_next_requester(
    login_page, accounts, devices_page: DevicesPage, pending_request, seed_project
):
    """Pending days show as 'requested' in the calendar: pickable, but the
    picker says someone else asked first."""
    device, _ = pending_request(days_ahead=0, span=3)

    _sign_in(login_page, accounts["manager"])
    devices_page.open_devices()
    devices_page.search(device["serial"])
    devices_page.wait_for_row_count(1)
    dialog = devices_page.open_request_for(device["serial"])

    amber = dialog.find_all(
        (
            "xpath",
            "//div[contains(@class,'grid-cols-7')]/button[contains(@class,'amber')]",
        )
    )
    assert amber, "the days someone already asked for should be marked"
    assert all(d.is_enabled() for d in amber), (
        "a pending request must not lock the calendar — the approver decides"
    )
