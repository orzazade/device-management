"""Staff-only administration: projects and user accounts."""

from __future__ import annotations

import pytest

from api_client import Api
from pages import ProjectsPage, UsersPage

pytestmark = pytest.mark.crud


@pytest.fixture
def projects_page(driver, base_url) -> ProjectsPage:
    return ProjectsPage(driver, base_url)


@pytest.fixture
def users_page(driver, base_url) -> UsersPage:
    return UsersPage(driver, base_url)


# --------------------------------------------------------------------- projects


@pytest.mark.smoke
def test_manager_creates_a_project(as_manager, projects_page: ProjectsPage, run_id: str):
    name = f"Release Regression {run_id}"

    projects_page.open_projects()
    dialog = projects_page.open_new_project()
    dialog.fill(name, "Weekly regression pack")
    dialog.create()

    projects_page.wait_for_toast("Project created")
    assert not dialog.is_open(timeout=5)
    assert projects_page.has_card(name)
    card = projects_page.card_text(name)
    assert "Weekly regression pack" in card
    assert "0 devices attached" in card


@pytest.mark.smoke
def test_projects_and_squads_are_separate_tabs(
    as_manager, projects_page: ProjectsPage, admin_api: Api, run_id: str
):
    """Since the page was split into tabs, a project must not show up under
    Squads and vice versa — that separation is the whole point of the split."""
    project_name = f"Tabbed Project {run_id}"
    squad_name = f"Tabbed Squad {run_id}"

    projects_page.open_projects()
    dialog = projects_page.open_new_project()
    assert "project" in dialog.heading().lower(), "the Projects tab offers a project dialog"
    dialog.fill(project_name, "Lives under Projects")
    dialog.create()
    projects_page.wait_for_toast("Project created")

    dialog = projects_page.open_new_squad()
    assert "squad" in dialog.heading().lower(), "the Squads tab offers a squad dialog"
    dialog.fill(squad_name, "Lives under Squads")
    dialog.create()
    projects_page.wait_for_toast("Squad created")

    # On the Squads tab: the squad is there, the project is not.
    projects_page.show_squads()
    assert projects_page.has_card(squad_name)
    assert not projects_page.has_card(project_name, timeout=3), (
        "a project must not appear under Squads"
    )

    # And the other way round.
    projects_page.show_projects()
    assert projects_page.has_card(project_name)
    assert not projects_page.has_card(squad_name, timeout=3), (
        "a squad must not appear under Projects"
    )

    stored = {p["name"]: p["kind"] for p in admin_api.get("/projects?kind=all")}
    assert stored[project_name] == "project"
    assert stored[squad_name] == "squad"


def test_the_new_button_follows_the_open_tab(as_manager, projects_page: ProjectsPage):
    """One button, relabelled by context — so it must never offer to create
    the wrong kind."""
    projects_page.open_projects()

    projects_page.show_projects()
    assert projects_page.new_button_label() == "New project"

    projects_page.show_squads()
    assert projects_page.new_button_label() == "New squad"


def test_each_tab_counts_its_own_kind(
    as_manager, projects_page: ProjectsPage, admin_api: Api, run_id: str
):
    """The count in each tab label has to track what that tab holds."""
    projects_page.open_projects()
    before = projects_page.tab_count("squad")

    dialog = projects_page.open_new_squad()
    dialog.fill(f"Counted Squad {run_id}")
    dialog.create()
    projects_page.wait_for_toast("Squad created")

    projects_page.show_squads()
    assert projects_page.tab_count("squad") == before + 1, (
        "the Squads tab count should include the squad just created"
    )


@pytest.mark.validation
def test_project_name_is_required_and_has_a_minimum_length(
    as_manager, projects_page: ProjectsPage
):
    projects_page.open_projects()
    dialog = projects_page.open_new_project()

    dialog.create()
    # The create dialog is shared by projects and squads, so its copy is
    # kind-neutral; the edit dialog still says "Project name is required".
    assert dialog.field_error("name") == "A name is required"

    dialog.type(dialog.NAME, "A")
    dialog.create()
    assert dialog.field_error("name") == "At least 2 characters"
    assert dialog.is_open()


def test_a_new_project_becomes_selectable_when_adding_a_device(
    as_admin, projects_page: ProjectsPage, driver, base_url, run_id: str
):
    """A project is only useful once devices can be tagged with it."""
    from pages import DevicesPage

    name = f"Pipeline {run_id}"
    projects_page.open_projects()
    dialog = projects_page.open_new_project()
    dialog.fill(name)
    dialog.create()
    projects_page.wait_for_toast("Project created")

    devices = DevicesPage(driver, base_url).open_devices()
    add = devices.open_add_device()
    options = [o.text for o in add.find_all((add.PROJECT[0], add.PROJECT[1] + " option"))]

    assert name in options, f"the new project should be pickable, options were {options}"


# ------------------------------------------------------------------------ users


@pytest.mark.smoke
def test_admin_creates_a_tester_account(
    as_admin, users_page: UsersPage, admin_api: Api, run_id: str
):
    email = f"{run_id}.newhire@devicedesk.local"
    name = f"New Hire {run_id}"

    users_page.open_users()
    dialog = users_page.open_add_user()
    dialog.fill(name, email, "Onboard2026x", role_label="Tester")
    dialog.create()

    users_page.wait_for_toast("User created")
    assert users_page.has_row(email)
    assert users_page.status_of(email) == "Active"

    stored = [u for u in admin_api.users() if u["email"] == email]
    assert stored, "the account was not persisted"
    assert stored[0]["role"] == "tester"
    assert stored[0]["name"] == name

    # This test has to create a real account — that is its subject. Remove it
    # again so repeated runs do not grow the user list.
    admin_api.delete(f"/users/{stored[0]['id']}")


@pytest.mark.validation
def test_add_user_enforces_name_email_and_password_rules(as_admin, users_page: UsersPage):
    users_page.open_users()
    dialog = users_page.open_add_user()

    dialog.create()
    assert dialog.field_error("name") == "Name is required"
    assert dialog.field_error("email") == "Email is required"
    assert dialog.field_error("password") == "Password is required"

    dialog.type(dialog.NAME, "Al")
    dialog.type(dialog.EMAIL, "not-an-email")
    dialog.type(dialog.PASSWORD, "abcdefgh")
    dialog.create()
    assert dialog.field_error("email") == "Enter a valid email, like name@company.com"
    assert dialog.field_error("password") == "At least 8 characters, with letters and numbers"
    assert dialog.is_open()


@pytest.mark.validation
def test_duplicate_email_is_refused(as_admin, users_page: UsersPage, accounts):
    users_page.open_users()
    dialog = users_page.open_add_user()
    dialog.fill(f"Clone {accounts['tester']['name']}", accounts["tester"]["email"], "Clone2026x")
    dialog.create()

    error = dialog.banner_error.lower()
    assert "email" in error or "already" in error or "exists" in error, (
        f"expected a duplicate-email message, got {dialog.banner_error!r}"
    )


def test_search_filters_the_user_table(as_admin, users_page: UsersPage, accounts):
    users_page.open_users()
    before = users_page.row_count()

    users_page.search(accounts["tester"]["email"])

    assert users_page.row_count() < before, "search should narrow the table"
    assert users_page.has_row(accounts["tester"]["email"])


def test_changing_a_role_asks_for_confirmation_first(
    as_admin, users_page: UsersPage, admin_api: Api, spare_account
):
    """Role changes take effect on the person's next click, so the app makes
    the admin acknowledge the consequence.

    The account is permanent and reset to Tester by the fixture, so the test
    can promote it every run without creating anyone.
    """
    account = spare_account("promote", role="tester")
    email, name = account["email"], account["name"]

    users_page.open_users()
    users_page.search(email)
    confirm = users_page.change_role(email, "Manager")

    assert "Manager" in confirm.title and name in confirm.title
    confirm.cancel()
    assert [u for u in admin_api.users() if u["email"] == email][0]["role"] == "tester", (
        "cancelling the dialog must not change the role"
    )

    users_page.search(email)
    confirm = users_page.change_role(email, "Manager")
    confirm.confirm()
    users_page.wait_for_toast("Role updated")

    assert [u for u in admin_api.users() if u["email"] == email][0]["role"] == "manager"


@pytest.mark.rbac
def test_a_manager_cannot_reassign_roles(as_manager, users_page: UsersPage, accounts):
    """Only admins get the role dropdown — a manager sees plain text."""
    users_page.open_users()
    users_page.search(accounts["tester"]["email"])

    row_select = (
        users_page.row_for(accounts["tester"]["email"])[0],
        users_page.row_for(accounts["tester"]["email"])[1] + "//select",
    )
    assert not users_page.is_present(row_select, timeout=2), (
        "a manager must not be offered the role dropdown"
    )
    assert users_page.role_of(accounts["tester"]["email"]) == "Tester"
