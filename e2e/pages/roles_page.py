"""`/roles` — the role list and the permission tree behind it.

The tree is the only screen in the app whose checkboxes have three states, so
this page object exposes that third state explicitly. `indeterminate` is a DOM
property with no HTML attribute and no visual difference Selenium can read, so
it has to be asked for over JavaScript — `is_selected()` reports a
partially-ticked box as unchecked, which would make a half-ticked module and
an empty one indistinguishable.
"""

from __future__ import annotations

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq
from .users_page import ConfirmDialog


class RolesPage(BasePage):
    HEADING = (By.XPATH, "//h1[normalize-space()='Roles']")
    NEW_BUTTON = (By.CSS_SELECTOR, "[data-testid='role-new']")
    ROWS = (By.CSS_SELECTOR, "[data-testid='role-row']")

    def open_roles(self) -> "RolesPage":
        self.open("/roles")
        self.find(self.HEADING)
        self.wait(20).until(lambda d: d.find_elements(*self.ROWS))
        return self

    # ------------------------------------------------------------------ rows

    def row_for(self, name: str) -> tuple[str, str]:
        return (By.XPATH, f"//tr[@data-testid='role-row'][contains(., {xq(name)})]")

    def has_row(self, name: str, timeout: int = 10) -> bool:
        return self.is_visible(self.row_for(name), timeout)

    def row_names(self) -> list[str]:
        return [r.find_element(By.TAG_NAME, "b").text.strip() for r in self.find_all(self.ROWS)]

    def _cell(self, name: str, index: int) -> str:
        return self.find((self.row_for(name)[0], f"{self.row_for(name)[1]}/td[{index}]")).text.strip()

    def granted_count(self, name: str) -> int:
        """The "N of M" in the "Can do" column, as N."""
        return int(self._cell(name, 2).split()[0])

    def holder_count(self, name: str) -> int:
        return int(self._cell(name, 3))

    def _row_button(self, name: str, testid: str) -> tuple[str, str]:
        row = self.row_for(name)[1]
        return (By.XPATH, f"{row}//button[@data-testid={xq(testid)}]")

    def has_button(self, name: str, testid: str, timeout: int = 2) -> bool:
        return self.is_visible(self._row_button(name, testid), timeout)

    # --------------------------------------------------------------- actions

    def open_new_role(self) -> "NewRoleDialog":
        self.click(self.NEW_BUTTON)
        return NewRoleDialog(self.driver, self.base_url).wait_open()

    def open_permissions(self, name: str) -> "PermissionDialog":
        self.click(self._row_button(name, "role-permissions"))
        return PermissionDialog(self.driver, self.base_url).wait_open()

    def open_rename(self, name: str) -> "NewRoleDialog":
        self.click(self._row_button(name, "role-rename"))
        return NewRoleDialog(self.driver, self.base_url).wait_open(heading_prefix="Rename")

    def duplicate(self, name: str) -> None:
        self.click(self._row_button(name, "role-duplicate"))

    def delete(self, name: str) -> ConfirmDialog:
        self.click(self._row_button(name, "role-delete"))
        return ConfirmDialog(self.driver, self.base_url).wait_open()


class NewRoleDialog(BasePage):
    """Shared by "New role" and "Rename" — same two fields, different verb."""

    NAME = (By.CSS_SELECTOR, "input[name='name']")
    DESCRIPTION = (By.CSS_SELECTOR, "input[name='description']")

    def wait_open(self, heading_prefix: str = "New role") -> "NewRoleDialog":
        self.find((By.XPATH, f"//h2[starts-with(normalize-space(), {xq(heading_prefix)})]"))
        return self

    def fill(self, name: str, description: str = "") -> "NewRoleDialog":
        self.type(self.NAME, name)
        if description:
            self.type(self.DESCRIPTION, description)
        return self

    def submit(self, label: str = "Create") -> None:
        self.click(self.overlay_button(label))


class PermissionDialog(BasePage):
    """The permission tree, plus the note it shows when it changes your ticks."""

    TREE = (By.CSS_SELECTOR, "[data-testid='permission-tree']")
    NOTE = (By.CSS_SELECTOR, "[data-testid='permission-note']")
    SAVE = (By.CSS_SELECTOR, "[data-testid='role-save-permissions']")
    COUNT = (By.XPATH, "//span[contains(normalize-space(), ' selected')]")

    def wait_open(self) -> "PermissionDialog":
        self.find(self.TREE)
        return self

    # ----------------------------------------------------------- checkboxes

    @staticmethod
    def perm(key: str) -> tuple[str, str]:
        return (By.CSS_SELECTOR, f"[data-testid='perm-{key}']")

    @staticmethod
    def module(name: str) -> tuple[str, str]:
        return (By.CSS_SELECTOR, f"[data-testid='module-{name}']")

    @staticmethod
    def feature(module: str, name: str) -> tuple[str, str]:
        """Features are addressed by module too — three modules have an
        "Archive", and an id that named only the feature would match all
        three and silently act on whichever rendered first."""
        return (By.CSS_SELECTOR, f"[data-testid='feature-{module}-{name}']")

    def state(self, locator: tuple[str, str]) -> str:
        """One of "on", "off" or "partial".

        Read in a single JS call so the two properties cannot be sampled
        either side of a re-render and disagree with each other.
        """
        el = self.find(locator)
        checked, indeterminate = self.driver.execute_script(
            "return [arguments[0].checked, arguments[0].indeterminate];", el
        )
        if checked:
            return "on"
        return "partial" if indeterminate else "off"

    def is_enabled(self, locator: tuple[str, str]) -> bool:
        return self.find(locator).is_enabled()

    def module_label(self, name: str) -> str:
        """The module's whole label, including any badge it carries."""
        return self.find(
            (By.XPATH, f"//label[.//input[@data-testid='module-{name}']]")
        ).text.strip()

    def toggle(self, locator: tuple[str, str]) -> "PermissionDialog":
        self._click_element(self.find(locator))
        return self

    def tick(self, key: str) -> "PermissionDialog":
        return self.toggle(self.perm(key))

    # --------------------------------------------------------------- readout

    def note(self, timeout: int = 5) -> str:
        return self.find(self.NOTE, timeout).text.strip()

    def has_note(self, timeout: int = 2) -> bool:
        return self.is_visible(self.NOTE, timeout)

    def selected_count(self) -> int:
        return int(self.find(self.COUNT).text.split()[0])

    def save(self) -> None:
        self.click(self.SAVE)

    def save_is_enabled(self) -> bool:
        return self.find(self.SAVE).is_enabled()

    def cancel(self) -> None:
        self.click(self.overlay_button("Cancel"))
