"""How a device changes hands — the whole process, in one file.

There is no approver tier and no configuration. Two situations exist:

  * **Nobody is holding it.** The requester takes it. There is no decision to
    make, so there is no approval step and no waiting.
  * **Somebody is holding it.** That person decides. If Narmin asks for the
    phone the lab tester has, the lab tester approves or rejects it, and
    approving hands the phone over there and then.

The requester hears the outcome either way, with the reason on a rejection.
"""

from __future__ import annotations

import pytest

from api_client import Api, ApiError
from conftest import _iso
from pages import SECTION_MINE, LoginPage, NotificationBell, RequestsPage

pytestmark = [pytest.mark.lifecycle, pytest.mark.rbac]


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


@pytest.fixture
def bell(driver, base_url) -> NotificationBell:
    return NotificationBell(driver, base_url)


@pytest.fixture
def narmin(spare_account) -> dict:
    return spare_account("narmin", role="tester")


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


@pytest.mark.smoke
def test_a_device_nobody_holds_is_simply_taken(
    new_device, tester_api: Api, admin_api: Api, seed_project, accounts
):
    """No approval step exists for a phone sitting on the shelf. Asking for it
    is taking it — the request comes back already active, with the device in
    the requester's name."""
    device = new_device()
    req = tester_api.create_request(
        device["id"], seed_project["id"], "Regression pass", _iso(0), _iso(2)
    )

    assert req["state"] == "active", f"a free device should be taken, not queued: {req['state']}"
    stored = admin_api.device(device["id"])
    assert stored["status"] == "assigned"
    assert stored["holder"]["id"] == accounts["tester"]["id"], (
        "the requester should be holding it immediately"
    )


@pytest.mark.smoke
def test_the_holder_approves_and_the_phone_moves(
    login_page: LoginPage,
    requests_page: RequestsPage,
    accounts,
    narmin,
    admin_api: Api,
    active_loan,
    seed_project,
):
    """The case this whole design exists for: Narmin asks for the phone the
    lab tester is holding, and the lab tester is the one who decides. Saying
    yes moves the phone in the same breath — there is no second step."""
    device, first_loan = active_loan(days_ahead=0, span=2)
    label = device["model"]

    asked = admin_api.as_user(narmin["email"], narmin["password"]).create_request(
        device["id"], seed_project["id"], "Need it for the regression pass", _iso(0), _iso(1)
    )
    assert asked["state"] == "pending", "a held device has to be asked for"

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.has_section(SECTION_MINE), (
        "the holder should be shown the request waiting on them"
    )
    assert requests_page.has_row_in(SECTION_MINE, label)

    requests_page.approve_as_holder(label)
    requests_page.wait_for_toast("Approved")

    decided = admin_api.request_by_id(asked["id"])
    assert decided["state"] == "active", f"approval should assign it, got {decided['state']}"
    assert admin_api.device(device["id"])["holder"]["id"] == narmin["id"], (
        "the phone should now be Narmin's"
    )
    assert admin_api.request_by_id(first_loan["id"])["state"] == "returned", (
        "the holder's own loan ends when they pass the phone on"
    )


def test_the_holder_can_reject_and_the_reason_reaches_the_requester(
    login_page: LoginPage,
    requests_page: RequestsPage,
    accounts,
    narmin,
    admin_api: Api,
    active_loan,
    seed_project,
):
    """Saying no is a real answer, and it comes with an explanation."""
    device, _ = active_loan(days_ahead=0, span=2)
    label = device["model"]
    narmin_api = admin_api.as_user(narmin["email"], narmin["password"])
    asked = narmin_api.create_request(
        device["id"], seed_project["id"], "Could I borrow it", _iso(0), _iso(1)
    )

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    dialog = requests_page.reject_as_holder(label)
    dialog.with_note("Still mid-run on the release candidate")
    dialog.submit()
    requests_page.wait_for_toast("reject")

    decided = admin_api.request_by_id(asked["id"])
    assert decided["state"] == "rejected"
    assert "release candidate" in (decided["decisionNote"] or ""), (
        "the reason has to be stored, not just shown once"
    )
    told = [
        n["text"] for n in narmin_api.notifications()
        if (n.get("meta") or {}).get("requestId") == asked["id"]
    ]
    assert any("release candidate" in t for t in told), (
        f"the reason never reached the requester: {told}"
    )
    assert admin_api.device(device["id"])["holder"]["id"] == accounts["tester"]["id"], (
        "a rejection leaves the phone exactly where it was"
    )


def test_a_bystander_cannot_decide_someone_elses_request(
    narmin, admin_api: Api, active_loan, seed_project, spare_account
):
    """The decision belongs to the holder alone. Not the requester, and not
    another tester who happens to be looking at the queue."""
    device, _ = active_loan(days_ahead=0, span=2)
    narmin_api = admin_api.as_user(narmin["email"], narmin["password"])
    asked = narmin_api.create_request(
        device["id"], seed_project["id"], "Please", _iso(0), _iso(1)
    )

    with pytest.raises(ApiError) as own:
        narmin_api.approve(asked["id"])
    assert "403" in str(own.value), "the requester must not approve her own request"

    rival = spare_account("rival", role="tester")
    rival_api = admin_api.as_user(rival["email"], rival["password"])
    with pytest.raises(ApiError) as other:
        rival_api.approve(asked["id"])
    assert "403" in str(other.value), "an uninvolved tester must not decide it"

    assert admin_api.request_by_id(asked["id"])["state"] == "pending", (
        "neither refused attempt may have changed anything"
    )


def test_an_admin_override_is_recorded_as_an_override(
    narmin, admin_api: Api, active_loan, seed_project
):
    """Somebody has to be able to unstick a request whose holder has left the
    company. The Admin can, and the audit log says it was an override rather
    than dressing it up as the holder's own decision."""
    device, _ = active_loan(days_ahead=0, span=2)
    narmin_api = admin_api.as_user(narmin["email"], narmin["password"])
    asked = narmin_api.create_request(
        device["id"], seed_project["id"], "Blocked on this phone", _iso(0), _iso(1)
    )

    admin_api.approve(asked["id"])

    assert admin_api.request_by_id(asked["id"])["state"] == "active"
    actions = [
        a["action"] for a in admin_api.audit("?limit=200")
        if a.get("entityId") == asked["id"]
    ]
    assert "admin_override_approved" in actions, (
        f"an Admin overriding the holder must be recorded as such: {actions}"
    )
