"""The signed-in chrome: sidebar navigation, global search, user menu.

Everything a signed-in test does starts here, so this is also where the
2-second brand splash is absorbed.
"""

from __future__ import annotations

import time

from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By

from .base_page import BasePage, xq

# Sidebar entries, in the order Layout.tsx renders them, with the heading each
# destination is expected to show. "Idle devices" is the label; the page's own
# heading differs, which is exactly the kind of mismatch a nav test should pin.
NAV_LAB = ["Dashboard", "Devices", "Requests", "Repairs"]
NAV_STAFF = ["Projects", "Users", "Idle devices", "Settings", "Audit log"]


class AppShell(BasePage):
    SIDEBAR = (By.CSS_SELECTOR, "aside")
    NAV = (By.CSS_SELECTOR, "aside nav")
    GLOBAL_SEARCH = (By.CSS_SELECTOR, "header input[type='search']")
    USER_MENU_BUTTON = (By.XPATH, "(//header/div[contains(@class,'relative')])[last()]/button")
    SIGN_OUT = (By.XPATH, "//button[normalize-space()='Sign out']")
    CHANGE_PASSWORD_ITEM = (By.XPATH, "//button[contains(., 'Change password')]")
    PAGE_HEADING = (By.CSS_SELECTOR, "main h1")

    def wait_loaded(self) -> "AppShell":
        """Wait past the brand splash until the shell is really interactive."""
        self.find((By.XPATH, "//nav//a[normalize-space()='Dashboard']"))
        return self

    # ------------------------------------------------------------ navigation

    def nav_link(self, label: str):
        """Sidebar link by label.

        Requests and Repairs grow a count badge inside the anchor, so its text
        becomes "Requests 3" — an exact match would stop finding them the
        moment the lab has work waiting.
        """
        # The badge is a <span> with no whitespace before it, so the anchor's
        # normalize-space() reads "Requests3". Matching the first text node
        # instead keeps the locator stable whether or not a badge is showing.
        return (By.XPATH, f"//aside//nav//a[normalize-space(text())={xq(label)}]")

    def go_to(self, label: str) -> "AppShell":
        self.click(self.nav_link(label))
        return self

    def has_nav_link(self, label: str, timeout: int = 3) -> bool:
        return self.is_visible(self.nav_link(label), timeout)

    def visible_nav_labels(self) -> list[str]:
        """Sidebar labels without their count badges.

        Reading .text would return "Requests3" once the badge appears, so the
        label is taken from the anchor's own first text node.
        """
        return self.driver.execute_script(
            "return Array.from(document.querySelectorAll('aside nav a'))"
            ".map(a => (a.firstChild && a.firstChild.textContent || a.textContent).trim());"
        )

    @property
    def heading(self) -> str:
        """The <h1> of the routed page, retried past the swap between routes."""
        for _ in range(5):
            try:
                text = self.find(self.PAGE_HEADING).text.strip()
                if text:
                    return text
            except StaleElementReferenceException:
                pass
            time.sleep(0.2)
        return self.find(self.PAGE_HEADING).text.strip()

    def wait_heading(self, prefix: str, timeout: int = 15) -> str:
        """Poll until the routed page's own heading has replaced the previous
        one. Route changes swap the <h1> a tick after the URL changes, so
        reading it eagerly can catch the page you just left."""
        deadline = time.time() + timeout
        seen = ""
        while time.time() < deadline:
            seen = self.heading
            if seen.startswith(prefix):
                return seen
            time.sleep(0.2)
        raise AssertionError(f"expected a heading starting with {prefix!r}, saw {seen!r}")

    @property
    def document_title(self) -> str:
        return self.driver.title

    def nav_badge(self, label: str) -> str | None:
        """The unread-style count pill next to Requests / Repairs, if any."""
        locator = (
            By.XPATH,
            f"//aside//nav//a[contains(normalize-space(), {xq(label)})]/span[contains(@class,'rounded-full')]",
        )
        els = self.find_all(locator)
        return els[0].text.strip() if els else None

    # ---------------------------------------------------------- global search

    def search_globally(self, text: str) -> "AppShell":
        el = self.find(self.GLOBAL_SEARCH)
        el.clear()
        el.send_keys(text)
        el.submit()
        return self

    # -------------------------------------------------------------- user menu

    def open_user_menu(self) -> "AppShell":
        self.click(self.USER_MENU_BUTTON)
        self.find(self.SIGN_OUT)
        return self

    def signed_in_name(self) -> str:
        return self.find(self.USER_MENU_BUTTON).text.split("\n")[1].strip()

    def signed_in_role(self) -> str:
        return self.find(self.USER_MENU_BUTTON).text.split("\n")[-1].strip()

    def sign_out(self) -> None:
        self.open_user_menu()
        self.click(self.SIGN_OUT)

    def open_change_password(self) -> None:
        self.open_user_menu()
        self.click(self.CHANGE_PASSWORD_ITEM)


class Dashboard(BasePage):
    """The landing page: four counters, my open requests, devices I hold."""

    HEADING = (By.XPATH, "//main//h1[starts-with(normalize-space(), 'Hi,')]")
    MY_REQUESTS = (By.XPATH, "//h2[normalize-space()='My requests']")
    DEVICES_I_HOLD = (By.XPATH, "//h2[normalize-space()='Devices I hold']")
    NOTHING_CHECKED_OUT = (By.XPATH, "//p[normalize-space()='Nothing checked out.']")
    # F-07 is fixed: RequestTable now renders a single branch chosen by a
    # media query, so there is exactly one copy of the empty text to find.
    NO_OPEN_REQUESTS = (By.XPATH, "//p[contains(., 'No open requests')]")
    OVERDUE_BANNER = (By.XPATH, "//b[contains(., 'overdue')]")

    def open_dashboard(self) -> "Dashboard":
        self.open("/")
        self.find(self.HEADING)
        return self

    def stat(self, label: str, timeout: int = 10) -> int:
        """The number above one of the counter tiles."""
        locator = (
            By.XPATH,
            f"//div[normalize-space()={xq(label)}]/preceding-sibling::div[1]",
        )
        raw = self.find(locator, timeout).text.strip()
        if raw in {"…", ""}:
            raise AssertionError(f"the {label!r} tile is still loading")
        return int(raw)

    def wait_for_stat(self, label: str, expected: int, timeout: int = 20) -> None:
        deadline = time.time() + timeout
        seen: object = "?"
        while time.time() < deadline:
            try:
                seen = self.stat(label, timeout=2)
            except AssertionError:
                seen = "…"
            if seen == expected:
                return
            time.sleep(0.25)
        raise AssertionError(f"{label!r} showed {seen}, expected {expected}")

    def stat_labels(self) -> list[str]:
        return [
            d.text.strip()
            for d in self.find_all((By.XPATH, "//div[contains(@class,'text-neutral-500')]"))
            if d.text.strip()
        ]

    def held_device_names(self) -> list[str]:
        return [
            a.text.split("\n")[0].strip()
            for a in self.find_all(
                (By.XPATH, "//h2[normalize-space()='Devices I hold']/following::a[contains(@href,'/devices/')]")
            )
        ]

    def open_stat(self, label: str) -> None:
        """The counters double as links into the page behind them."""
        locator = (
            By.XPATH,
            f"//a[.//div[normalize-space()={xq(label)}]]",
        )
        self.click(locator)


class ThemeToggle(BasePage):
    """The eclipse switch in the header, remembered per browser."""

    SWITCH = (By.CSS_SELECTOR, "button[role='switch']")

    def theme(self) -> str:
        return self.driver.execute_script("return document.documentElement.dataset.theme;")

    def stored_theme(self) -> str | None:
        return self.driver.execute_script("return localStorage.getItem('devicedesk.theme');")

    def is_dark(self) -> bool:
        return self.find(self.SWITCH).get_attribute("aria-checked") == "true"

    def label(self) -> str:
        return self.find(self.SWITCH).get_attribute("aria-label")

    def flip(self) -> None:
        self.click(self.SWITCH)


class NotificationBell(BasePage):
    BUTTON = (By.CSS_SELECTOR, "button[aria-label='Notifications']")
    PANEL = (By.XPATH, "//b[normalize-space()='Notifications']/ancestor::div[1]")
    UNREAD_BADGE = (By.XPATH, "//button[@aria-label='Notifications']/span")
    MARK_ALL_READ = (By.XPATH, "//button[normalize-space()='Mark all as read']")
    EMPTY = (By.XPATH, "//p[contains(., 'No notifications yet')]")
    ITEMS = (By.XPATH, "//b[normalize-space()='Notifications']/ancestor::div[2]//button[contains(@class,'border-b') or contains(@class,'last:border-0')]")

    def unread_count(self) -> int:
        els = self.find_all(self.UNREAD_BADGE)
        return int(els[0].text.strip()) if els and els[0].text.strip() else 0

    def open_panel(self) -> "NotificationBell":
        self.click(self.BUTTON)
        self.find((By.XPATH, "//b[normalize-space()='Notifications']"))
        return self

    def texts(self) -> list[str]:
        return [
            el.text.strip()
            for el in self.find_all(
                (By.XPATH, "//b[normalize-space()='Notifications']/../following-sibling::div//button")
            )
        ]

    def mark_all_read(self) -> None:
        self.click(self.MARK_ALL_READ)
