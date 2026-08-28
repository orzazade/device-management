"""`/users` — the admin-only account list, its Add user dialog and the
confirmation dialogs behind role changes and deletion."""

from __future__ import annotations

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq


class UsersPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Users']")
    SEARCH = (By.CSS_SELECTOR, "input[type='search'][placeholder^='Search name']")
    SHOW_DELETED = (By.XPATH, "//label[contains(., 'Show deleted')]/input[@type='checkbox']")
    ADD_BUTTON = (By.XPATH, "//button[normalize-space()='Add user']")
    ROWS = (By.CSS_SELECTOR, "table tbody tr")
    BANNER_ERROR = (By.XPATH, "//p[contains(@class,'text-red-700')]")

    LOADING = (By.XPATH, "//p[normalize-space()='loading…']")

    def open_users(self) -> "UsersPage":
        self.open("/users")
        self.find(self.HEADING)
        self.wait_loaded()
        return self

    def wait_loaded(self, timeout: int = 20) -> "UsersPage":
        """Wait for the account list itself, not just the heading.

        The heading renders immediately while the query is still in flight, so
        counting rows straight after open_users() could return 0 and make a
        later comparison meaningless. The list grows with the team, so this
        matters more over time, not less.
        """
        self.wait(timeout).until(
            lambda d: d.find_elements(*self.ROWS) or d.find_elements(*self.LOADING) == []
        )
        return self

    def row_for(self, text: str):
        return (By.XPATH, f"//table/tbody/tr[contains(., {xq(text)})]")

    def has_row(self, text: str, timeout: int = 10) -> bool:
        return self.is_visible(self.row_for(text), timeout)

    def row_count(self) -> int:
        return len(self.find_all(self.ROWS))

    def search(self, text: str) -> "UsersPage":
        el = self.find(self.SEARCH)
        el.clear()
        el.send_keys(text)
        return self

    def role_of(self, row_text: str) -> str:
        """Reads the role select (admins get a dropdown, others plain text)."""
        select = (By.XPATH, f"//table/tbody/tr[contains(., {xq(row_text)})]//select")
        if self.is_present(select, timeout=2):
            el = self.find(select)
            return el.find_element(By.CSS_SELECTOR, "option[selected], option:checked").text.strip()
        return self.find((By.XPATH, f"//table/tbody/tr[contains(., {xq(row_text)})]/td[3]")).text.strip()

    def status_of(self, row_text: str) -> str:
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]/td[5]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator).text.strip()

    def change_role(self, row_text: str, role_label: str) -> "ConfirmDialog":
        select = (By.XPATH, f"//table/tbody/tr[contains(., {xq(row_text)})]//select")
        self.select_by_visible_text(select, role_label)
        return ConfirmDialog(self.driver, self.base_url).wait_open()

    def open_add_user(self) -> "AddUserDialog":
        self.click(self.ADD_BUTTON)
        return AddUserDialog(self.driver, self.base_url).wait_open()


class AddUserDialog(BasePage):
    HEADING = (By.XPATH, "//h2[normalize-space()='Add user']")
    NAME = (By.CSS_SELECTOR, "input[name='name']")
    EMAIL = (By.CSS_SELECTOR, "input[name='email']")
    PASSWORD = (By.CSS_SELECTOR, "input[name='password']")
    ROLE = (By.CSS_SELECTOR, "select[name='role']")
    CREATE = (By.XPATH, "//button[normalize-space()='Create']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "AddUserDialog":
        self.find(self.HEADING)
        return self

    def fill(self, name: str, email: str, password: str, role_label: str = "Tester") -> "AddUserDialog":
        self.type(self.NAME, name)
        self.type(self.EMAIL, email)
        self.type(self.PASSWORD, password)
        self.select_by_visible_text(self.ROLE, role_label)
        return self

    def create(self) -> None:
        self.click(self.CREATE)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)


class ConfirmDialog(BasePage):
    """The generic ConfirmModal used for role changes and deletions."""

    # ConfirmModal gained data-testids when F-10 gave each dialog distinct
    # confirm copy ("Yes, change the role", "Yes, delete", …). Matching the
    # test id instead of the words keeps this immune to the next reword.
    BOX = (By.XPATH, "//div[@data-testid='modal']//h2")
    CONFIRM = (By.CSS_SELECTOR, "[data-testid='confirm-button']")
    CANCEL = (By.CSS_SELECTOR, "[data-testid='confirm-cancel']")

    def wait_open(self) -> "ConfirmDialog":
        self.find(self.CONFIRM)
        return self

    @property
    def title(self) -> str:
        return self.find(self.BOX).text.strip()

    def confirm(self) -> None:
        self.click(self.CONFIRM)

    def cancel(self) -> None:
        self.click(self.CANCEL)
