"""`/devices/:id` — one device: specs, history, repairs, edit and damage."""

from __future__ import annotations

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq


class DeviceDetailPage(BasePage):
    HEADING = (By.CSS_SELECTOR, "main h1")
    BACK = (By.XPATH, "//main//a[normalize-space()='←']")
    STATUS_CHIP = (By.XPATH, "//main//h1/following-sibling::span[contains(@class,'rounded-full')][1]")
    REQUEST_BUTTON = (By.XPATH, "//button[normalize-space()='Request this device']")
    # Renamed from "Report damage" in 9a4fb51 — the copy now says the desk
    # takes the device over, not just that damage was noted.
    REPORT_DAMAGE = (By.XPATH, "//button[starts-with(normalize-space(), 'Send to repair')]")
    EDIT = (By.XPATH, "//button[normalize-space()='Edit']")
    DAMAGE_BANNER = (By.XPATH, "//div[contains(., 'Known damage')]")
    AVAILABILITY = (By.XPATH, "//span[normalize-space()='Availability']/..")

    TAB_SPECS = (By.XPATH, "//button[normalize-space()='Specs']")
    TAB_HISTORY = (By.XPATH, "//button[normalize-space()='History']")
    TAB_REPAIRS = (By.XPATH, "//button[starts-with(normalize-space(), 'Repairs')]")

    def open_device(self, device_id: str) -> "DeviceDetailPage":
        self.open(f"/devices/{device_id}")
        self.find(self.HEADING)
        return self

    @property
    def heading(self) -> str:
        return self.find(self.HEADING).text.strip()

    @property
    def status(self) -> str:
        return self.find(self.STATUS_CHIP).text.strip()

    def spec_value(self, label: str) -> str:
        """Read one row out of the definition list on the Specs tab."""
        locator = (By.XPATH, f"//dt[normalize-space()={xq(label)}]/following-sibling::dd[1]")
        return self.find(locator).text.strip()

    def spec_chip(self, key: str, timeout: int = 5) -> bool:
        return self.is_visible(
            (By.XPATH, f"//span[contains(@class,'rounded-full')][contains(., {xq(key)})]"), timeout
        )

    def show_specs(self) -> "DeviceDetailPage":
        self.click(self.TAB_SPECS)
        return self

    def show_history(self) -> "DeviceDetailPage":
        self.click(self.TAB_HISTORY)
        # The tab fetches its rows on open; the empty state is a <p>, so wait
        # for one or the other rather than reading an empty table.
        self.wait(20).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, "table tbody tr")
            or d.find_elements(By.XPATH, "//p[contains(., 'No history yet')]")
        )
        return self

    def show_repairs(self) -> "DeviceDetailPage":
        self.click(self.TAB_REPAIRS)
        return self

    def repairs_tab_label(self) -> str:
        return self.find(self.TAB_REPAIRS).text.strip()

    def history_actions(self) -> list[str]:
        """The Action column of the History tab (When | Who | Action | Change)."""
        return [td.text.strip() for td in self.find_all((By.XPATH, "//table/tbody/tr/td[3]"))]

    def history_actors(self) -> list[str]:
        return [td.text.strip() for td in self.find_all((By.XPATH, "//table/tbody/tr/td[2]"))]

    def open_edit(self) -> "DeviceEditDialog":
        self.click(self.EDIT)
        return DeviceEditDialog(self.driver, self.base_url).wait_open()

    def open_report_damage(self) -> "ReportDamageDialog":
        self.click(self.REPORT_DAMAGE)
        return ReportDamageDialog(self.driver, self.base_url).wait_open()


class DeviceEditDialog(BasePage):
    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Edit ')]")
    BRAND = (By.CSS_SELECTOR, "input[name='brand']")
    MODEL = (By.CSS_SELECTOR, "input[name='model']")
    OS = (By.CSS_SELECTOR, "input[name='os']")
    OS_VERSION = (By.CSS_SELECTOR, "input[name='osVersion']")
    IMEI = (By.CSS_SELECTOR, "input[name='imei']")
    STATUS = (By.CSS_SELECTOR, "select[name='status']")
    PROJECT = (By.CSS_SELECTOR, "select[name='projectId']")
    ACCESSORIES = (By.CSS_SELECTOR, "input[name='accessories']")
    CLEAR_DAMAGE = (By.CSS_SELECTOR, "input[name='clearDamage']")
    SPEC_KEY = (By.CSS_SELECTOR, "input[name='spec_k_0']")
    SPEC_VALUE = (By.CSS_SELECTOR, "input[name='spec_v_0']")
    SAVE = (By.XPATH, "//button[normalize-space()='Save changes']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")
    DELETE = (By.XPATH, "//button[normalize-space()='Delete…']")
    CONFIRM_DELETE = (By.CSS_SELECTOR, "[data-testid='confirm-button']")
    SERIAL_NOTE = (By.XPATH, "//p[contains(., 'stays fixed')]")

    def wait_open(self) -> "DeviceEditDialog":
        self.find(self.HEADING)
        return self

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)

    def has_serial_field(self) -> bool:
        return self.is_present((By.CSS_SELECTOR, "input[name='serial']"), timeout=2)

    def reselect_project(self, name: str) -> "DeviceEditDialog":
        """Re-pick the device's project before saving.

        Needed because the dialog does not preselect it (F-12): the selects
        use `defaultValue` while the option list is still loading, so they
        settle on "— none —". Without this, every save is refused by the
        project-or-squad rule. Delete this helper once F-12 is fixed.
        """
        self.wait(15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "select[name='projectId'] option")) > 1
        )
        self.select_by_visible_text(self.PROJECT, name)
        return self

    def grouping_is_preselected(self) -> bool:
        """True when the dialog opens with the device's project already set."""
        from selenium.webdriver.support.ui import Select

        self.wait(15).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "select[name='projectId'] option")) > 1
        )
        return Select(self.find(self.PROJECT)).first_selected_option.get_attribute("value") != ""

    def save(self) -> None:
        self.click(self.SAVE)

    def delete(self) -> None:
        self.click(self.DELETE)
        self.click(self.CONFIRM_DELETE)


class ReportDamageDialog(BasePage):
    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Send to repair')]")
    ISSUE = (By.CSS_SELECTOR, "textarea[name='issue']")
    # Exact match: the dialog heading starts with the same words.
    SUBMIT = (By.XPATH, "//button[normalize-space()='Send to repair']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "ReportDamageDialog":
        self.find(self.HEADING)
        return self

    def describe(self, text: str) -> "ReportDamageDialog":
        self.type(self.ISSUE, text)
        return self

    def submit(self) -> None:
        self.click(self.SUBMIT)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)
