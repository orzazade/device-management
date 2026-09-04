"""The Roles screen: building a role out of checkboxes and living with it.

Two things make this screen worth its own file.

The first is the three-state checkbox. A module box that is ticked, cleared or
half-ticked has to say which, and `indeterminate` is a DOM property with no
attribute and no text — so every assertion here reads it explicitly rather
than trusting `is_selected()`, which reports "half" as "off".

The second is that a role is only as good as what it actually grants. Ticking
boxes and reading them back proves the widget; the round trip at the end of
this file signs in as somebody holding the role and uses it, which is the only
way to catch a permission that is stored correctly and reaches nothing.
"""

from __future__ import annotations

import pytest

from api_client import Api, ApiError
from pages import PermissionDialog, RepairsPage, RolesPage, UsersPage

pytestmark = pytest.mark.rbac

SUPER_ADMIN = "Super Admin"
LAB_TESTER = "Lab Tester"


@pytest.fixture
def roles_page(driver, base_url) -> RolesPage:
    return RolesPage(driver, base_url)


@pytest.fixture
def users_page(driver, base_url) -> UsersPage:
    return UsersPage(driver, base_url)


@pytest.fixture
def repairs_page(driver, base_url) -> RepairsPage:
    return RepairsPage(driver, base_url)


@pytest.fixture
def role_names(admin_api: Api):
    """Track roles a test creates and take them away again afterwards.

    Roles are global and permanent, so without this every run would leave
    another "Repair Desk e2e…" behind in a list a real administrator reads.
    A role nobody holds can be deleted, so holders are stripped first.
    """
    made: list[str] = []
    yield made
    lab_tester = admin_api.role_by_name(LAB_TESTER)
    for name in made:
        role = admin_api.role_by_name(name)
        if role is None:
            continue
        if role["holders"]:
            for user in admin_api.users():
                if name in (user.get("roles") or []):
                    admin_api.assign_roles(user["id"], [lab_tester["id"]])
        admin_api.delete_role(role["id"])


@pytest.fixture
def new_role(as_admin, roles_page: RolesPage, role_names, run_id: str):
    """Create a role through the UI and leave its permission editor open."""

    def _make(label: str, description: str = "Created by the Selenium suite") -> tuple[str, PermissionDialog]:
        name = f"{label} {run_id}"
        role_names.append(name)
        roles_page.open_roles()
        dialog = roles_page.open_new_role()
        dialog.fill(name, description)
        dialog.submit("Create")
        roles_page.wait_for_toast("Role created")
        return name, PermissionDialog(roles_page.driver, roles_page.base_url).wait_open()

    return _make


# ------------------------------------------------------------------ the list


@pytest.mark.smoke
def test_the_role_list_shows_the_two_built_in_roles(as_admin, roles_page: RolesPage):
    roles_page.open_roles()

    assert roles_page.has_row(SUPER_ADMIN)
    assert roles_page.has_row(LAB_TESTER)
    assert roles_page.granted_count(SUPER_ADMIN) > roles_page.granted_count(LAB_TESTER), (
        "Super Admin holds everything, so it must grant more than the baseline role"
    )
    assert roles_page.holder_count(LAB_TESTER) > 0, "the suite's own tester holds it"


def test_a_built_in_role_cannot_be_renamed_or_deleted(as_admin, roles_page: RolesPage):
    """Deleting Lab Tester would leave accounts with no role at all, and
    renaming it would break the code that looks it up by name. The row
    simply does not offer either."""
    roles_page.open_roles()

    for role in (SUPER_ADMIN, LAB_TESTER):
        assert roles_page.has_button(role, "role-permissions"), f"{role} should be readable"
        assert not roles_page.has_button(role, "role-rename"), f"{role} must not be renameable"
        assert not roles_page.has_button(role, "role-delete"), f"{role} must not be deletable"


def test_super_admin_shows_its_permissions_but_will_not_let_you_narrow_them(
    as_admin, roles_page: RolesPage
):
    """Super Admin is the top of the model. Being able to un-tick something
    here is how an administrator locks themselves out of their own lab."""
    roles_page.open_roles()
    editor = roles_page.open_permissions(SUPER_ADMIN)

    assert editor.state(editor.perm("devices.view")) == "on"
    assert editor.state(editor.perm("roles.create")) == "on"
    assert not editor.is_enabled(editor.perm("devices.view")), (
        "every box should be locked, not just the access-control ones"
    )
    assert not editor.save_is_enabled()


# ------------------------------------------------- three-state checkboxes


def test_a_module_is_half_ticked_when_only_part_of_it_is_selected(new_role):
    """The state that has no visual shorthand: not off, not on."""
    _, editor = new_role("Partial")

    assert editor.state(editor.module("Devices")) == "off"

    editor.tick("devices.view")

    assert editor.state(editor.perm("devices.view")) == "on"
    assert editor.state(editor.module("Devices")) == "partial", (
        "one permission out of a module is neither nothing nor all of it"
    )
    assert editor.state(editor.feature("Devices", "Inventory")) == "partial"
    assert editor.state(editor.feature("Devices", "Archive")) == "off", (
        "a feature with nothing ticked stays off even while its module is partial"
    )


def test_clicking_a_half_ticked_module_selects_all_of_it(new_role):
    """Somebody building a role up is nearly always adding, not removing —
    so the ambiguous click grants rather than clears."""
    _, editor = new_role("FillUp")
    editor.tick("devices.view")
    assert editor.state(editor.module("Devices")) == "partial"

    editor.toggle(editor.module("Devices"))

    assert editor.state(editor.module("Devices")) == "on"
    for key in ("devices.create", "devices.delete", "devices.import", "devices.restore"):
        assert editor.state(editor.perm(key)) == "on", f"{key} should have come with the module"


def test_clicking_a_fully_ticked_module_clears_it(new_role):
    _, editor = new_role("ClearOut")
    editor.toggle(editor.module("Devices"))
    assert editor.state(editor.module("Devices")) == "on"
    before = editor.selected_count()

    editor.toggle(editor.module("Devices"))

    assert editor.state(editor.module("Devices")) == "off"
    assert editor.state(editor.perm("devices.view")) == "off"
    assert editor.selected_count() < before


# ------------------------------------------------------------ dependencies


def test_ticking_a_permission_also_enables_what_it_needs_and_says_so(new_role):
    """Editing a device is done from the device page. Granting the edit
    without the page would produce a role that cannot reach its own button —
    so the editor grants both and explains itself rather than silently
    fixing it up on save."""
    _, editor = new_role("Editor")

    editor.tick("devices.update")

    assert editor.state(editor.perm("devices.view")) == "on"
    note = editor.note()
    assert "View inventory" in note, f"the note should name what it switched on, got {note!r}"
    assert editor.selected_count() == 2


def test_unticking_something_that_is_needed_switches_off_what_needed_it(new_role):
    """Without this the server's closure would put the permission straight
    back, and the checkbox would look like it ignored the click."""
    _, editor = new_role("Cascade")
    editor.tick("devices.update")
    assert editor.state(editor.perm("devices.view")) == "on"

    editor.tick("devices.view")

    assert editor.state(editor.perm("devices.view")) == "off"
    assert editor.state(editor.perm("devices.update")) == "off", (
        "editing cannot survive without the page it is done from"
    )
    note = editor.note()
    assert "Edit a device" in note, f"the note should name what it switched off, got {note!r}"


def test_a_dependency_chain_is_followed_all_the_way(new_role):
    """restore needs viewDeleted, which needs view. One click, three ticks."""
    _, editor = new_role("Restorer")

    editor.tick("devices.restore")

    assert editor.state(editor.perm("devices.viewDeleted")) == "on"
    assert editor.state(editor.perm("devices.view")) == "on", (
        "the closure has to be transitive, not one level deep"
    )


# --------------------------------------------------------- access control


def test_access_control_is_never_offered_to_a_custom_role(new_role):
    """This is the escalation guard. A role that could grant itself
    `roles.update` would make every other rule here decorative."""
    _, editor = new_role("Nosy")

    for key in ("roles.view", "roles.create", "roles.update", "roles.delete", "users.roles.assign"):
        assert not editor.is_enabled(editor.perm(key)), f"{key} must not be selectable"
    assert not editor.is_enabled(editor.module("Access control")), (
        "the module box must not be a way around its locked children"
    )
    assert "Super Admin only" in editor.module_label("Access control"), (
        "greyed-out boxes with no explanation read as a bug, not as a rule"
    )


# ------------------------------------------------- escalation through users


def test_creating_an_account_is_not_a_way_to_hand_out_access(
    new_role, roles_page: RolesPage, admin_api: Api, api_url, run_id: str, role_names
):
    """`users.create` must not be able to mint a Super Admin.

    Otherwise the cheapest escalation in the system is: create an account
    holding everything, then sign in as it. That routes around every rule the
    role editor enforces, so the refusal lives in the API, not the dialog.
    """
    name, editor = new_role("Recruiter")
    editor.tick("users.create")
    editor.save()
    roles_page.wait_for_toast("Permissions saved")

    recruiter = admin_api.create_user(
        f"Recruiter {run_id}", f"{run_id}.recruiter@devicedesk.local", "Recruit2026x", "tester"
    )
    admin_api.assign_roles(recruiter["id"], [admin_api.role_by_name(name)["id"]])

    theirs = Api(api_url)
    theirs.login(f"{run_id}.recruiter@devicedesk.local", "Recruit2026x")
    super_admin = admin_api.role_by_name(SUPER_ADMIN)

    with pytest.raises(ApiError, match="403"):
        theirs.post(
            "/users",
            {
                "name": f"Puppet {run_id}",
                "email": f"{run_id}.puppet@devicedesk.local",
                "password": "Puppet2026x",
                "roleIds": [super_admin["id"]],
            },
        )

    # The baseline account they ARE allowed to create still works.
    made = theirs.post(
        "/users",
        {
            "name": f"Newbie {run_id}",
            "email": f"{run_id}.newbie@devicedesk.local",
            "password": "Newbie2026x",
        },
    )
    assert admin_api.roles_of(f"{run_id}.newbie@devicedesk.local") == [LAB_TESTER]
    admin_api.delete(f"/users/{made['id']}")
    admin_api.delete(f"/users/{recruiter['id']}")


def test_editing_a_super_admin_needs_to_be_one(
    new_role, roles_page: RolesPage, admin_api: Api, api_url, accounts, run_id: str
):
    """`users.update` covers password resets, so without this rule a role
    that can edit people could take over a Super Admin's account and inherit
    everything it holds."""
    name, editor = new_role("Editor of people")
    editor.tick("users.update")
    editor.save()
    roles_page.wait_for_toast("Permissions saved")

    clerk = admin_api.create_user(
        f"Clerk {run_id}", f"{run_id}.clerk@devicedesk.local", "Clerk2026x", "tester"
    )
    admin_api.assign_roles(clerk["id"], [admin_api.role_by_name(name)["id"]])

    theirs = Api(api_url)
    theirs.login(f"{run_id}.clerk@devicedesk.local", "Clerk2026x")

    admin_id = admin_api.find_user_by_email(accounts["admin"]["email"])["id"]
    with pytest.raises(ApiError, match="403"):
        theirs.request("PATCH", f"/users/{admin_id}", json={"newPassword": "Hijack2026x"})

    # They can still do the job the role is for.
    theirs.request("PATCH", f"/users/{clerk['id']}", json={"name": f"Clerk {run_id} renamed"})
    admin_api.delete(f"/users/{clerk['id']}")


# ------------------------------------------------------------ the round trip


@pytest.mark.smoke
def test_a_role_built_in_the_editor_grants_exactly_what_was_ticked(
    new_role,
    roles_page: RolesPage,
    users_page: UsersPage,
    repairs_page: RepairsPage,
    login_page,
    shell,
    admin_api: Api,
    spare_account,
    reported_damage,
):
    """The test that matters: tick a box, and somebody holding the role can
    do that thing and nothing else.

    Moving a repair along is a good subject because the baseline role can
    already SEE the queue but has no buttons on it — so the new permission
    is visible as a change rather than as a page appearing.
    """
    device, _ = reported_damage("Screen cracked in transit")
    name, editor = new_role("Repair Desk")

    editor.tick("repairs.advance")
    assert editor.state(editor.perm("repairs.view")) == "on", (
        "the queue came along with the button that lives on it"
    )
    editor.save()
    roles_page.wait_for_toast("Permissions saved")

    assert admin_api.role_by_name(name)["permissions"] == ["repairs.advance", "repairs.view"]

    # Hand it to somebody, alongside the baseline role they already hold.
    holder = spare_account("fixer", role="tester")
    users_page.open_users()
    users_page.search(holder["email"])
    assign = users_page.open_role_editor(holder["email"])
    assign.toggle(name)
    assign.save()
    users_page.wait_for_toast("Roles updated")

    # And now be them.
    login_page.clear_session()
    login_page.login(holder["email"], holder["password"])
    shell.wait_heading("Hi,")

    repairs_page.open_repairs()
    assert repairs_page.has_row(device["model"])
    assert repairs_page.has_actions_column(), (
        "the role was granted the button, so the column it lives in must be there"
    )
    repairs_page.advance(device["model"])
    repairs_page.wait_for_toast("Repair moved forward")
    repairs_page.wait_for_state(device["model"], "Repair requested")

    # Everything not ticked stayed out of reach.
    assert not shell.has_nav_link("Users", timeout=2)
    assert not shell.has_nav_link("Roles", timeout=2)
    users_page.open("/users")
    users_page.wait_for_path("/")


# ---------------------------------------------------------------- lifecycle


def test_a_role_somebody_holds_cannot_be_deleted(
    new_role, roles_page: RolesPage, users_page: UsersPage, admin_api: Api, spare_account
):
    """Deleting a role in use would silently take access away from whoever
    holds it, so the app makes you take it off them first — and says how
    many people that is."""
    name, editor = new_role("Occupied")
    editor.tick("devices.view")
    editor.save()
    roles_page.wait_for_toast("Permissions saved")

    holder = spare_account("occupant", role="tester")
    admin_api.assign_roles(
        holder["id"],
        [admin_api.role_by_name(LAB_TESTER)["id"], admin_api.role_by_name(name)["id"]],
    )

    roles_page.open_roles()
    assert roles_page.holder_count(name) == 1
    confirm = roles_page.delete(name)
    assert "1 person holds" in confirm.body, (
        f"the dialog should count who is in the way, said {confirm.body!r}"
    )
    confirm.confirm()

    assert "1 person" in roles_page.banner_error, (
        f"the refusal should say who is in the way, got {roles_page.banner_error!r}"
    )
    assert admin_api.role_by_name(name) is not None, "the role must still exist"


def test_a_name_already_taken_is_refused_whatever_its_capitals(
    as_admin, roles_page: RolesPage, role_names, run_id: str
):
    """Two roles a glance apart is how somebody ends up editing the wrong one.

    The database index is on `lower(name)`, so a check that compared names
    exactly would let this through and turn a clash the administrator can fix
    into a 500 they can only report.
    """
    name = f"Twin {run_id}"
    role_names.append(name)
    roles_page.open_roles()
    dialog = roles_page.open_new_role()
    dialog.fill(name, "The original")
    dialog.submit("Create")
    roles_page.wait_for_toast("Role created")
    PermissionDialog(roles_page.driver, roles_page.base_url).wait_open().cancel()

    dialog = roles_page.open_new_role()
    dialog.fill(name.lower(), "The impostor")
    dialog.submit("Create")

    assert "already exists" in roles_page.banner_error, (
        f"expected a name-clash refusal, got {roles_page.banner_error!r}"
    )
    assert not roles_page.has_row(name.lower(), timeout=2)


def test_duplicating_a_role_copies_what_it_grants(
    new_role, roles_page: RolesPage, role_names, admin_api: Api
):
    """The usual way a new role gets made: start from one that nearly fits."""
    name, editor = new_role("Original")
    editor.tick("devices.update")
    editor.save()
    roles_page.wait_for_toast("Permissions saved")

    roles_page.duplicate(name)
    roles_page.wait_for_toast("Role duplicated")

    copy = f"{name} copy"
    role_names.append(copy)
    assert roles_page.has_row(copy)
    assert admin_api.role_by_name(copy)["permissions"] == ["devices.update", "devices.view"]
    assert roles_page.holder_count(copy) == 0, "a copy starts with nobody in it"


def test_renaming_a_role_keeps_its_permissions(
    new_role, roles_page: RolesPage, role_names, admin_api: Api, run_id: str
):
    name, editor = new_role("Misnamed")
    editor.tick("devices.view")
    editor.save()
    roles_page.wait_for_toast("Permissions saved")

    renamed = f"Renamed {run_id}"
    role_names.append(renamed)
    dialog = roles_page.open_rename(name)
    dialog.fill(renamed, "Renamed by the Selenium suite")
    dialog.submit("Save")
    roles_page.wait_for_toast("Role updated")

    assert roles_page.has_row(renamed)
    assert not roles_page.has_row(name, timeout=2)
    assert admin_api.role_by_name(renamed)["permissions"] == ["devices.view"]
