"""Settings, the audit log and the idle-devices report."""

from __future__ import annotations

import pytest

from api_client import Api
from pages import AuditPage, ReportsPage, SettingsPage

pytestmark = pytest.mark.crud


@pytest.fixture
def settings(driver, base_url) -> SettingsPage:
    return SettingsPage(driver, base_url)


@pytest.fixture
def audit(driver, base_url) -> AuditPage:
    return AuditPage(driver, base_url)


@pytest.fixture
def reports(driver, base_url) -> ReportsPage:
    return ReportsPage(driver, base_url)


# ------------------------------------------------------------------- settings


@pytest.fixture
def restore_approval_mode(admin_api: Api):
    """Approval mode is global state — put it back however the test ends,
    or every later request test changes meaning."""
    before = admin_api.settings()["approvalMode"]
    yield before
    if admin_api.settings()["approvalMode"] != before:
        admin_api.set_approval_mode(before)


@pytest.mark.smoke
def test_the_approval_policy_can_be_flipped_and_flipped_back(
    as_admin, settings: SettingsPage, admin_api: Api, restore_approval_mode
):
    settings.open_settings()
    assert settings.approval_mode() == "all", "the launch policy is the default"

    settings.choose_mode("busy_only")
    settings.wait_for_toast("Approval policy saved")
    assert admin_api.settings()["approvalMode"] == "busy_only"

    # The choice survives a reload — it is server state, not a local toggle.
    settings.open_settings()
    settings.wait_for_mode("busy_only")

    settings.choose_mode("all")
    settings.wait_for_toast("Approval policy saved")
    assert admin_api.settings()["approvalMode"] == "all"


@pytest.mark.rbac
def test_a_manager_sees_the_policy_but_cannot_change_it(as_manager, settings: SettingsPage):
    settings.open_settings()

    assert not settings.mode_inputs_enabled(), "the radios are read-only for a manager"
    assert settings.is_visible(settings.ADMIN_ONLY_NOTE), "and the page says why"


def test_the_notification_matrix_names_its_audience(as_admin, settings: SettingsPage):
    settings.open_settings()
    settings.find(settings.NOTIFICATIONS_HEADING)

    labels = settings.rule_labels()
    assert labels, "the matrix should list the events that can notify someone"
    # Every row states who receives it, so the matrix is not a guess.
    for label in labels:
        assert settings.rule_audience(label), f"{label!r} has no audience column"


def test_toggling_a_notification_rule_persists(as_admin, settings: SettingsPage, admin_api: Api):
    settings.open_settings()
    settings.find(settings.NOTIFICATIONS_HEADING)
    label = settings.rule_labels()[0]
    before = settings.rule_is_on(label, "email")

    settings.toggle_rule(label, "email")
    settings.wait_for_toast("Notification rule saved")

    settings.open_settings()
    settings.find(settings.NOTIFICATIONS_HEADING)
    assert settings.rule_is_on(label, "email") is (not before), "the flip should stick"

    # Put it back so later runs start from the same matrix.
    settings.toggle_rule(label, "email")
    settings.wait_for_toast("Notification rule saved")
    settings.open_settings()
    settings.find(settings.NOTIFICATIONS_HEADING)
    assert settings.rule_is_on(label, "email") is before


def test_the_email_outbox_is_visible_so_failures_are_not_silent(
    as_admin, settings: SettingsPage
):
    """SMTP is unset in dev, so mail queues here instead of vanishing."""
    settings.open_settings()

    assert settings.is_visible(settings.OUTBOX_HEADING)
    summary = settings.outbox_summary()
    assert "waiting" in summary or "Every queued email" in summary, (
        f"unexpected outbox summary: {summary!r}"
    )


# ------------------------------------------------------------------ audit log


@pytest.mark.smoke
def test_a_ui_action_lands_in_the_audit_log(
    as_admin, audit: AuditPage, accounts, new_device, driver, base_url
):
    """The log is the reason the product can be trusted — it has to record
    a real action, not just exist."""
    from pages import DeviceDetailPage

    device = new_device()
    detail = DeviceDetailPage(driver, base_url)
    detail.open_device(device["id"])
    edit = detail.open_edit()
    edit.type(edit.OS_VERSION, "16")
    edit.save()
    detail.wait_for_toast("saved")

    audit.open_audit()
    entry = audit.wait_for_entry("device", "updated", accounts["admin"]["name"])
    assert "16" in entry, f"the change itself should be shown, row was {entry!r}"


def test_filters_narrow_the_log_and_live_in_the_url(as_admin, audit: AuditPage, accounts):
    audit.open_audit()
    assert audit.row_count() > 0, "the log should not be empty by now"

    audit.filter_entity("user")
    assert "entity=user" in audit.path, "a filtered view has to be shareable"
    entities = audit.entities()
    assert entities, "filtering to users should still show rows"
    assert all(e.lower().startswith("user") for e in entities), (
        f"the entity filter leaked other types: {entities}"
    )

    audit.filter_actor(accounts["admin"]["name"])
    assert "actor=" in audit.path
    actors = audit.actors()
    assert actors and all(a == accounts["admin"]["name"] for a in actors), (
        f"the actor filter leaked other people: {set(actors)}"
    )

    audit.click(audit.CLEAR_FILTERS)
    audit.wait_until_gone(audit.CLEAR_FILTERS)
    assert "entity=" not in audit.path and "actor=" not in audit.path


def test_an_impossible_filter_says_so_instead_of_showing_everything(
    as_admin, audit: AuditPage
):
    audit.open_audit()

    audit.filter_actor("nobody-by-this-name-exists")

    assert audit.is_visible(audit.NO_MATCH)
    assert audit.row_count() == 0


def test_the_log_offers_a_csv_export(as_admin, audit: AuditPage):
    audit.open_audit()

    assert audit.is_visible(audit.EXPORT_CSV), (
        "an auditor asks for the log as a file, not a screenshot"
    )


@pytest.mark.rbac
def test_the_audit_log_is_closed_to_testers(as_tester, audit: AuditPage):
    audit.open("/audit")

    audit.wait_for_path("/")
    assert not audit.is_visible(audit.HEADING, timeout=2), (
        "a tester must never see the audit log, typed URL or not"
    )


# -------------------------------------------------------------- idle devices


def test_a_device_left_on_the_shelf_shows_as_never_borrowed(
    as_admin, reports: ReportsPage, aged_device
):
    """The report exists to name hardware nobody asks for. `created_at` is
    what makes a device count as idle, so the fixture backdates it."""
    device = aged_device(days_old=200)

    reports.open_reports()

    assert reports.has_row(device["serial"])
    assert "never borrowed" in reports.last_activity_of(device["serial"])


def test_a_device_added_today_is_not_idle_yet(as_admin, reports: ReportsPage, new_device):
    """A device bought this morning has not had a chance to go unused."""
    device = new_device()

    reports.open_reports()

    assert not reports.has_row(device["serial"], timeout=4), (
        "the idle clock starts at creation — a new device must not be shamed on day one"
    )


def test_the_idle_window_can_be_narrowed(as_admin, reports: ReportsPage, aged_device):
    """A shorter window can only ever catch more devices, never fewer —
    "idle for 30 days" is a weaker test than "idle for 180"."""
    aged_device(days_old=45)

    reports.open_reports()
    assert reports.selected_days() == "90 days", "90 days is the default window"
    at_90 = reports.row_count()

    reports.choose_days("30 days")
    assert reports.selected_days() == "30 days"
    at_30 = reports.row_count()

    reports.choose_days("180 days")
    at_180 = reports.row_count()

    assert at_30 >= at_90 >= at_180, (
        f"idle counts should shrink as the window grows: 30d={at_30}, 90d={at_90}, 180d={at_180}"
    )
    assert at_30 > at_180, "the 45-day-old device should sit inside exactly one of these windows"


def test_a_device_that_is_out_on_loan_is_not_idle(
    as_admin, reports: ReportsPage, active_loan
):
    device, _ = active_loan()

    reports.open_reports()

    assert not reports.has_row(device["serial"], timeout=4), (
        "a device in someone's hands today is not sitting on a shelf"
    )
