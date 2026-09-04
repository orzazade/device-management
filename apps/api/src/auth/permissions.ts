/**
 * The permission catalogue — the single source of truth.
 *
 * This constant is what the seed migration writes into the `permissions`
 * table, and (from step 3 onward) what `@RequirePermission()` accepts. Keeping
 * both sides fed from one list is what stops the keys in the code and the rows
 * in the database from quietly drifting apart.
 *
 * Naming is `module.action`, extending to `module.subject.action` where a
 * module has a genuinely separate sub-resource. The verb set is deliberately
 * closed — new modules reuse it rather than inventing synonyms:
 *
 *   view · viewAll · viewDeleted · create · update · delete · restore · export
 *
 * A handful of domain verbs exist where no generic verb would be honest.
 * `repairs.writeOff` is not `repairs.update`: scrapping hardware is a
 * different business capability with a different risk profile, and collapsing
 * the two would make it impossible to grant one without the other. The test
 * for adding a domain verb is: would an administrator ever want to grant this
 * WITHOUT granting the generic one?
 *
 * Note what is deliberately absent. Approving a request carries no permission,
 * because any signed-in person may legitimately call it — whether this
 * particular request is theirs to answer is a relationship question, decided
 * in DecideRequestHandler against the device's holder. RBAC governs whether
 * you may reach an endpoint; it does not decide whose records they are.
 */

export interface PermissionDef {
  /** Stable machine key, used in code and stored in the database. */
  key: string;
  /** Human label for the role editor's checkbox. */
  name: string;
  /** One line explaining the capability in the admin UI. */
  description: string;
  /** Top level of the permission tree. */
  module: string;
  /** Second level of the permission tree. */
  feature: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // ------------------------------------------------------------- devices
  { key: 'devices.view', module: 'Devices', feature: 'Inventory', name: 'View inventory', description: 'See the device list, a device page, its booking calendar and its history.' },
  { key: 'devices.create', module: 'Devices', feature: 'Inventory', name: 'Add a device', description: 'Put new hardware into the lab.' },
  { key: 'devices.update', module: 'Devices', feature: 'Inventory', name: 'Edit a device', description: 'Change a device’s details, status, project or squad.' },
  { key: 'devices.delete', module: 'Devices', feature: 'Inventory', name: 'Delete a device', description: 'Remove a device from circulation. Its history is kept.' },
  { key: 'devices.viewDeleted', module: 'Devices', feature: 'Archive', name: 'See deleted devices', description: 'Show deleted devices in the list.' },
  { key: 'devices.restore', module: 'Devices', feature: 'Archive', name: 'Restore a device', description: 'Bring a deleted device back into circulation.' },
  { key: 'devices.import', module: 'Devices', feature: 'Bulk load', name: 'Import from Excel', description: 'Add many devices at once from a spreadsheet.' },

  // ------------------------------------------------------------ requests
  { key: 'requests.create', module: 'Requests', feature: 'Borrowing', name: 'Ask for a device', description: 'Request a device for a project and a date range.' },
  { key: 'requests.view', module: 'Requests', feature: 'Borrowing', name: 'See your own requests', description: 'See the requests you raised and the loans you hold.' },
  { key: 'requests.viewAll', module: 'Requests', feature: 'Oversight', name: 'See everyone’s requests', description: 'See every request and loan in the lab, not only your own.' },
  { key: 'requests.decideAny', module: 'Requests', feature: 'Oversight', name: 'Decide any request', description: 'Approve or reject a request even when someone else holds the device. Recorded as an override.' },
  { key: 'requests.reschedule', module: 'Requests', feature: 'Oversight', name: 'Change booking dates', description: 'Move the dates on somebody else’s booking.' },
  { key: 'requests.checkin', module: 'Requests', feature: 'Oversight', name: 'Check a device back in', description: 'Accept a returned device and close the loan.' },
  { key: 'requests.cancelAny', module: 'Requests', feature: 'Oversight', name: 'Cancel any request', description: 'Call off somebody else’s request, giving them a reason.' },

  // ------------------------------------------------------------- repairs
  { key: 'repairs.view', module: 'Repairs', feature: 'Queue', name: 'View the repair queue', description: 'See devices reported as damaged and where they are in the process.' },
  { key: 'repairs.report', module: 'Repairs', feature: 'Queue', name: 'Report damage', description: 'Flag a device as damaged so the lab can act on it.' },
  { key: 'repairs.advance', module: 'Repairs', feature: 'Workshop', name: 'Move a repair forward', description: 'Take a repair through its next state, up to fixed.' },
  { key: 'repairs.cancel', module: 'Repairs', feature: 'Workshop', name: 'Cancel a repair', description: 'Withdraw a report made in error and clear the damage note.' },
  { key: 'repairs.writeOff', module: 'Repairs', feature: 'Disposal', name: 'Write a device off', description: 'Scrap hardware permanently. It leaves circulation for good.' },

  // ------------------------------------------------------------ projects
  { key: 'projects.view', module: 'Projects & Squads', feature: 'Grouping', name: 'View projects and squads', description: 'See the groups devices are filed under.' },
  { key: 'projects.create', module: 'Projects & Squads', feature: 'Grouping', name: 'Create a project or squad', description: 'Add a new group for devices.' },
  { key: 'projects.update', module: 'Projects & Squads', feature: 'Grouping', name: 'Rename a project or squad', description: 'Change a group’s name or description.' },
  { key: 'projects.delete', module: 'Projects & Squads', feature: 'Grouping', name: 'Delete a project or squad', description: 'Remove a group. Devices in it are not deleted.' },
  { key: 'projects.viewDeleted', module: 'Projects & Squads', feature: 'Archive', name: 'See deleted groups', description: 'Show deleted projects and squads.' },
  { key: 'projects.restore', module: 'Projects & Squads', feature: 'Archive', name: 'Restore a group', description: 'Bring a deleted project or squad back.' },

  // --------------------------------------------------------------- users
  { key: 'users.view', module: 'Users', feature: 'Directory', name: 'View the directory', description: 'See the list of accounts and who holds which device.' },
  { key: 'users.create', module: 'Users', feature: 'Directory', name: 'Add a person', description: 'Create an account and set its first password.' },
  { key: 'users.update', module: 'Users', feature: 'Directory', name: 'Edit a person', description: 'Change a name or email, deactivate an account, reset a password.' },
  { key: 'users.delete', module: 'Users', feature: 'Directory', name: 'Delete a person', description: 'Remove an account. Their history is kept.' },
  { key: 'users.viewDeleted', module: 'Users', feature: 'Archive', name: 'See deleted people', description: 'Show deleted accounts.' },
  { key: 'users.restore', module: 'Users', feature: 'Archive', name: 'Restore a person', description: 'Bring a deleted account back.' },

  // ------------------------------------------------------------ settings
  { key: 'settings.view', module: 'Settings', feature: 'Configuration', name: 'View settings', description: 'See how the lab is configured and which notifications fire.' },
  { key: 'settings.rules.update', module: 'Settings', feature: 'Configuration', name: 'Change notification rules', description: 'Decide which events send in-app alerts and which send email.' },
  { key: 'settings.email.view', module: 'Settings', feature: 'Email', name: 'View the email outbox', description: 'See queued, sent and failed email.' },
  { key: 'settings.email.retry', module: 'Settings', feature: 'Email', name: 'Retry a failed email', description: 'Put a failed message back in the queue.' },

  // ------------------------------------------------------------- reports
  { key: 'reports.view', module: 'Reports', feature: 'Dashboard', name: 'View the dashboard', description: 'See your own figures on the dashboard.' },
  { key: 'reports.viewAll', module: 'Reports', feature: 'Dashboard', name: 'See lab-wide figures', description: 'See the whole lab’s numbers and the overdue list on the dashboard.' },
  { key: 'reports.idle.view', module: 'Reports', feature: 'Utilisation', name: 'View idle devices', description: 'See which devices nobody has asked for in a long time.' },

  // --------------------------------------------------------------- audit
  { key: 'audit.view', module: 'Audit', feature: 'Log', name: 'Browse the audit log', description: 'See every recorded action, with filters.' },
  { key: 'audit.export', module: 'Audit', feature: 'Log', name: 'Export the audit log', description: 'Download the filtered log as CSV.' },

  // --------------------------------------------------------- maintenance
  { key: 'jobs.run', module: 'Maintenance', feature: 'Jobs', name: 'Run maintenance jobs', description: 'Trigger the overdue sweep and the reminder round by hand.' },

  // ------------------------------------------------------ access control
  // Held by Super Admin alone, and never grantable to a custom role. Super
  // Admin is the top of the model, so it cannot escalate itself — and a
  // custom role can never be handed these, which is what keeps
  // "can manage users" from becoming "can do anything".
  { key: 'roles.view', module: 'Access control', feature: 'Roles', name: 'View roles', description: 'See the roles that exist and what each one grants.' },
  { key: 'roles.create', module: 'Access control', feature: 'Roles', name: 'Create a role', description: 'Define a new role and choose its permissions.' },
  { key: 'roles.update', module: 'Access control', feature: 'Roles', name: 'Edit a role', description: 'Rename a role or change what it grants.' },
  { key: 'roles.delete', module: 'Access control', feature: 'Roles', name: 'Delete a role', description: 'Remove a role that nobody holds.' },
  { key: 'users.roles.assign', module: 'Access control', feature: 'Roles', name: 'Assign roles to people', description: 'Decide which roles an account holds.' },
];

/** Permissions only a Super Admin may hold — never grantable to a custom role. */
export const ACCESS_CONTROL_KEYS: string[] = PERMISSIONS.filter(
  (p) => p.module === 'Access control',
).map((p) => p.key);

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

/**
 * Permissions a role must also hold, and why.
 *
 * Every entry is traced to a real constraint in the product, not added for
 * tidiness. Most exist because the only route to an action is through a screen
 * the dependency unlocks — an Edit button that lives on a page you cannot open
 * is not a capability, it is a dead grant.
 *
 * Applied in both directions later: the role editor ticks the dependency for
 * the administrator and says why, and the API applies the same closure on save
 * so a role assembled by a direct call ends up identical to one built in the UI.
 */
export const PERMISSION_DEPENDENCIES: Record<string, string[]> = {
  // The edit and delete controls live on the device page.
  'devices.update': ['devices.view'],
  'devices.delete': ['devices.view'],
  // Restore is a button on rows that only the deleted filter shows.
  'devices.viewDeleted': ['devices.view'],
  'devices.restore': ['devices.viewDeleted'],
  // Import is bulk create; granting it alone would route around create.
  'devices.import': ['devices.create'],

  'projects.update': ['projects.view'],
  'projects.delete': ['projects.view'],
  'projects.viewDeleted': ['projects.view'],
  'projects.restore': ['projects.viewDeleted'],

  'users.update': ['users.view'],
  'users.delete': ['users.view'],
  'users.viewDeleted': ['users.view'],
  'users.restore': ['users.viewDeleted'],
  // The role picker is a column in the user table.
  'users.roles.assign': ['users.view', 'roles.view'],

  // Export applies the filters on screen — it is the same query.
  'audit.export': ['audit.view'],

  // You check devices in from the "Out now" board, which is the all view.
  'requests.checkin': ['requests.viewAll'],
  'requests.decideAny': ['requests.viewAll'],
  'requests.reschedule': ['requests.viewAll'],
  'requests.cancelAny': ['requests.viewAll'],

  'reports.viewAll': ['reports.view'],

  'settings.rules.update': ['settings.view'],
  'settings.email.retry': ['settings.email.view'],

  'roles.create': ['roles.view'],
  'roles.update': ['roles.view'],
  'roles.delete': ['roles.view'],
};

/**
 * Expand a chosen set to include everything it depends on.
 *
 * Loops until nothing new is added, so a chain (restore -> viewDeleted ->
 * view) resolves fully rather than one link deep.
 */
export function withDependencies(keys: Iterable<string>): string[] {
  const out = new Set(keys);
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of [...out]) {
      for (const needed of PERMISSION_DEPENDENCIES[key] ?? []) {
        if (!out.has(needed)) {
          out.add(needed);
          grew = true;
        }
      }
    }
  }
  return [...out];
}

/**
 * The two seeded roles. Their permission sets are fixed in code.
 *
 * There is no middle administrative tier. An earlier design kept one that ran
 * the lab but could not change who can do what; that separation was dropped
 * in favour of a single administrative role, so anyone who administers the
 * lab also administers access to it.
 */
export const SYSTEM_ROLES = {
  superAdmin: {
    name: 'Super Admin',
    description:
      'Unrestricted. Runs the lab and decides who can do what — the only role that can create roles or assign them.',
  },
  labTester: {
    name: 'Lab Tester',
    description:
      'Borrows devices, reports damage, and sees the lab’s inventory. The baseline every account starts from.',
  },
} as const;

/** What Lab Tester grants — today's `tester` role, written down. */
export const LAB_TESTER_KEYS: string[] = withDependencies([
  'devices.view',
  'requests.create',
  'requests.view',
  'repairs.view',
  'repairs.report',
  'projects.view',
  'reports.view',
]);

/** What Super Admin grants: everything, including access control. */
export const SUPER_ADMIN_KEYS: string[] = ALL_PERMISSION_KEYS;
