"""The 'holder approves' policy.

Normally the lab desk decides every request. Under this policy the decision
moves to whoever is physically holding the device: if Narmin asks for the
phone the lab tester has, the lab tester approves or rejects it, and managers
stay out of it entirely. A device nobody holds has nobody to ask, so it
auto-approves.

The requester hears the outcome the same way as always — that part of the
flow is deliberately unchanged, and these tests check it still is.
"""

from __future__ import annotations

import pytest

from api_client import Api, ApiError
from conftest import skip_if_handover_blocked
from pages import SECTION_MINE, LoginPage, NotificationBell, RequestsPage

pytestmark = [pytest.mark.lifecycle, pytest.mark.rbac]


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


@pytest.fixture
def bell(driver, base_url) -> NotificationBell:
    return NotificationBell(driver, base_url)


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


def _iso(api: Api, days: int) -> str:
    from datetime import date, timedelta

    return (date.today() + timedelta(days=days)).isoformat()


@pytest.mark.smoke
def test_the_holder_approves_and_the_requester_is_told(
    login_page: LoginPage,
    requests_page: RequestsPage,
    accounts,
    admin_api: Api,
    approval_mode,
    active_loan,
    seed_project,
):
    """The example this policy exists for: someone asks for a phone another
    tester is holding, and that tester decides."""
    skip_if_handover_blocked()
    # Put the phone in the tester's hands first, then turn the policy on —
    # switching it mid-loan is exactly how it would happen in the lab.
    device, _ = active_loan(days_ahead=0, span=2)
    approval_mode("holder")
    label = device["model"]
    holder, asker = accounts["tester"], accounts["manager"]

    asked = admin_api.as_user(asker["email"], asker["password"]).create_request(
        device["id"], seed_project["id"],
        "Need it for the regression pass next week",
        _iso(admin_api, 5), _iso(admin_api, 6),
    )
    assert asked["state"] == "pending", "a held device still needs a decision"

    # The holder sees it as theirs to decide.
    _sign_in(login_page, holder)
    requests_page.open_requests()
    assert requests_page.has_section(SECTION_MINE), (
        "the holder should be shown the request waiting on them"
    )
    assert requests_page.has_row_in(SECTION_MINE, label)
    assert requests_page.requester_of(label) == asker["name"]

    requests_page.approve_as_holder(label)
    requests_page.wait_for_toast("Approved")

    decided = admin_api.request_by_id(asked["id"])
    assert decided["state"] == "approved"

    # And the requester hears about it through the usual channel.
    _sign_in(login_page, asker)
    requests_page.open_requests()
    requests_page.show_all()
    assert requests_page.own_state_of(label) == "Awaiting handover"


def test_the_holder_can_reject_and_the_reason_reaches_the_requester(
    login_page: LoginPage,
    requests_page: RequestsPage,
    accounts,
    admin_api: Api,
    approval_mode,
    active_loan,
    seed_project,
):
    skip_if_handover_blocked()
    device, _ = active_loan(days_ahead=0, span=2)
    approval_mode("holder")
    label = device["model"]
    holder, asker = accounts["tester"], accounts["manager"]
    note = "Still running the release suite on it that week"

    asked = admin_api.as_user(asker["email"], asker["password"]).create_request(
        device["id"], seed_project["id"], "Needed for exploratory testing",
        _iso(admin_api, 5), _iso(admin_api, 6),
    )

    _sign_in(login_page, holder)
    requests_page.open_requests()
    reject = requests_page.reject_as_holder(label)
    reject.with_note(note)
    reject.submit()
    requests_page.wait_for_toast("rejected")

    decided = admin_api.request_by_id(asked["id"])
    assert decided["state"] == "rejected"
    assert decided["decisionNote"] == note

    # Same notification path as always — the requester sees verdict and reason.
    _sign_in(login_page, asker)
    requests_page.open_requests()
    requests_page.show_all()
    assert requests_page.own_state_of(label) == "Rejected"
    requests_page.wait_for_text(note)


@pytest.mark.rbac
def test_managers_are_bypassed_entirely(
    accounts, admin_api: Api, approval_mode, active_loan, seed_project
):
    """"Bypass managers" means exactly that: staff cannot decide a request
    that belongs to a holder, however senior they are."""
    skip_if_handover_blocked()
    device, _ = active_loan(days_ahead=0, span=2)
    approval_mode("holder")

    asker = admin_api.as_user(accounts["manager"]["email"], accounts["manager"]["password"])
    asked = asker.create_request(
        device["id"], seed_project["id"], "Wanted for the compatibility matrix",
        _iso(admin_api, 5), _iso(admin_api, 6),
    )

    with pytest.raises(ApiError) as refused:
        admin_api.approve(asked["id"])          # the run's Admin
    assert "holding this device" in str(refused.value)

    with pytest.raises(ApiError):
        asker.post(f"/requests/{asked['id']}/reject", {"note": "changed my mind"})

    assert admin_api.request_by_id(asked["id"])["state"] == "pending", (
        "a refused decision must leave the request untouched"
    )


def test_a_device_nobody_holds_is_approved_immediately(
    accounts, admin_api: Api, approval_mode, new_device, seed_project, tester_api: Api
):
    """There is no peer to ask for a phone sitting on the shelf, so the
    request does not sit waiting for one."""
    approval_mode("holder")
    device = new_device()

    asked = tester_api.create_request(
        device["id"], seed_project["id"], "Quick smoke test on a spare handset",
        _iso(admin_api, 0), _iso(admin_api, 1),
    )

    assert asked["state"] == "approved", (
        f"a free device should auto-approve under this policy, got {asked['state']}"
    )
    assert admin_api.device(device["id"])["status"] == "available", (
        "approval is not a handover — the desk still hands it over"
    )


def test_the_desk_keeps_deciding_under_the_normal_policy(
    accounts, admin_api: Api, approval_mode, pending_request
):
    """A guard on the change itself: with the policy back to 'all', staff
    decide again and nothing above leaks into normal operation."""
    approval_mode("all")
    device, req = pending_request()

    admin_api.approve(req["id"])

    assert admin_api.request_by_id(req["id"])["state"] == "approved"
