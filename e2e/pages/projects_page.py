"""`/projects` — Projects and Squads, split across two tabs.

Since 9c1d238 the page is tabbed: "Projects (n)" and "Squads (n)", with a
single New button that follows whichever tab is open. Cards are filtered to
the active tab, so every card lookup here selects its tab first — otherwise a
squad looks missing simply because the Projects tab is showing.
"""

from __future__ import annotations

from selenium.webdriver.common.by import By

from .base_page import BasePage, xq


class ProjectsPage(BasePage):
    HEADING = (By.XPATH, "//h1[starts-with(normalize-space(), 'Projects')]")
    TAB_PROJECTS = (By.XPATH, "//button[starts-with(normalize-space(), 'Projects (')]")
    TAB_SQUADS = (By.XPATH, "//button[starts-with(normalize-space(), 'Squads (')]")
    # One button, relabelled by the open tab.
    NEW_BUTTON = (By.XPATH, "//button[normalize-space()='New project' or normalize-space()='New squad']")
    SHOW_DELETED = (By.XPATH, "//label[contains(., 'Show deleted')]/input[@type='checkbox']")
    EMPTY_PROJECTS = (By.XPATH, "//p[contains(., 'No projects yet')]")
    EMPTY_SQUADS = (By.XPATH, "//p[contains(., 'No squads yet')]")
    CARDS = (By.XPATH, "//div[contains(@class,'rounded-xl')][.//div[contains(@class,'font-bold')]]")

    def open_projects(self) -> "ProjectsPage":
        self.open("/projects")
        self.find(self.HEADING)
        return self

    # ------------------------------------------------------------------ tabs

    def show_projects(self) -> "ProjectsPage":
        self.click(self.TAB_PROJECTS)
        return self

    def show_squads(self) -> "ProjectsPage":
        self.click(self.TAB_SQUADS)
        return self

    def tab_count(self, kind: str) -> int:
        """The number in the tab label, e.g. Squads (3)."""
        label = self.find(self.TAB_SQUADS if kind == "squad" else self.TAB_PROJECTS).text
        return int(label.split("(")[1].rstrip(")"))

    def new_button_label(self) -> str:
        return self.find(self.NEW_BUTTON).text.strip()

    # ----------------------------------------------------------------- cards

    def card_for(self, name: str):
        return (By.XPATH, f"//div[contains(@class,'rounded-xl')][.//div[normalize-space()={xq(name)}]]")

    def has_card(self, name: str, timeout: int = 10) -> bool:
        return self.is_visible(self.card_for(name), timeout)

    def card_text(self, name: str) -> str:
        return self.find(self.card_for(name)).text.strip()

    def visible_card_names(self) -> list[str]:
        return [
            c.text.split("\n")[0].strip()
            for c in self.find_all((By.XPATH, "//div[contains(@class,'rounded-xl')]/div/div[contains(@class,'font-bold')]"))
        ]

    # --------------------------------------------------------------- dialogs

    def _open_new(self, kind: str) -> "ProjectDialog":
        """Switch tab, then wait for the New button to admit it switched.

        The button's click handler reads the tab from state. Clicking it in the
        same breath as the tab can fire while the old tab is still current — and
        then a "New squad" click quietly creates a project. Waiting for the
        label is what makes the tab change observable.
        """
        expected = "New squad" if kind == "squad" else "New project"
        (self.show_squads if kind == "squad" else self.show_projects)()
        self.wait(10).until(lambda d: self.new_button_label() == expected)
        self.click(self.NEW_BUTTON)
        return ProjectDialog(self.driver, self.base_url).wait_open()

    def open_new_project(self) -> "ProjectDialog":
        return self._open_new("project")

    def open_new_squad(self) -> "ProjectDialog":
        return self._open_new("squad")

    def edit(self, name: str) -> "ProjectDialog":
        locator = (
            self.card_for(name)[0],
            self.card_for(name)[1] + "//button[normalize-space()='Edit']",
        )
        self.click(locator)
        return ProjectDialog(self.driver, self.base_url).wait_open()


class ProjectDialog(BasePage):
    """Shared by New project, New squad and Edit — same fields throughout."""

    NAME = (By.CSS_SELECTOR, "input[name='name']")
    DESCRIPTION = (By.CSS_SELECTOR, "input[name='description']")
    CREATE = (By.XPATH, "//button[normalize-space()='Create']")
    SAVE = (By.XPATH, "//button[normalize-space()='Save']")
    CANCEL = (By.XPATH, "//button[normalize-space()='Cancel']")
    DELETE = (By.XPATH, "//button[normalize-space()='Delete…']")

    def wait_open(self) -> "ProjectDialog":
        self.find(self.NAME)
        return self

    def heading(self) -> str:
        return self.find((By.XPATH, "//h2")).text.strip()

    def fill(self, name: str, description: str = "") -> "ProjectDialog":
        self.type(self.NAME, name)
        if description:
            self.type(self.DESCRIPTION, description)
        return self

    def create(self) -> None:
        self.click(self.CREATE)

    def save(self) -> None:
        self.click(self.SAVE)

    def is_open(self, timeout: int = 3) -> bool:
        return self.is_visible(self.NAME, timeout)
