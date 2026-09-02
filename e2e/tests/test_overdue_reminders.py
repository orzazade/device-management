"""Chasing a late device.

A loan that runs past its due date is the one case where the app has to go
looking for people rather than wait for them. Two audiences need to hear
about it and they need different things:

  * the **holder**, who can end it — either bring the device back or, if the
    work genuinely is not finished, extend the loan;
  * the **desk** (managers and admins), who own the inventory and have to
    chase it, and who are blocked from lending the device to anyone else
    until it comes back.

Both are told when the loan first goes late, and both are told again on
every repeat round — the desk especially, because the longer a device is out
the more they need to know, and one alert at flip time is easy to scroll
past.
"""

from __future__ import annotations

import pytest

from api_client import Api
from pages import LoginPage, NotificationBell, RequestsPage

pytestmark = pytest.mark.lifecycle


@pytest.fixture
def requests_page(driver, base_url) -> RequestsPage:
    return RequestsPage(driver, base_url)


@pytest.fixture
def bell(driver, base_url) -> NotificationBell:
    return NotificationBell(driver, base_url)


def _sign_in(login_page: LoginPage, account: dict) -> None:
    login_page.clear_session()
    login_page.login(account["email"], account["password"])


def _about(feed: list[dict], request_id: str) -> list[str]:
    """Every notification in one account's feed about one request."""
    return [n["text"] for n in feed if (n.get("meta") or {}).get("requestId") == request_id]


@pytest.mark.smoke
def test_going_overdue_tells_the_holder_and_the_desk(
    overdue_loan, admin_api: Api, tester_api: Api
):
    """The first alert reaches both audiences, not just the person holding it."""
    device, req = overdue_loan()
    name = f"{device['brand']} {device['model']}"

    holder = _about(tester_api.notifications(), req["id"])
    desk = _about(admin_api.notifications(), req["id"])

    assert holder, "the holder was never told their device is overdue"
    assert desk, "the desk was never told a device is overdue"
    assert any(name in t for t in holder), f"the holder's alert never names {name}"
    assert any(name in t for t in desk), f"the desk's alert never names {name}"


def test_the_holder_is_told_extending_is_an_option(
    overdue_loan, tester_api: Api
):
    """Returning the device is not the only way out, and the reminder has to
    say so — a holder who still needs the phone should extend rather than
    ignore the alert."""
    _, req = overdue_loan()

    holder = _about(tester_api.notifications(), req["id"])
    assert any("extend" in t.lower() for t in holder), (
        f"no overdue alert mentions extending: {holder}"
    )


def test_the_repeat_reminder_reaches_the_desk_too(
    overdue_loan, age_notifications, admin_api: Api, tester_api: Api
):
    """The nag is not holder-only.

    The desk cannot lend the device to anyone else while it is out, so being
    told once at flip time and never again is exactly backwards.
    """
    _, req = overdue_loan()
    # Nothing repeats within three days of the last alert, so age the first
    # round out of the way before asking for the next one.
    age_notifications(req["id"], days=4)
    before_desk = len(_about(admin_api.notifications(), req["id"]))
    before_holder = len(_about(tester_api.notifications(), req["id"]))

    assert admin_api.renag_overdue()["sent"] >= 1, "the re-nag skipped a still-overdue loan"

    assert len(_about(admin_api.notifications(), req["id"])) > before_desk, (
        "the desk heard nothing on the repeat round"
    )
    assert len(_about(tester_api.notifications(), req["id"])) > before_holder, (
        "the holder heard nothing on the repeat round"
    )


def test_the_reminder_does_not_repeat_within_three_days(
    overdue_loan, admin_api: Api
):
    """A daily drumbeat trains people to ignore the bell. The quiet window is
    part of the feature, so it is asserted, not assumed."""
    _, req = overdue_loan()
    before = len(_about(admin_api.notifications(), req["id"]))

    admin_api.renag_overdue()

    assert len(_about(admin_api.notifications(), req["id"])) == before, (
        "a second reminder went out inside the three-day quiet window"
    )


@pytest.mark.smoke
def test_the_holder_can_extend_an_overdue_loan_from_the_ui(
    overdue_loan, login_page, accounts, requests_page: RequestsPage, admin_api: Api
):
    """The holder's own way out, driven through the browser: extending past
    today clears the overdue flag and the loan is simply active again."""
    device, req = overdue_loan()
    from conftest import _iso

    _sign_in(login_page, accounts["tester"])
    requests_page.open_requests()
    assert requests_page.own_state_of(device["model"]) == "Overdue", (
        "the holder's own row should show the loan is late"
    )

    dialog = requests_page.extend(device["model"])
    dialog.keep_until(_iso(3))
    dialog.submit()
    requests_page.wait_for_toast("Extended")

    after = admin_api.request_by_id(req["id"])
    assert after["state"] == "active", f"extending left the loan {after['state']!r}"
    assert after["toDate"] == _iso(3)
