"""`/devices` — the searchable inventory table, the Add device dialog and the
Request dialog that starts a loan."""

from __future__ import annotations

import time

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq


class DevicesPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Devices']")
    COUNT = (By.XPATH, "//h1[normalize-space()='Devices']/following-sibling::span[1]")
    SEARCH = (By.CSS_SELECTOR, "input[type='search'][placeholder^='Search brand']")
    BRAND_FILTER = (By.XPATH, "//select[option[normalize-space()='All brands']]")
    OS_FILTER = (By.XPATH, "//select[option[normalize-space()='All OS']]")
    STATUS_FILTER = (By.XPATH, "//select[option[normalize-space()='Any status']]")
    ADD_BUTTON = (By.XPATH, "//button[normalize-space()='Add device']")
    IMPORT_BUTTON = (By.XPATH, "//button[normalize-space()='Import Excel']")
    ROWS = (By.CSS_SELECTOR, "table tbody tr")
    EMPTY_MESSAGE = (By.XPATH, "//p[contains(., 'No devices match')]")
    LOADING = (By.XPATH, "//p[normalize-space()='loading…']")

    def open_devices(self) -> "DevicesPage":
        self.open("/devices")
        self.find(self.HEADING)
        return self

    # ------------------------------------------------------------------ table

    def row_for(self, text: str):
        """A device row located by any text it contains — serial or model."""
        return (By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]")

    def has_row(self, text: str, timeout: int = 10) -> bool:
        return self.is_visible(self.row_for(text), timeout)

    def row_count(self) -> int:
        return len(self.find_all(self.ROWS))

    def wait_for_row_count(self, expected: int, timeout: int = 15) -> None:
        deadline = time.time() + timeout
        last = -1
        while time.time() < deadline:
            last = self.row_count()
            if last == expected:
                return
            time.sleep(0.2)
        raise AssertionError(f"expected {expected} device rows, saw {last}")

    def cell_status(self, row_text: str) -> str:
        """The status chip's label for one row (Available / Assigned / …)."""
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]/td[3]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator).text.strip()

    def cell_holder(self, row_text: str) -> str:
        locator = (By.XPATH, f"//table/tbody/tr[contains(., {xq(row_text)})]/td[4]")
        return self.find(locator).text.strip()

    def open_device(self, row_text: str) -> None:
        self.click(self.row_for(row_text))

    def search(self, text: str) -> "DevicesPage":
        """Type a search term and make sure all of it landed.

        The box is state mirrored into the URL by one effect and read back out
        of the URL by another (Devices.tsx:27 and :39). A URL update that lands
        mid-typing resets the input to the value the URL already held, dropping
        the characters typed since — F-13, the same defect F-02 fixed on the
        audit page. Verifying and retyping keeps the suite off that race.
        """
        for attempt in range(4):
            el = self.find(self.SEARCH)
            el.clear()
            el.send_keys(text)
            time.sleep(0.35)
            if self.find(self.SEARCH).get_attribute("value") == text:
                break
            time.sleep(0.3)  # let the URL/state ping-pong settle, then retry
        # The box debounces at 250ms before it refetches.
        time.sleep(0.6)
        return self

    def filter_status(self, label: str) -> "DevicesPage":
        self.select_by_visible_text(self.STATUS_FILTER, label)
        return self

    def filter_brand(self, label: str) -> "DevicesPage":
        self.select_by_visible_text(self.BRAND_FILTER, label)
        return self

    # ------------------------------------------------------------- add device

    def open_add_device(self) -> "AddDeviceDialog":
        self.click(self.ADD_BUTTON)
        return AddDeviceDialog(self.driver, self.base_url).wait_open()

    def open_request_for(self, row_text: str) -> "RequestDialog":
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]//button[normalize-space()='Request']",
        )
        self.click(locator)
        return RequestDialog(self.driver, self.base_url).wait_open()

    def has_request_button(self, row_text: str, timeout: int = 5) -> bool:
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]//button[normalize-space()='Request']",
        )
        return self.is_visible(locator, timeout)


class AddDeviceDialog(BasePage):
    HEADING = (By.XPATH, "//h2[normalize-space()='Add device']")
    BRAND = (By.CSS_SELECTOR, "input[name='brand']")
    MODEL = (By.CSS_SELECTOR, "input[name='model']")
    OS = (By.CSS_SELECTOR, "input[name='os']")
    OS_VERSION = (By.CSS_SELECTOR, "input[name='osVersion']")
    SERIAL = (By.CSS_SELECTOR, "input[name='serial']")
    IMEI = (By.CSS_SELECTOR, "input[name='imei']")
    ACCESSORIES = (By.CSS_SELECTOR, "input[name='accessories']")
    PROJECT = (By.CSS_SELECTOR, "select[name='projectId']")
    SPEC_KEY = (By.CSS_SELECTOR, "input[name='spec_k_0']")
    SPEC_VALUE = (By.CSS_SELECTOR, "input[name='spec_v_0']")
    CREATE = (By.XPATH, "//button[normalize-space()='Create']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "AddDeviceDialog":
        self.find(self.HEADING)
        return self

    def fill(
        self,
        brand: str,
        model: str,
        os_name: str,
        serial: str,
        os_version: str = "",
        imei: str = "",
        accessories: str = "",
        project: str | None = None,
        spec: tuple[str, str] | None = None,
    ) -> "AddDeviceDialog":
        self.type(self.BRAND, brand)
        self.type(self.MODEL, model)
        self.type(self.OS, os_name)
        if os_version:
            self.type(self.OS_VERSION, os_version)
        self.type(self.SERIAL, serial)
        if imei:
            self.type(self.IMEI, imei)
        if accessories:
            self.type(self.ACCESSORIES, accessories)
        if spec:
            self.type(self.SPEC_KEY, spec[0])
            self.type(self.SPEC_VALUE, spec[1])
        if project:
            self.select_by_visible_text(self.PROJECT, project)
        return self

    def create(self) -> None:
        self.click(self.CREATE)

    def cancel(self) -> None:
        self.click(self.CANCEL)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)


class RequestDialog(BasePage):
    """The loan request dialog: project, reason and a calendar range."""

    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Request ')]")
    PROJECT = (By.CSS_SELECTOR, "select[name='projectId']")
    REASON = (By.CSS_SELECTOR, "textarea[name='reason']")
    ON_BEHALF_OF = (By.CSS_SELECTOR, "select[name='onBehalfOfId']")
    SUBMIT = (By.XPATH, "//button[normalize-space()='Submit request']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")
    CALENDAR = (By.XPATH, "//div[contains(@class,'grid-cols-7')]")
    SELECTABLE_DAYS = (
        By.XPATH,
        "//div[contains(@class,'grid-cols-7')]/button[not(@disabled)]",
    )
    SELECTION_SUMMARY = (By.XPATH, "//p[contains(., 'Selected:') or contains(., 'Pick a start date')]")
    CALENDAR_LOADING = (By.XPATH, "//p[normalize-space()='loading calendar…']")

    def wait_open(self) -> "RequestDialog":
        self.find(self.HEADING)
        # The calendar refuses to render until availability is known — a
        # range picked before then could land on a booked day.
        self.wait(20).until(lambda d: not self.is_present(self.CALENDAR_LOADING, timeout=1))
        self.find(self.CALENDAR)
        return self

    def choose_project(self, name: str) -> "RequestDialog":
        self.select_by_visible_text(self.PROJECT, name)
        return self

    def enter_reason(self, text: str) -> "RequestDialog":
        self.type(self.REASON, text)
        return self

    def pick_first_free_range(self, span_days: int = 1) -> tuple[str, str]:
        """Click the first selectable day, then one `span_days` later.

        Past days and booked days render disabled, so 'first selectable' is
        the earliest day the app itself considers bookable.
        """
        days = self.find_all(self.SELECTABLE_DAYS)
        assert len(days) > span_days, "calendar offered no free range to pick"
        start = days[0]
        end = days[span_days]
        start_label, end_label = start.text, end.text
        self._click_element(start)
        # Re-query: React re-renders every cell after the first pick.
        days = self.find_all(self.SELECTABLE_DAYS)
        self._click_element(days[span_days])
        self.find(self.SELECTION_SUMMARY)
        return start_label, end_label

    def submit_enabled(self) -> bool:
        return self.find(self.SUBMIT).is_enabled()

    def submit(self) -> None:
        self.click(self.SUBMIT)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)
