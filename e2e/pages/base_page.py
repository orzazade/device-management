"""Shared browser helpers every page object builds on.

Two app-specific facts drive most of what is in here:

  * The app shell shows a 2-second brand splash on EVERY load of a
    protected page (Layout.tsx). Nothing inside the shell exists in the DOM
    until it clears, so waits have to outlast it.
  * There are no data-testid attributes anywhere in the app. Selectors lean
    on the `name` attribute that VForm's VField renders, on visible text,
    and on ARIA roles (toasts are role="status").
"""

from __future__ import annotations

import os
import time

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

# Generous enough to cover the 2s splash plus a cold Vite module transform.
DEFAULT_TIMEOUT = 20

# Optional pause after each interaction, so a human can follow a headed run.
# Set E2E_SLOWMO=0.4 (seconds) or pass --slow to pytest.
SLOWMO = float(os.environ.get("E2E_SLOWMO", "0"))


class BasePage:
    def __init__(self, driver, base_url: str) -> None:
        self.driver = driver
        self.base_url = base_url.rstrip("/")

    # ------------------------------------------------------------ navigation

    def open(self, path: str = "/") -> "BasePage":
        self.driver.get(f"{self.base_url}{path}")
        return self

    @property
    def path(self) -> str:
        """Current URL path + query, without the origin."""
        url = self.driver.current_url
        return url[len(self.base_url):] if url.startswith(self.base_url) else url

    def wait_for_path(self, expected: str, timeout: int = DEFAULT_TIMEOUT) -> None:
        try:
            self.wait(timeout).until(lambda d: self.path.split("?")[0] == expected)
        except TimeoutException:
            raise AssertionError(f"expected to land on {expected!r}, still on {self.path!r}")

    # ----------------------------------------------------------------- waits

    def wait(self, timeout: int = DEFAULT_TIMEOUT) -> WebDriverWait:
        return WebDriverWait(self.driver, timeout, poll_frequency=0.15)

    def find(self, locator: tuple[str, str], timeout: int = DEFAULT_TIMEOUT) -> WebElement:
        """First element matching the locator, once it is actually visible."""
        try:
            return self.wait(timeout).until(EC.visibility_of_element_located(locator))
        except TimeoutException:
            raise AssertionError(f"no visible element for {locator} after {timeout}s")

    def find_all(self, locator: tuple[str, str]) -> list[WebElement]:
        return self.driver.find_elements(*locator)

    def find_clickable(self, locator: tuple[str, str], timeout: int = DEFAULT_TIMEOUT) -> WebElement:
        try:
            return self.wait(timeout).until(EC.element_to_be_clickable(locator))
        except TimeoutException:
            raise AssertionError(f"element {locator} never became clickable after {timeout}s")

    def is_present(self, locator: tuple[str, str], timeout: int = 3) -> bool:
        """Deliberately short timeout — used for 'this must NOT be here' checks."""
        try:
            self.wait(timeout).until(EC.presence_of_element_located(locator))
            return True
        except TimeoutException:
            return False

    def is_visible(self, locator: tuple[str, str], timeout: int = 3) -> bool:
        try:
            self.wait(timeout).until(EC.visibility_of_element_located(locator))
            return True
        except TimeoutException:
            return False

    def wait_until_gone(self, locator: tuple[str, str], timeout: int = DEFAULT_TIMEOUT) -> None:
        try:
            self.wait(timeout).until(EC.invisibility_of_element_located(locator))
        except TimeoutException:
            raise AssertionError(f"element {locator} was still on screen after {timeout}s")

    def wait_for_text(self, text: str, timeout: int = DEFAULT_TIMEOUT) -> None:
        locator = (By.XPATH, f"//*[contains(normalize-space(.), {xq(text)})]")
        try:
            self.wait(timeout).until(EC.presence_of_element_located(locator))
        except TimeoutException:
            raise AssertionError(f"text {text!r} never appeared on {self.path!r}")

    # ------------------------------------------------------------ interaction

    def click(self, locator: tuple[str, str], timeout: int = DEFAULT_TIMEOUT) -> None:
        el = self.find_clickable(locator, timeout)
        self._click_element(el)

    def _click_element(self, el: WebElement) -> None:
        self.driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        try:
            el.click()
        except (ElementClickInterceptedException, StaleElementReferenceException):
            # A toast can drift over a button near the bottom of the viewport.
            self.driver.execute_script("arguments[0].click();", el)
        self._pause()

    def type(self, locator: tuple[str, str], text: str, clear: bool = True) -> None:
        el = self.find(locator)
        if clear:
            el.clear()
        el.send_keys(text)
        self._pause()

    def select_by_visible_text(self, locator: tuple[str, str], text: str) -> None:
        Select(self.find(locator)).select_by_visible_text(text)
        self._pause()

    def select_by_value(self, locator: tuple[str, str], value: str) -> None:
        Select(self.find(locator)).select_by_value(value)
        self._pause()

    def _pause(self) -> None:
        if SLOWMO:
            time.sleep(SLOWMO)

    # ------------------------------------------------------------- overlays

    OVERLAY = "//div[contains(@class,'fixed') and contains(@class,'inset-0')]"

    def overlay_button(self, label: str, exact: bool = True) -> tuple[str, str]:
        """A button inside the open modal, never its twin in the row behind.

        Modal renders through a portal at the end of <body>, so an unscoped
        XPath matches the row's button first and silently re-opens the dialog
        instead of confirming it.
        """
        match = (
            f"normalize-space()={xq(label)}"
            if exact
            else f"contains(normalize-space(), {xq(label)})"
        )
        return (By.XPATH, f"{self.OVERLAY}//button[{match}]")

    # --------------------------------------------------------------- feedback

    TOAST = (By.CSS_SELECTOR, "[role='status']")

    def wait_for_toast(self, contains: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        """Toasts live ~4s (8s for errors), so read them promptly."""
        deadline = time.time() + timeout
        seen: list[str] = []
        while time.time() < deadline:
            for el in self.find_all(self.TOAST):
                try:
                    text = el.text
                except StaleElementReferenceException:
                    continue
                if text and text not in seen:
                    seen.append(text)
                if contains.lower() in text.lower():
                    return text
            time.sleep(0.15)
        raise AssertionError(f"no toast containing {contains!r}; toasts seen: {seen or 'none'}")

    def dismiss_toasts(self) -> None:
        """Click toasts away so they cannot intercept a later click."""
        for el in self.find_all(self.TOAST):
            try:
                el.click()
            except Exception:
                pass

    def field_error(self, field_name: str) -> str:
        """The inline validation message VField renders under one input.

        The message is preceded by a round "!" badge, which Selenium reports
        as its own line — strip it so tests compare against the copy alone.
        """
        locator = (
            By.XPATH,
            f"//label[.//*[@name={xq(field_name)}]]//span[contains(@class,'text-red-600')]",
        )
        lines = [ln.strip() for ln in self.find(locator).text.splitlines() if ln.strip()]
        return lines[-1] if lines else ""

    def has_field_error(self, field_name: str, timeout: int = 3) -> bool:
        locator = (
            By.XPATH,
            f"//label[.//*[@name={xq(field_name)}]]//span[contains(@class,'text-red-600')]",
        )
        return self.is_visible(locator, timeout)

    @property
    def banner_error(self) -> str:
        """The red box a page or modal shows for a server-side rejection."""
        return self.find((By.XPATH, "//p[contains(@class,'text-red-700')]")).text.strip()

    # ---------------------------------------------------------------- session

    def token(self) -> str | None:
        return self.driver.execute_script("return localStorage.getItem('devicedesk.token');")

    def clear_session(self) -> None:
        """Wipe the stored JWT so the next load starts signed out."""
        self.driver.execute_script("localStorage.clear(); sessionStorage.clear();")


def xq(value: str) -> str:
    """Quote a string for use inside an XPath expression, apostrophes and all.

    The app's copy is full of typographic quotes (Can't hand over), so a naive
    "'%s'" % value breaks on real button labels.
    """
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    parts = value.split("'")
    joined = ", \"'\", ".join(f"'{p}'" for p in parts)
    return f"concat({joined})"
