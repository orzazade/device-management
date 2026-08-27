"""Sign-in, sign-out, session handling and the forced password change."""

from __future__ import annotations

import pytest
from selenium.webdriver.common.by import By

from api_client import Api
from conftest import DEFAULT_PASSWORD
from pages import ChangePasswordModal, LoginPage

pytestmark = pytest.mark.auth


@pytest.mark.smoke
def test_login_page_shows_its_form(login_page: LoginPage):
    login_page.open_login()

    assert login_page.path.startswith("/login")
    assert login_page.find(login_page.EMAIL).get_attribute("type") == "email"
    assert login_page.find(login_page.PASSWORD).get_attribute("type") == "password"
    assert login_page.is_visible(login_page.SUBMIT)
    assert login_page.is_visible(login_page.LDAP_NOTE), "LDAP note is part of the login copy"


@pytest.mark.smoke
def test_valid_credentials_land_on_the_dashboard(login_page: LoginPage, shell, accounts):
    admin = accounts["admin"]

    login_page.login(admin["email"], admin["password"])

    assert shell.path == "/"
    assert shell.heading.startswith("Hi,"), f"unexpected dashboard greeting: {shell.heading!r}"
    assert admin["name"].split()[0] in shell.heading
    assert login_page.token(), "a JWT should be stored after a successful sign-in"


@pytest.mark.validation
def test_empty_submit_shows_both_field_errors(login_page: LoginPage):
    login_page.open_login()

    login_page.submit_empty()

    assert login_page.field_error("email") == "Enter your work email"
    assert login_page.field_error("password") == "Enter your password"
    assert login_page.path.startswith("/login"), "a failed submit must not navigate"


@pytest.mark.validation
def test_malformed_email_is_rejected_before_the_request(login_page: LoginPage):
    login_page.open_login()

    login_page.submit_credentials("not-an-email", "whatever123")

    assert login_page.field_error("email") == "Enter a valid email, like name@company.com"
    assert login_page.path.startswith("/login")


def test_wrong_password_shows_a_neutral_error(login_page: LoginPage, accounts):
    login_page.open_login()

    login_page.submit_credentials(accounts["admin"]["email"], "DefinitelyWrong9")

    assert login_page.error_text == "Wrong email or password"
    assert login_page.path.startswith("/login")
    assert not login_page.token(), "a rejected sign-in must not store a token"


def test_unknown_account_is_indistinguishable_from_a_wrong_password(
    login_page: LoginPage, run_id: str
):
    """Same wording for both cases — the login screen must not confirm which
    email addresses exist."""
    login_page.open_login()

    login_page.submit_credentials(f"{run_id}.ghost@devicedesk.local", "Whatever1234")

    assert login_page.error_text == "Wrong email or password"


@pytest.mark.smoke
def test_sign_out_clears_the_session(as_admin, login_page: LoginPage):
    assert login_page.token()

    as_admin.sign_out()

    login_page.find(login_page.EMAIL)
    assert login_page.path.startswith("/login")
    assert not login_page.token(), "signing out must drop the stored JWT"


def test_protected_page_redirects_an_anonymous_visitor_to_login(login_page: LoginPage):
    login_page.open("/devices")

    login_page.find(login_page.EMAIL)
    assert login_page.path.startswith("/login")


def test_sign_in_returns_the_visitor_to_the_page_they_asked_for(
    login_page: LoginPage, shell, accounts
):
    """The redirect to /login remembers `from`, so a deep link survives it."""
    login_page.open("/devices")
    login_page.find(login_page.EMAIL)

    login_page.submit_credentials(accounts["admin"]["email"], accounts["admin"]["password"])
    shell.wait_loaded()

    assert shell.path == "/devices", "the original destination should be restored"


@pytest.mark.smoke
def test_default_password_forces_a_change_before_the_app_opens(
    login_page: LoginPage, shell, root_api: Api, spare_account
):
    """An account still on the factory password must be walled off from the
    app until it picks its own.

    Uses a permanent account reset to the factory password rather than a new
    user, so repeated runs do not pile up accounts.
    """
    account = spare_account("firstlogin", password=DEFAULT_PASSWORD)
    email = account["email"]
    new_password = "Chosen2026pass"

    login_page.open_login()
    login_page.submit_credentials(email, DEFAULT_PASSWORD)

    modal = ChangePasswordModal(login_page.driver, login_page.base_url).wait_open()
    assert modal.is_visible(modal.FORCED_NOTICE), "the forced variant explains why"
    assert not modal.has_cancel(), "the forced dialog must offer no way out but changing"

    # The factory password cannot simply be re-entered as the new one.
    modal.fill(DEFAULT_PASSWORD, DEFAULT_PASSWORD)
    modal.submit()
    assert "factory default" in modal.banner_error

    modal.fill(DEFAULT_PASSWORD, new_password)
    modal.submit()
    modal.wait_for_toast("Password changed")
    assert not modal.is_open(timeout=5), "the dialog closes once the password is set"
    assert shell.heading.startswith("Hi,"), "and the dashboard is finally reachable"

    # The new password is the real one now, and the old one is dead.
    login_page.clear_session()
    login_page.open_login()
    login_page.submit_credentials(email, DEFAULT_PASSWORD)
    assert login_page.error_text == "Wrong email or password"

    login_page.login(email, new_password)
    assert shell.path == "/"
    assert not ChangePasswordModal(login_page.driver, login_page.base_url).is_open(timeout=3), (
        "the forced dialog must not come back for a password the user chose"
    )


@pytest.mark.validation
def test_new_password_must_be_confirmed_and_strong(as_admin, shell, accounts):
    """The self-service dialog from the user menu enforces the same rules."""
    shell.open_change_password()
    modal = ChangePasswordModal(shell.driver, shell.base_url).wait_open()
    assert modal.has_cancel(), "the voluntary dialog is dismissible"

    modal.fill(accounts["admin"]["password"], "short1")
    modal.submit()
    assert modal.field_error("newPassword") == "At least 8 characters"

    modal.fill(accounts["admin"]["password"], "alllettersonly")
    modal.submit()
    assert modal.field_error("newPassword") == "At least 8 characters, with letters and numbers"

    modal.fill(accounts["admin"]["password"], "Correct2026a", confirm="Different2026a")
    modal.submit()
    assert modal.banner_error == "The two new passwords do not match"

    # Leave without changing anything — later tests still need this password.
    modal.click(modal.CANCEL)
    assert not modal.is_open(timeout=5)


def test_a_tampered_token_drops_the_user_at_login_with_a_notice(
    as_admin, driver, base_url, login_page: LoginPage
):
    """A rejected /auth/me must send the user to /login?expired=1, not leave
    them staring at a broken shell."""
    driver.execute_script(
        "localStorage.setItem('devicedesk.token', 'ey.not.a.real.token');"
    )
    driver.get(f"{base_url}/devices")

    login_page.find(login_page.EMAIL)
    assert login_page.path.startswith("/login")
    assert not login_page.token(), "an invalid token must be cleared, not kept"
