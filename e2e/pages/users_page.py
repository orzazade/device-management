"""`/users` — the admin-only account list, its Add user dialog, the role
assignment dialog and the confirmation dialog behind deletion."""

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

    def roles_of(self, row_text: str) -> list[str]:
        """The role chips in one row.

        An account can hold several roles now, so this returns a list. The
        chips are read rather than a dropdown's value: the row shows what the
        account actually holds, which a single-select could not represent.
        """
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]"
            f"//span[@data-testid='user-role-chip']",
        )
        return sorted(el.text.strip() for el in self.find_all(locator))

    def status_of(self, row_text: str) -> str:
        locator = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]/td[5]//span[contains(@class,'rounded-full')]",
        )
        return self.find(locator).text.strip()

    def open_role_editor(self, row_text: str) -> "AssignRolesDialog":
        button = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]"
            f"//button[@data-testid='user-edit-roles']",
        )
        self.click(button)
        return AssignRolesDialog(self.driver, self.base_url).wait_open()

    def can_edit_roles(self, row_text: str, timeout: int = 2) -> bool:
        """False for your own row — nobody may change their own access."""
        button = (
            By.XPATH,
            f"//table/tbody/tr[contains(., {xq(row_text)})]"
            f"//button[@data-testid='user-edit-roles']",
        )
        return self.is_visible(button, timeout)

    def open_add_user(self) -> "AddUserDialog":
        self.click(self.ADD_BUTTON)
        return AddUserDialog(self.driver, self.base_url).wait_open()


class AddUserDialog(BasePage):
    HEADING = (By.XPATH, "//h2[normalize-space()='Add user']")
    NAME = (By.CSS_SELECTOR, "input[name='name']")
    EMAIL = (By.CSS_SELECTOR, "input[name='email']")
    PASSWORD = (By.CSS_SELECTOR, "input[name='password']")
    ROLE = (By.CSS_SELECTOR, "select[data-testid='create-role']")
    CREATE = (By.XPATH, "//button[normalize-space()='Create']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")

    def wait_open(self) -> "AddUserDialog":
        self.find(self.HEADING)
        return self

    def fill(
        self,
        name: str,
        email: str,
        password: str,
        role_label: str = "Lab Tester",
    ) -> "AddUserDialog":
        """Fill the dialog. `role_label` names a real role, not a legacy tier.

        The picker only appears for somebody who may assign roles; everyone
        else creates accounts on the baseline role, which is what the default
        here selects.
        """
        self.type(self.NAME, name)
        self.type(self.EMAIL, email)
        self.type(self.PASSWORD, password)
        if self.is_present(self.ROLE, timeout=2):
            self.select_by_visible_text(self.ROLE, role_label)
        return self

    def role_options(self) -> list[str]:
        return [o.text.strip() for o in self.find_all((By.CSS_SELECTOR, "select[data-testid='create-role'] option"))]

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

    BODY = (By.XPATH, "//div[@data-testid='modal']")

    @property
    def title(self) -> str:
        return self.find(self.BOX).text.strip()

    @property
    def body(self) -> str:
        """Everything the dialog says — several of them explain a refusal
        below the heading rather than in it."""
        return self.find(self.BODY).text.strip()

    def confirm(self) -> None:
        self.click(self.CONFIRM)

    def cancel(self) -> None:
        self.click(self.CANCEL)


class AssignRolesDialog(BasePage):
    """The `Roles for <name>` dialog: one checkbox per role that exists."""

    HEADING = (By.XPATH, "//h2[starts-with(normalize-space(), 'Roles for')]")
    SAVE = (By.CSS_SELECTOR, "[data-testid='assign-save']")

    def wait_open(self) -> "AssignRolesDialog":
        self.find(self.HEADING)
        return self

    @property
    def title(self) -> str:
        return self.find(self.HEADING).text.strip()

    @staticmethod
    def role(name: str) -> tuple[str, str]:
        return (By.CSS_SELECTOR, f"[data-testid='assign-{name}']")

    def offered_roles(self) -> list[str]:
        els = self.find_all((By.CSS_SELECTOR, "[data-testid^='assign-']"))
        return sorted(
            el.get_attribute("data-testid")[len("assign-"):]
            for el in els
            if el.get_attribute("data-testid") != "assign-save"
        )

    def is_ticked(self, name: str) -> bool:
        return self.find(self.role(name)).is_selected()

    def toggle(self, name: str) -> "AssignRolesDialog":
        self._click_element(self.find(self.role(name)))
        return self

    def save(self) -> None:
        self.click(self.SAVE)

    def cancel(self) -> None:
        self.click(self.overlay_button("Cancel"))

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.HEADING, timeout)
