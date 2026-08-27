"""`/repairs` — the repair queue: reported → repair requested → in repair →
fixed / written off."""

from __future__ import annotations

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq

# The advance button relabels itself for the state the repair is in, which is
# the clearest signal a test has that the state machine really moved.
ADVANCE_LABELS = {
    "Reported": "Request repair →",
    "Repair requested": "Send to repair →",
    "In repair": "Mark fixed ✓",
}


class RepairsPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Repairs']")
    TAB_OPEN = (By.XPATH, "//button[starts-with(normalize-space(), 'Open (')]")
    TAB_CLOSED = (By.XPATH, "//button[starts-with(normalize-space(), 'Closed (')]")
    ROWS = (By.CSS_SELECTOR, "table tbody tr")

    def open_repairs(self) -> "RepairsPage":
        self.open("/repairs")
        self.find(self.HEADING)
        return self

    def row_for(self, text: str):
        return (By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]")

    def has_row(self, text: str, timeout: int = 10) -> bool:
        return self.is_visible(self.row_for(text), timeout)

    def state_of(self, text: str, timeout: int = 10) -> str:
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(text)})]/td[5]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator, timeout).text.strip()

    def wait_for_state(self, text: str, expected: str, timeout: int = 30) -> None:
        # Short per-attempt timeout, or the first miss eats the whole budget.
        import time

        deadline = time.time() + timeout
        seen = ""
        while time.time() < deadline:
            try:
                seen = self.state_of(text, timeout=2)
            except Exception:
                seen = "<no row>"
            if seen == expected:
                return
            time.sleep(0.25)
        raise AssertionError(f"repair for {text!r} sat at {seen!r}, expected {expected!r}")

    def issue_of(self, text: str) -> str:
        return self.find((By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]/td[2]")).text.strip()

    def reporter_of(self, text: str) -> str:
        return self.find((By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]/td[4]")).text.strip()

    def open_count(self) -> int:
        label = self.find(self.TAB_OPEN).text
        return int(label.split("(")[1].rstrip(")"))

    def show_open(self) -> "RepairsPage":
        self.click(self.TAB_OPEN)
        return self

    def show_closed(self) -> "RepairsPage":
        self.click(self.TAB_CLOSED)
        return self

    def _button(self, text: str, label: str):
        return (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(text)})]//button[normalize-space()={xq(label)}]",
        )

    def has_button(self, text: str, label: str, timeout: int = 4) -> bool:
        return self.is_visible(self._button(text, label), timeout)

    def advance(self, text: str) -> None:
        """Click whichever forward button this row currently offers."""
        label = ADVANCE_LABELS[self.state_of(text)]
        self.click(self._button(text, label))

    def cancel_report(self, text: str) -> "RepairConfirm":
        self.click(self._button(text, "Cancel report"))
        return RepairConfirm(self.driver, self.base_url).wait_open("Cancel report")

    def write_off(self, text: str) -> "WriteOffDialog":
        self.click(self._button(text, "Write off…"))
        return WriteOffDialog(self.driver, self.base_url).wait_open()

    def has_actions_column(self, timeout: int = 3) -> bool:
        return self.is_visible((By.XPATH, "//table/tbody/tr//button"), timeout)


class RepairConfirm(BasePage):
    """ConfirmModal wrapper.

    Scoped to the modal overlay on purpose: the row that opened the dialog
    carries a button with the very same label, and it comes first in document
    order, so an unscoped XPath would click the row again instead of
    confirming.
    """

    CONFIRM = (By.CSS_SELECTOR, "[data-testid='confirm-button']")
    CANCEL = (By.CSS_SELECTOR, "[data-testid='confirm-cancel']")
    TITLE = (By.XPATH, "//div[@data-testid='modal']//h2")

    def wait_open(self, confirm_label: str | None = None) -> "RepairConfirm":
        self.find(self.CONFIRM)
        return self

    @property
    def title(self) -> str:
        return self.find(self.TITLE).text.strip()

    def confirm(self) -> None:
        self.click(self.CONFIRM)

    def cancel(self) -> None:
        self.click(self.CANCEL)


class WriteOffDialog(BasePage):
    """Scrapping a device needs a written reason — it lands in the audit log."""

    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Write off ')]")
    REASON = (By.CSS_SELECTOR, "textarea[name='reason']")
    SUBMIT = (By.XPATH, "//button[contains(normalize-space(), 'Write off device')]")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "WriteOffDialog":
        self.find(self.HEADING)
        return self

    def with_reason(self, text: str) -> "WriteOffDialog":
        self.type(self.REASON, text)
        return self

    def submit(self) -> None:
        self.click(self.SUBMIT)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)
