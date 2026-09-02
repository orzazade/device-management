"""`/requests` — the whole loan lifecycle on one page.

The page stacks several sections that share one RequestTable component, so
row lookups are scoped to a section heading wherever the same device could
legitimately appear twice (pending vs. out now).

RequestTable renders each row twice: mobile cards (`md:hidden`) and a table
(`max-md:hidden`). At the 1440px window these tests use, only the table is
visible, so every locator here is anchored to `//table` to avoid matching the
hidden cards.
"""

from __future__ import annotations

import time

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq

SECTION_PENDING = "Waiting for approval"
# Only shown under the 'holder' approval policy: requests this user must
# decide because they are holding the device.
SECTION_MINE = "Your decision"
SECTION_HANDOVER = "Hand these over"
SECTION_OUT_NOW = "Out now"
SECTION_OVERDUE = "Overdue — chase these"


class RequestsPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Requests']")
    FIND_DEVICE = (By.XPATH, "//a[normalize-space()='Find a device']")
    TAB_OPEN = (By.XPATH, "//button[normalize-space()='Open']")
    TAB_ALL = (By.XPATH, "//button[normalize-space()='All']")
    MY_REQUESTS_HEADING = (By.XPATH, "//h2[normalize-space()='My requests' or normalize-space()='All requests']")

    def open_requests(self) -> "RequestsPage":
        self.open("/requests")
        self.find(self.HEADING)
        return self

    # ------------------------------------------------------------- lookups

    def has_section(self, title: str, timeout: int = 8) -> bool:
        return self.is_visible((By.XPATH, f"//h2[contains(normalize-space(), {xq(title)})]"), timeout)

    def _section_row(self, section: str, device_text: str) -> tuple[str, str]:
        """A row inside one named section, matched by device text."""
        return (
            By.XPATH,
            f"//h2[contains(normalize-space(), {xq(section)})]"
            f"/following::table[1]/tbody/tr[contains(., {xq(device_text)})]",
        )

    def has_row_in(self, section: str, device_text: str, timeout: int = 10) -> bool:
        return self.is_visible(self._section_row(section, device_text), timeout)

    def any_row(self, device_text: str):
        return (By.XPATH, f"//table/tbody/tr[contains(., {xq(device_text)})]")

    def has_row(self, device_text: str, timeout: int = 10) -> bool:
        return self.is_visible(self.any_row(device_text), timeout)

    def state_of(self, device_text: str) -> str:
        """The state chip of the first visible row for a device."""
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(device_text)})]/td[5]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator).text.strip()

    def state_in(self, section: str, device_text: str) -> str:
        locator = (
            By.XPATH,
            f"//h2[contains(normalize-space(), {xq(section)})]"
            f"/following::table[1]/tbody/tr[contains(., {xq(device_text)})]"
            f"/td[5]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator).text.strip()

    def requester_of(self, device_text: str) -> str:
        locator = (By.XPATH, f"//table/tbody/tr[contains(., {xq(device_text)})]/td[2]")
        return self.find(locator).text.strip()

    # ------------------------------------------------------------- actions

    def _action(self, section: str, device_text: str, label: str) -> tuple[str, str]:
        return (
            By.XPATH,
            f"//h2[contains(normalize-space(), {xq(section)})]"
            f"/following::table[1]/tbody/tr[contains(., {xq(device_text)})]"
            f"//button[normalize-space()={xq(label)}]",
        )

    def approve(self, device_text: str) -> None:
        self.click(self._action(SECTION_PENDING, device_text, "Approve"))

    def reject(self, device_text: str) -> "RejectDialog":
        self.click(self._action(SECTION_PENDING, device_text, "Reject"))
        return RejectDialog(self.driver, self.base_url).wait_open()

    # --- decisions that belong to the holder, not the desk ----------------

    def approve_as_holder(self, device_text: str) -> None:
        self.click(self._action(SECTION_MINE, device_text, "Approve"))

    def reject_as_holder(self, device_text: str) -> "RejectDialog":
        self.click(self._action(SECTION_MINE, device_text, "Reject"))
        return RejectDialog(self.driver, self.base_url).wait_open()

    def confirm_handover(self, device_text: str) -> None:
        self.click(self._action(SECTION_HANDOVER, device_text, "Confirm handover"))

    def check_in(self, device_text: str, section: str = SECTION_OUT_NOW) -> "ReturnDialog":
        self.click(self._action(section, device_text, "Check in"))
        return ReturnDialog(self.driver, self.base_url).wait_open()

    def has_action(self, section: str, device_text: str, label: str, timeout: int = 5) -> bool:
        return self.is_visible(self._action(section, device_text, label), timeout)

    def show_all(self) -> "RequestsPage":
        """Switch the personal list from Open to All — closed requests
        (rejected, cancelled, returned) only live under All."""
        self.click(self.TAB_ALL)
        return self

    def show_open(self) -> "RequestsPage":
        self.click(self.TAB_OPEN)
        return self

    # ------------------------------------------- actions on your own rows

    def _own_action(self, device_text: str, label: str) -> tuple[str, str]:
        """Personal actions live in the bottom list, below the desk sections."""
        return (
            By.XPATH,
            f"//h2[normalize-space()='My requests' or normalize-space()='All requests']"
            f"/following::table[1]/tbody/tr[contains(., {xq(device_text)})]"
            f"//button[normalize-space()={xq(label)}]",
        )

    def _own_row(self, device_text: str) -> tuple[str, str]:
        return (
            By.XPATH,
            f"//h2[normalize-space()='My requests' or normalize-space()='All requests']"
            f"/following::table[1]/tbody/tr[contains(., {xq(device_text)})]",
        )

    def _click_own_action(self, device_text: str, label: str, timeout: int = 20) -> None:
        """Click a personal action, saying plainly which half went missing.

        "Button never became clickable" is ambiguous: the personal list may
        still be loading, the row may be absent, or the row may be there in a
        state that offers no such button. Waiting for the row first turns one
        vague timeout into a message that names the actual cause.
        """
        if not self.is_visible(self._own_row(device_text), timeout):
            raise AssertionError(
                f"no row for {device_text!r} under My requests — the personal "
                f"list is empty, still loading, or filtered to the wrong tab"
            )
        if not self.is_visible(self._own_action(device_text, label), 5):
            state = "unknown"
            try:
                state = self.own_state_of(device_text, timeout=2)
            except Exception:
                pass
            raise AssertionError(
                f"the row for {device_text!r} is there (state {state!r}) but "
                f"offers no {label!r} button"
            )
        self.click(self._own_action(device_text, label))

    def has_own_action(self, device_text: str, label: str, timeout: int = 5) -> bool:
        return self.is_visible(self._own_action(device_text, label), timeout)

    def cancel_pending(self, device_text: str) -> None:
        """A pending request is dropped outright — no confirmation."""
        self._click_own_action(device_text, "Cancel")

    def cancel_booking(self, device_text: str) -> "BookingCancelConfirm":
        """An approved booking asks first: releasing it cannot be undone."""
        self._click_own_action(device_text, "Cancel booking")
        return BookingCancelConfirm(self.driver, self.base_url).wait_open()

    def extend(self, device_text: str) -> "ExtendDialog":
        self._click_own_action(device_text, "Extend")
        return ExtendDialog(self.driver, self.base_url).wait_open()

    def offer_return(self, device_text: str) -> "ReturnIntentConfirm":
        """A tester cannot check a device in — they notify the desk instead."""
        self._click_own_action(device_text, "Return")
        return ReturnIntentConfirm(self.driver, self.base_url).wait_open()

    def own_state_of(self, device_text: str, timeout: int = 10) -> str:
        locator = (
            By.XPATH,
            f"//h2[normalize-space()='My requests' or normalize-space()='All requests']"
            f"/following::table[1]/tbody/tr[contains(., {xq(device_text)})]"
            f"/td[5]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator, timeout).text.strip()

    def own_rows(self) -> list[str]:
        """Every row of the personal list, for diagnostics on a miss."""
        return [
            r.text.replace("\n", " | ")
            for r in self.find_all(
                (
                    By.XPATH,
                    "//h2[normalize-space()='My requests' or normalize-space()='All requests']"
                    "/following::table[1]/tbody/tr",
                )
            )
        ]

    def wait_for_own_state(self, device_text: str, expected: str, timeout: int = 40) -> None:
        """Poll the row's state chip until it reads `expected`.

        Each attempt uses a short lookup timeout on purpose: with the default
        20s, the first miss would swallow the whole budget and the loop would
        never get a second look.
        """
        deadline = time.time() + timeout
        seen = ""
        while time.time() < deadline:
            try:
                seen = self.own_state_of(device_text, timeout=2)
            except Exception:
                seen = "<no row>"
            if seen == expected:
                return
            time.sleep(0.25)
        rows = self.own_rows()
        raise AssertionError(
            f"{device_text} sat at state {seen!r}, expected {expected!r}. "
            f"Personal list held {len(rows)} rows: {rows[:6]}"
        )

    # ------------------------------------------------------- desk overrides

    def override_time(self, device_text: str) -> "TimeOverrideDialog":
        self.click(self._action(SECTION_PENDING, device_text, "Time…"))
        return TimeOverrideDialog(self.driver, self.base_url).wait_open()

    def cant_hand_over(self, device_text: str) -> "CantHandOverDialog":
        self.click(self._action(SECTION_HANDOVER, device_text, "Can\u2019t hand over"))
        return CantHandOverDialog(self.driver, self.base_url).wait_open()


class RejectDialog(BasePage):
    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Reject ')]")
    NOTE = (By.CSS_SELECTOR, "textarea[name='note']")
    SUBMIT = (By.XPATH, "//button[contains(normalize-space(), 'Reject request')]")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "RejectDialog":
        self.find(self.HEADING)
        return self

    def with_note(self, text: str) -> "RejectDialog":
        self.type(self.NOTE, text)
        return self

    def submit(self) -> None:
        self.click(self.SUBMIT)


class ReturnDialog(BasePage):
    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Return ')]")
    DAMAGED = (By.XPATH, "//label[contains(., 'Device has new damage')]/input[@type='checkbox']")
    DAMAGE_NOTE = (By.CSS_SELECTOR, "textarea[name='damageNote']")
    SUBMIT = (By.XPATH, "//button[normalize-space()='Accept return']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "ReturnDialog":
        self.find(self.HEADING)
        return self

    def accessory_checkbox(self, name: str) -> tuple[str, str]:
        return (By.XPATH, f"//label[contains(., {xq(name)})]/input[@type='checkbox']")

    def uncheck_accessory(self, name: str) -> "ReturnDialog":
        el = self.find(self.accessory_checkbox(name))
        if el.is_selected():
            self._click_element(el)
        return self

    def mark_damaged(self, note: str) -> "ReturnDialog":
        self._click_element(self.find(self.DAMAGED))
        self.type(self.DAMAGE_NOTE, note)
        return self

    def submit(self) -> None:
        self.click(self.SUBMIT)


class ExtendDialog(BasePage):
    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Extend ')]")
    UNTIL = (By.CSS_SELECTOR, "input[name='toDate']")
    SUBMIT = (By.XPATH, "//button[contains(normalize-space(), 'Extend loan')]")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "ExtendDialog":
        self.find(self.HEADING)
        return self

    def current_due_date(self) -> str:
        return self.find(self.UNTIL).get_attribute("value")

    def keep_until(self, iso_date: str) -> "ExtendDialog":
        # A native date input wants the browser's own format; setting the
        # value property and firing the React change event is the reliable way.
        el = self.find(self.UNTIL)
        self.driver.execute_script(
            "const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;"
            "s.call(arguments[0], arguments[1]);"
            "arguments[0].dispatchEvent(new Event('input',{bubbles:true}));"
            "arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",
            el,
            iso_date,
        )
        return self

    def submit(self) -> None:
        self.click(self.SUBMIT)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)


class TimeOverrideDialog(BasePage):
    """Staff may move a request's dates before approving it."""

    HEADING = (By.XPATH, "//h2[normalize-space()='Override time range']")
    SELECTABLE_DAYS = (By.XPATH, "//div[contains(@class,'grid-cols-7')]/button[not(@disabled)]")
    SUBMIT = (By.XPATH, "//button[contains(normalize-space(), 'Save override')]")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "TimeOverrideDialog":
        self.find(self.HEADING)
        self.find(self.SELECTABLE_DAYS)
        return self

    def selected_summary(self) -> str:
        return self.find((By.XPATH, "//p[contains(., 'Selected:')]")).text.strip()

    def pick_range(self, span_days: int = 1) -> None:
        days = self.find_all(self.SELECTABLE_DAYS)
        self._click_element(days[0])
        days = self.find_all(self.SELECTABLE_DAYS)
        self._click_element(days[span_days])

    def submit(self) -> None:
        self.click(self.SUBMIT)


class CantHandOverDialog(BasePage):
    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Can')]")
    NOTE = (By.CSS_SELECTOR, "textarea[name='note']")
    SUBMIT = (By.XPATH, "//button[contains(normalize-space(), 'Yes, cancel this booking')]")
    BACK = (By.XPATH, "//button[normalize-space()='Back']")

    def wait_open(self) -> "CantHandOverDialog":
        self.find(self.NOTE)
        return self

    def with_note(self, text: str) -> "CantHandOverDialog":
        self.type(self.NOTE, text)
        return self

    def submit(self) -> None:
        self.click(self.SUBMIT)


class BookingCancelConfirm(BasePage):
    """The row behind this dialog also says "Cancel booking", so both buttons
    are looked up inside the modal overlay."""

    TITLE = (By.XPATH, "//div[@data-testid='modal']//h2")
    CONFIRM = (By.CSS_SELECTOR, "[data-testid='confirm-button']")
    CANCEL = (By.CSS_SELECTOR, "[data-testid='confirm-cancel']")

    def wait_open(self) -> "BookingCancelConfirm":
        self.find(self.CONFIRM)
        return self

    def confirm(self) -> None:
        self.click(self.CONFIRM)

    def dismiss(self) -> None:
        self.click(self.CANCEL)


class ReturnIntentConfirm(BasePage):
    TITLE = (By.XPATH, "//div[@data-testid='modal']//h2")
    CONFIRM = (By.CSS_SELECTOR, "[data-testid='confirm-button']")
    CANCEL = (By.CSS_SELECTOR, "[data-testid='confirm-cancel']")

    def wait_open(self) -> "ReturnIntentConfirm":
        self.find(self.CONFIRM)
        return self

    def confirm(self) -> None:
        self.click(self.CONFIRM)

    def dismiss(self) -> None:
        self.click(self.CANCEL)
