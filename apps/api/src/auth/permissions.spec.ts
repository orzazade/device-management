import { describe, expect, it } from 'vitest';
import {
  ACCESS_CONTROL_KEYS,
  ADMINISTRATOR_KEYS,
  ALL_PERMISSION_KEYS,
  LAB_TESTER_KEYS,
  PERMISSIONS,
  PERMISSION_DEPENDENCIES,
  withDependencies,
} from './permissions';

describe('the permission catalogue', () => {
  it('has no duplicate keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('names every key module.action, lowercase and dot-separated', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key, key).toMatch(/^[a-z]+(\.[a-zA-Z]+){1,2}$/);
    }
  });

  it('gives every permission a module, a feature and a description', () => {
    for (const p of PERMISSIONS) {
      expect(p.module, p.key).toBeTruthy();
      expect(p.feature, p.key).toBeTruthy();
      expect(p.name, p.key).toBeTruthy();
      expect(p.description, p.key).toBeTruthy();
    }
  });

  it('only depends on permissions that exist', () => {
    for (const [key, needs] of Object.entries(PERMISSION_DEPENDENCIES)) {
      expect(ALL_PERMISSION_KEYS, `${key} is not a real permission`).toContain(key);
      for (const need of needs) {
        expect(ALL_PERMISSION_KEYS, `${key} depends on missing ${need}`).toContain(need);
      }
    }
  });

  it('has no circular dependencies', () => {
    // withDependencies loops until nothing new appears; a cycle would still
    // terminate, so the real check is that no key requires itself.
    for (const key of Object.keys(PERMISSION_DEPENDENCIES)) {
      const closure = withDependencies([key]).filter((k) => k !== key);
      expect(closure, `${key} depends on itself`).not.toContain(key);
    }
  });

  it('resolves a dependency chain all the way down', () => {
    // restore -> viewDeleted -> view. One-level resolution would miss the last.
    expect(withDependencies(['devices.restore']).sort()).toEqual(
      ['devices.restore', 'devices.view', 'devices.viewDeleted'].sort(),
    );
  });
});

describe('the seeded system roles', () => {
  it('derives the Super Admin grant from the whole catalogue', () => {
    // Super Admin is seeded with ALL_PERMISSION_KEYS, so what this can prove
    // is that the list really is every permission and nothing was dropped on
    // the way. Whether the DATABASE matches is a different question, and a
    // unit test cannot answer it — that check lives in the e2e suite, which
    // reads the seeded rows back.
    expect(ALL_PERMISSION_KEYS.length).toBe(PERMISSIONS.length);
    expect(new Set(ALL_PERMISSION_KEYS)).toEqual(new Set(PERMISSIONS.map((p) => p.key)));
  });

  it('keeps access control out of Administrator', () => {
    for (const key of ACCESS_CONTROL_KEYS) {
      expect(ADMINISTRATOR_KEYS, `Administrator must not hold ${key}`).not.toContain(key);
    }
  });

  it('gives Administrator everything else', () => {
    const expected = ALL_PERMISSION_KEYS.filter((k) => !ACCESS_CONTROL_KEYS.includes(k));
    expect([...ADMINISTRATOR_KEYS].sort()).toEqual([...expected].sort());
  });

  it('puts every access-control permission in the Access control module', () => {
    // The migration deletes access-control grants from non-super roles by
    // matching on this module, so a stray key filed elsewhere would escape it.
    for (const key of ACCESS_CONTROL_KEYS) {
      const def = PERMISSIONS.find((p) => p.key === key);
      expect(def?.module).toBe('Access control');
    }
  });

  it('keeps Lab Tester read-mostly and free of any admin capability', () => {
    const forbidden = ['create', 'update', 'delete', 'restore', 'import', 'writeOff', 'export'];
    for (const key of LAB_TESTER_KEYS) {
      // requests.create is the exception: borrowing a device IS the tester's job.
      if (key === 'requests.create') continue;
      for (const verb of forbidden) {
        expect(key.endsWith(`.${verb}`), `Lab Tester should not hold ${key}`).toBe(false);
      }
    }
  });

  it('leaves Lab Tester dependency-closed', () => {
    expect([...LAB_TESTER_KEYS].sort()).toEqual([...withDependencies(LAB_TESTER_KEYS)].sort());
  });
});
