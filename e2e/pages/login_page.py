"""The sign-in screen (`/login`) and the forced password-change modal that
follows a sign-in with the factory-default password."""

from __future__ import annotations

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq


class LoginPage(BasePage):
    EMAIL = (By.CSS_SELECTOR, "input[name='email']")
    PASSWORD = (By.CSS_SELECTOR, "input[name='password']")
    SUBMIT = (By.XPATH, "//button[contains(., 'Sign in')]")
    ERROR = (By.XPATH, "//p[contains(@class,'text-red-700')]")
    EXPIRED_NOTICE = (By.XPATH, "//p[contains(., 'Your session expired')]")
    BRAND = (By.XPATH, "//*[contains(text(), 'Device Management')]")
    LDAP_NOTE = (By.XPATH, "//p[contains(., 'Corporate LDAP sign-in')]")

    def open_login(self) -> "LoginPage":
        self.open("/login")
        self.find(self.EMAIL)
        return self

    def submit_credentials(self, email: str, password: str) -> "LoginPage":
        self.type(self.EMAIL, email)
        self.type(self.PASSWORD, password)
        self.click(self.SUBMIT)
        return self

    def submit_empty(self) -> "LoginPage":
        self.click(self.SUBMIT)
        return self

    def login(self, email: str, password: str) -> "LoginPage":
        """Sign in and wait for the app shell — including its 2s splash."""
        self.open_login()
        self.submit_credentials(email, password)
        self.wait_for_app_shell()
        return self

    def wait_for_app_shell(self) -> None:
        self.find((By.XPATH, "//nav//a[normalize-space()='Dashboard']"))

    @property
    def error_text(self) -> str:
        return self.find(self.ERROR).text.strip()


class ChangePasswordModal(BasePage):
    """Shared by the forced first-login flow and the self-service menu item."""

    HEADING = (By.XPATH, "//h2[normalize-space()='Change password']")
    FORCED_NOTICE = (By.XPATH, "//p[contains(., 'You signed in with the default password')]")
    CURRENT = (By.CSS_SELECTOR, "input[name='currentPassword']")
    NEW = (By.CSS_SELECTOR, "input[name='newPassword']")
    CONFIRM = (By.CSS_SELECTOR, "input[name='confirm']")
    SUBMIT = (By.XPATH, "//button[contains(., 'Change password')]")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "ChangePasswordModal":
        self.find(self.HEADING)
        return self

    def fill(self, current: str, new: str, confirm: str | None = None) -> "ChangePasswordModal":
        self.type(self.CURRENT, current)
        self.type(self.NEW, new)
        self.type(self.CONFIRM, new if confirm is None else confirm)
        return self

    def submit(self) -> "ChangePasswordModal":
        # Only the dialog's submit control is a <button>; the <h2> shares the
        # wording but not the tag, so this stays unambiguous.
        self.click(self.SUBMIT)
        return self

    def has_cancel(self) -> bool:
        return self.is_visible(self.CANCEL, timeout=2)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)
