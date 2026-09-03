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
from conftest import _iso
from pages import (
    SECTION_MINE,
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
    device = new_device()
    label = device["model"]

    # --- lab tester asks, and that is that -------------------------------
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

    # Nobody was holding it, so there was nobody to ask: it is his already.
    req = admin_api.find_request_for_device(device["id"])
    assert req is not None, "the request never reached the server"
    assert req["state"] == "active", f"a free phone should be taken, got {req['state']}"
    assert admin_api.device(device["id"])["holder"]["id"] == accounts["tester"]["id"]

    # --- Narmin now has to ask him, not the desk -------------------------
    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])
    hers = narmin_api.create_request(
        device["id"], seed_project["id"], "I need it after him", _iso(0), _iso(1)
    )
    assert hers["state"] == "pending", "a held phone has to be asked for"

    _sign_in(login_page, narmin)
    requests_page.open_requests()
    assert requests_page.own_state_of(label) == "Pending"

    # --- the lab tester approves, and the phone moves --------------------
    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_MINE, label), (
        "the request belongs to whoever is holding the phone"
    )
    requests_page.approve_as_holder(label)
    requests_page.wait_for_toast("Approved")

    out = admin_api.request_by_id(hers["id"])
    assert out["state"] == "active", f"approval should assign it, got {out['state']}"
    assert admin_api.device(device["id"])["holder"]["id"] == narmin["id"], (
        "the phone should have moved to Narmin"
    )
    assert admin_api.request_by_id(req["id"])["state"] == "returned", (
        "the lab tester's loan ends when he passes it on"
    )

    # --- and an Admin can see every step of it ---------------------------
    actions = [
        a["action"] for a in admin_api.audit("?limit=300")
        if a.get("entityId") in {req["id"], hers["id"]}
    ]
    for expected in ("created", "taken", "approved", "transferred"):
        assert expected in actions, f"{expected!r} missing from the audit trail: {actions}"


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
    # The desk cannot sign the phone over from a distance: it is late, which
    # means nobody has confirmed where it actually is. Only the person
    # holding it can pass it on, and only by physically doing so.
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
    active_loan,
    seed_project,
    admin_api: Api,
):
    """The requester's own two ways out.

    A request nobody has agreed to yet is dropped outright. A booking already
    granted asks first, because releasing it gives the days back to everyone
    else and cannot be undone.

    Both need a phone somebody else is holding: a free one is taken on the
    spot, so it never sits in a state there is anything to withdraw from.
    """
    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])

    # --- pending: withdrawn without ceremony -----------------------------
    first, _ = active_loan(days_ahead=0, span=1)
    pending = narmin_api.create_request(
        first["id"], seed_project["id"], "Changed my mind about this one", _iso(1), _iso(2)
    )
    assert pending["state"] == "pending"
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

    # --- granted for later: asks first ------------------------------------
    # Approval hands a phone over immediately, so the only way to hold a
    # booking that has been granted but not yet started is to book ahead.
    second, _ = active_loan(days_ahead=0, span=1)
    booking = narmin_api.create_request(
        second["id"], seed_project["id"], "Booked then no longer needed", _iso(4), _iso(5)
    )
    admin_api.approve(booking["id"])
    assert admin_api.request_by_id(booking["id"])["state"] == "approved"

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


def test_cancel_journey_the_lab_tester_refuses_and_narmin_hears_why(
    login_page: LoginPage,
    accounts,
    narmin,
    api_url,
    requests_page: RequestsPage,
    active_loan,
    seed_project,
    admin_api: Api,
):
    """The third way a request dies: the person holding the phone says no.
    That is the holder's call, not the desk's, and the reason has to reach the
    person who was hoping for the phone."""
    device, mine = active_loan(days_ahead=0, span=1)
    label = device["model"]

    narmin_api = Api(api_url)
    narmin_api.login(narmin["email"], narmin["password"])
    waiting = narmin_api.create_request(
        device["id"], seed_project["id"], "Next in the queue for this phone", _iso(0), _iso(1)
    )
    assert waiting["state"] == "pending"

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.has_row_in(SECTION_MINE, label), (
        "the holder is the one being asked"
    )
    dialog = requests_page.reject_as_holder(label)
    dialog.with_note("Still mid-run on the release candidate, cannot free it up")
    dialog.submit()
    requests_page.wait_for_toast("reject")

    killed = admin_api.request_by_id(waiting["id"])
    assert killed["state"] == "rejected", f"expected rejected, got {killed['state']}"
    assert admin_api.request_by_id(mine["id"])["state"] == "active", (
        "saying no leaves his own loan untouched"
    )

    told = _alerts(narmin_api, waiting["id"])
    assert any("reject" in t.lower() for t in told), (
        f"Narmin was never told her request was refused: {told}"
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
