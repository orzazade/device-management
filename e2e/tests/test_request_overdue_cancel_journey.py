"""Request, overdue and cancel — followed end to end through three people.

The cast, kept deliberately close to the real lab:

    Admin        runs the desk: adds phones, approves, hands over, checks in
    Lab tester   holds a phone and is the one who runs late with it
    Narmin       a second tester, the person waiting behind him in the queue

The single-role files prove each screen works. These three prove the
*sequences* work: a request that becomes a loan, a loan that goes late and
blocks the next person, and the several different ways a booking gets called
off. Each story is driven through the browser as the person living it, and
read back from the API so a green test means the data really changed.

Narmin is a fixed side account (qa.narmin@), not a fresh user per run — the
suite deliberately reuses accounts so the real user list stays readable.
"""

from __future__ import annotations

import pytest

from api_client import Api, ApiError
from conftest import _iso, skip_if_handover_blocked
from pages import (
    SECTION_HANDOVER,
    SECTION_OVERDUE,
    SECTION_PENDING,
    DevicesPage,
    LoginPage,
    RequestsPage,
)

pytestmark = [pytest.mark.lifecycle, pytest.mark.rbac]


@pytest.fixture
def devices_page(driver, base_url) -> DevicesPage:
    return DevicesPage(driver, base_url)


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


@pytest.fixture
def narmin(spare_account) -> dict:
    """The second tester — the one queuing behind the lab tester."""
    return spare_account("narmin", role="tester")


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


def _alerts(api: Api, request_id: str) -> list[str]:
    return [
        n["text"]
        for n in api.notifications()
        if (n.get("meta") or {}).get("requestId") == request_id
    ]


# --------------------------------------------------------------- 1. request


@pytest.mark.smoke
def test_request_journey_lab_tester_asks_admin_approves_and_hands_over(
    login_page: LoginPage,
    accounts,
    narmin,
    api_url,
    devices_page: DevicesPage,
    requests_page: RequestsPage,
    new_device,
    seed_project,
    admin_api: Api,
):
    """A phone leaves the shelf.

    The lab tester asks for it in the browser, the admin approves and hands it
    over in the browser, and Narmin — who wants the same phone — sees an
    honest picture of it being taken.
    """
    skip_if_handover_blocked()
    device = new_device()
    label = device["model"]

    # --- lab tester asks -------------------------------------------------
    _sign_in(login_page, accounts["tester"])
    devices_page.open_devices().search(label)
    assert devices_page.cell_status(label) == "Available", (
        "a brand new device should be on the shelf"
    )
    dialog = devices_page.open_request_for(label)
    dialog.choose_project(seed_project["name"])
    dialog.enter_reason("Regression pass on the new build")
    dialog.pick_first_free_range(span_days=1)
    assert dialog.submit_enabled(), "a complete request must be submittable"
    dialog.submit()
    requests_page.wait_for_toast("Request submitted")
    requests_page.wait_for_path("/requests")

    req = admin_api.find_request_for_device(device["id"])
    assert req is not None, "the request never reached the server"
    assert req["state"] == "pending", f"expected pending, got {req['state']}"

    # --- Narmin sees it is spoken for, but is not blocked ----------------
    _sign_in(login_page, narmin)
    devices_page.open_devices().search(label)
    assert devices_page.has_request_button(label), (
        "a pending request must not stop the next person asking for later dates"
    )

    # --- admin approves and hands over -----------------------------------
    _sign_in(login_page, accounts["admin"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_PENDING, label), (
        "the desk's approval queue should be showing this request"
    )
    requests_page.approve(label)
    requests_page.wait_for_toast("Approved")
    requests_page.confirm_handover(label)
    requests_page.wait_for_toast("Handover confirmed")

    out = admin_api.request_by_id(req["id"])
    assert out["state"] == "active", f"after handover expected active, got {out['state']}"
    assert admin_api.device(device["id"])["holder"]["id"] == accounts["tester"]["id"], (
        "the lab tester should now be recorded as holding the phone"
    )


# --------------------------------------------------------------- 2. overdue


@pytest.mark.smoke
def test_overdue_journey_blocks_narmin_until_the_admin_checks_it_back_in(
    login_page: LoginPage,
    accounts,
    narmin,
    api_url,
    requests_page: RequestsPage,
    overdue_loan,
    seed_project,
    admin_api: Api,
    tester_api: Api,
):
    """A late phone is not just the holder's problem.

    It is the desk's problem, because they have to chase it, and it is
    Narmin's problem, because she cannot be given a phone that never came
    back. All three see that, and checking it in clears it for everyone.
    """
    device, req = overdue_loan(days_late=2)
    label = device["model"]

    # --- the lab tester is told, and told what he can do about it --------
    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.own_state_of(label) == "Overdue", (
        "the holder's own row must show the loan is late"
    )
    assert requests_page.has_own_action(label, "Extend"), (
        "a holder who still needs the phone must be able to extend instead"
    )
    holder_alerts = _alerts(tester_api, req["id"])
    assert any("overdue" in t.lower() for t in holder_alerts), (
        f"the holder was never told: {holder_alerts}"
    )

    # --- Narmin asks for the same phone, and the desk cannot grant it ----
    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])
    narmin_req = narmin_api.create_request(
        device["id"], seed_project["id"], "Need it once it is free", _iso(4), _iso(6)
    )
    with pytest.raises(ApiError) as refused:
        admin_api.approve(narmin_req["id"])
    assert "overdue" in str(refused.value).lower(), (
        f"the refusal should explain the device is overdue: {refused.value}"
    )

    # --- the admin sees it in the chase list and checks it in ------------
    _sign_in(login_page, accounts["admin"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_OVERDUE, label), (
        "an overdue loan belongs in the desk's chase list"
    )
    requests_page.check_in(label, section=SECTION_OVERDUE).submit()
    requests_page.wait_for_toast("Returned")

    closed = admin_api.request_by_id(req["id"])
    assert closed["state"] == "returned", f"check-in left it {closed['state']!r}"
    assert admin_api.device(device["id"])["holder"] is None, (
        "a checked-in device has no holder"
    )

    # --- and now Narmin can be approved ----------------------------------
    admin_api.approve(narmin_req["id"])
    assert admin_api.request_by_id(narmin_req["id"])["state"] == "approved", (
        "once the phone is back, the queue should move"
    )


# ---------------------------------------------------------------- 3. cancel


def test_cancel_journey_narmin_withdraws_then_drops_a_confirmed_booking(
    login_page: LoginPage,
    narmin,
    api_url,
    requests_page: RequestsPage,
    new_device,
    seed_project,
    admin_api: Api,
):
    """The requester's own two ways out.

    A request nobody has agreed to yet is dropped outright. A booking the desk
    has already confirmed asks first, because releasing it gives the days back
    to everyone else and cannot be undone.
    """
    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])

    # --- pending: withdrawn without ceremony -----------------------------
    first = new_device()
    pending = narmin_api.create_request(
        first["id"], seed_project["id"], "Changed my mind about this one", _iso(1), _iso(2)
    )
    _sign_in(login_page, narmin)
    requests_page.open_requests()
    assert requests_page.has_own_action(first["model"], "Cancel"), (
        "a pending request should offer a plain Cancel"
    )
    requests_page.cancel_pending(first["model"])
    requests_page.wait_for_toast("cancel")
    # Cancelled is a closed state: the Open tab drops the row entirely.
    requests_page.show_all()
    requests_page.wait_for_own_state(first["model"], "Cancelled")
    assert admin_api.request_by_id(pending["id"])["state"] == "cancelled"

    # --- approved: asks first --------------------------------------------
    second = new_device()
    booking = narmin_api.create_request(
        second["id"], seed_project["id"], "Booked then no longer needed", _iso(1), _iso(2)
    )
    if admin_api.request_by_id(booking["id"])["state"] == "pending":
        admin_api.approve(booking["id"])

    requests_page.open_requests()
    confirm = requests_page.cancel_booking(second["model"])
    confirm.dismiss()
    assert admin_api.request_by_id(booking["id"])["state"] == "approved", (
        "backing out of the confirmation must leave the booking alone"
    )

    requests_page.cancel_booking(second["model"]).confirm()
    requests_page.wait_for_toast("cancel")
    requests_page.show_all()
    requests_page.wait_for_own_state(second["model"], "Cancelled")
    assert admin_api.request_by_id(booking["id"])["state"] == "cancelled"
    assert admin_api.device(second["id"])["status"] == "available", (
        "a released booking puts the phone back on the shelf"
    )


def test_cancel_journey_the_lab_tester_refuses_a_handover_and_narmin_hears_why(
    login_page: LoginPage,
    accounts,
    narmin,
    api_url,
    requests_page: RequestsPage,
    active_loan,
    seed_project,
    admin_api: Api,
):
    """The third way a booking dies: the person holding the phone cannot give
    it up. That is a decision the holder makes, not the desk, and the reason
    has to reach the person who was expecting the phone."""
    device, _ = active_loan(days_ahead=0, span=1)
    label = device["model"]

    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])
    waiting = narmin_api.create_request(
        device["id"], seed_project["id"], "Next in the queue for this phone", _iso(3), _iso(4)
    )
    if admin_api.request_by_id(waiting["id"])["state"] == "pending":
        admin_api.approve(waiting["id"])

    # --- the lab tester says he cannot hand it over ----------------------
    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_HANDOVER, label), (
        "the holder should be asked to hand the phone over"
    )
    dialog = requests_page.cant_hand_over(label)
    dialog.with_note("Still mid-run on the release candidate, cannot free it up")
    dialog.submit()
    requests_page.wait_for_toast("cancel")

    killed = admin_api.request_by_id(waiting["id"])
    assert killed["state"] == "cancelled", f"expected cancelled, got {killed['state']}"

    # --- and Narmin is told, with the reason ------------------------------
    told = _alerts(narmin_api, waiting["id"])
    assert any("cancel" in t.lower() for t in told), (
        f"Narmin was never told her booking was called off: {told}"
    )
    assert any("mid-run" in t for t in told), (
        f"the reason never reached her: {told}"
    )


def test_cancel_journey_the_admin_can_call_off_someone_elses_request(
    login_page: LoginPage,
    accounts,
    narmin,
    api_url,
    new_device,
    seed_project,
    admin_api: Api,
):
    """The desk's override, and the string attached to it: staff can cancel
    anyone's request, but never silently — a reason is required and it is
    delivered to the person whose plans just changed."""
    device = new_device()
    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])
    req = narmin_api.create_request(
        device["id"], seed_project["id"], "Planned regression slot", _iso(2), _iso(3)
    )

    with pytest.raises(ApiError) as bare:
        admin_api.post(f"/requests/{req['id']}/cancel")
    assert "reason" in str(bare.value).lower(), (
        f"cancelling someone else's request must demand a reason: {bare.value}"
    )
    assert admin_api.request_by_id(req["id"])["state"] != "cancelled", (
        "the rejected attempt must not have cancelled anything"
    )

    admin_api.post(
        f"/requests/{req['id']}/cancel",
        {"note": "Phone recalled for a firmware update"},
    )
    assert admin_api.request_by_id(req["id"])["state"] == "cancelled"

    told = _alerts(narmin_api, req["id"])
    assert any("firmware" in t for t in told), (
        f"the desk's reason never reached Narmin: {told}"
    )
