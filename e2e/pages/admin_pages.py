"""Smaller staff screens: Settings, Audit log and the Idle devices report."""

from __future__ import annotations

import time

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq


class SettingsPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Settings']")
    MODE_ALL = (By.XPATH, "//label[contains(., 'Every request needs approval')]/input[@type='radio']")
    MODE_BUSY_ONLY = (By.XPATH, "//label[contains(., 'Free devices auto-approve')]/input[@type='radio']")
    ADMIN_ONLY_NOTE = (By.XPATH, "//p[contains(., 'Only an Admin can change this')]")
    NOTIFICATIONS_HEADING = (By.XPATH, "//h2[normalize-space()='Notifications']")
    OUTBOX_HEADING = (By.XPATH, "//h2[normalize-space()='Email outbox']")
    OUTBOX_ROWS = (By.XPATH, "//h2[normalize-space()='Email outbox']/following::table[1]/tbody/tr")

    def open_settings(self) -> "SettingsPage":
        self.open("/settings")
        self.find(self.HEADING)
        return self

    def approval_mode(self, timeout: int = 10) -> str:
        if self.find(self.MODE_ALL, timeout).is_selected():
            return "all"
        if self.find(self.MODE_BUSY_ONLY, timeout).is_selected():
            return "busy_only"
        return "unset"

    def wait_for_mode(self, expected: str, timeout: int = 15) -> None:
        deadline = time.time() + timeout
        seen = ""
        while time.time() < deadline:
            seen = self.approval_mode(timeout=2)
            if seen == expected:
                return
            time.sleep(0.2)
        raise AssertionError(f"approval mode stayed {seen!r}, expected {expected!r}")

    def choose_mode(self, mode: str) -> "SettingsPage":
        self._click_element(self.find(self.MODE_ALL if mode == "all" else self.MODE_BUSY_ONLY))
        return self

    def mode_inputs_enabled(self) -> bool:
        return self.find(self.MODE_ALL).is_enabled()

    # --- notification matrix -------------------------------------------

    # Columns: 1 Event | 2 Who gets it | 3 In-app | 4 Email. Both tables on
    # this page are plain <table>s, so rule lookups are anchored to the
    # Notifications heading to keep the outbox out of the match.
    RULES_TABLE = "//h2[normalize-space()='Notifications']/following::table[1]"

    def rule_checkbox(self, event_label: str, channel: str):
        """`channel` is 'inapp' or 'email'."""
        column = 3 if channel == "inapp" else 4
        return (
            By.XPATH,
            f"{self.RULES_TABLE}/tbody/tr[contains(., {xq(event_label)})]"
            f"/td[{column}]//input[@type='checkbox']",
        )

    def rule_is_on(self, event_label: str, channel: str) -> bool:
        return self.find(self.rule_checkbox(event_label, channel)).is_selected()

    def toggle_rule(self, event_label: str, channel: str) -> None:
        self._click_element(self.find(self.rule_checkbox(event_label, channel)))

    def rule_labels(self) -> list[str]:
        return [
            td.text.strip()
            for td in self.find_all((By.XPATH, f"{self.RULES_TABLE}/tbody/tr/td[1]"))
        ]

    def rule_audience(self, event_label: str) -> str:
        return self.find(
            (By.XPATH, f"{self.RULES_TABLE}/tbody/tr[contains(., {xq(event_label)})]/td[2]")
        ).text.strip()

    def outbox_summary(self) -> str:
        return self.find(
            (By.XPATH, "//h2[normalize-space()='Email outbox']/following-sibling::p[1]")
        ).text.strip()


class AuditPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Audit log']")
    ENTITY_FILTER = (By.XPATH, "//select[option[normalize-space()='All entities']]")
    ACTOR_FILTER = (By.CSS_SELECTOR, "input[type='search'][placeholder='Who…']")
    CLEAR_FILTERS = (By.XPATH, "//button[normalize-space()='Clear filters']")
    # Relabelled when F-01 was fixed: the export is now server-side and covers
    # every matching row, not just the loaded page.
    EXPORT_CSV = (By.XPATH, "//button[starts-with(normalize-space(), 'Export CSV')]")
    LOAD_OLDER = (By.XPATH, "//button[contains(normalize-space(), 'Load older entries')]")
    ROWS = (By.CSS_SELECTOR, "table tbody tr")
    NO_MATCH = (By.XPATH, "//p[contains(., 'Nothing matches these filters')]")

    def open_audit(self) -> "AuditPage":
        self.open("/audit")
        self.find(self.HEADING)
        return self

    def row_count(self) -> int:
        return len(self.find_all(self.ROWS))

    def entities(self) -> list[str]:
        return [td.text.strip() for td in self.find_all((By.XPATH, "//table/tbody/tr/td[3]"))]

    def actors(self) -> list[str]:
        return [td.text.strip() for td in self.find_all((By.XPATH, "//table/tbody/tr/td[2]"))]

    def filter_entity(self, label: str) -> "AuditPage":
        self.select_by_visible_text(self.ENTITY_FILTER, label)
        time.sleep(0.5)
        return self

    def filter_actor(self, text: str) -> "AuditPage":
        """Type the actor filter one character at a time.

        The box is a controlled input whose value comes back from the URL,
        and the URL is written per keystroke. Sending the whole string at
        machine speed loses every character but the last, because each
        re-render resets the input to the value the URL had already committed.
        Real typing is slow enough not to hit it; the suite has to be too.
        """
        el = self.find(self.ACTOR_FILTER)
        el.clear()
        for ch in text:
            el.send_keys(ch)
            time.sleep(0.12)
        time.sleep(0.8)
        return self

    def wait_for_entry(self, *fragments: str, timeout: int = 20) -> str:
        """Wait until one row mentions every fragment — the log is append-only
        and a write may land a moment after the UI action."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            for row in self.find_all(self.ROWS):
                try:
                    text = row.text
                except Exception:
                    continue
                if all(f.lower() in text.lower() for f in fragments):
                    return text
            self.driver.refresh()
            self.find(self.HEADING)
            time.sleep(0.5)
        raise AssertionError(f"no audit entry mentioning {fragments}")


class ReportsPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Idle devices']")
    DAYS = (By.XPATH, "//select[option[normalize-space()='90 days']]")
    ROWS = (By.CSS_SELECTOR, "table tbody tr")
    EMPTY = (By.XPATH, "//p[contains(., 'Nothing idle')]")

    def open_reports(self) -> "ReportsPage":
        self.open("/reports")
        self.find(self.HEADING)
        return self

    def choose_days(self, label: str) -> "ReportsPage":
        self.select_by_visible_text(self.DAYS, label)
        time.sleep(0.6)
        return self

    def selected_days(self) -> str:
        from selenium.webdriver.support.ui import Select

        return Select(self.find(self.DAYS)).first_selected_option.text.strip()

    def row_count(self) -> int:
        return len(self.find_all(self.ROWS))

    def row_for(self, text: str):
        return (By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]")

    def has_row(self, text: str, timeout: int = 10) -> bool:
        return self.is_visible(self.row_for(text), timeout)

    def last_activity_of(self, text: str) -> str:
        return self.find((By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]/td[3]")).text.strip()
