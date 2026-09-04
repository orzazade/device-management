import { useEffect, useRef } from 'react';

export interface PermissionNode {
  key: string;
  name: string;
  description: string;
}
export interface FeatureNode {
  feature: string;
  permissions: PermissionNode[];
}
export interface ModuleNode {
  module: string;
  features: FeatureNode[];
}
export interface Catalogue {
  modules: ModuleNode[];
  /** key -> the permissions it cannot work without. */
  dependencies: Record<string, string[]>;
  /** Keys no custom role may hold; rendered but not selectable. */
  reserved: string[];
}

/**
 * A checkbox that can also say "some of the things under me are ticked".
 *
 * Indeterminate is a DOM property, not an attribute or a class, so it has to
 * be set imperatively. Faking it with a dash-shaped icon would look right and
 * announce wrong: a screen reader reads the real property as "partially
 * checked", and a look-alike as plain "unchecked".
 */
function TriCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      data-testid={testId}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="mt-0.5 h-4 w-4 flex-none disabled:opacity-40"
    />
  );
}

/**
 * The permission picker.
 *
 * Selection is closed under dependencies in both directions. Ticking Edit
 * silently granting View would be alarming, and refusing to save with a
 * validation error would be annoying — so it ticks the dependency and says
 * why. Unticking works the same way in reverse: without cascading, the
 * server's closure would put the permission straight back and the checkbox
 * would appear to ignore the click.
 */
export default function PermissionTree({
  catalogue,
  selected,
  onChange,
  readOnly = false,
}: {
  catalogue: Catalogue;
  selected: Set<string>;
  onChange: (next: Set<string>, note: string | null) => void;
  readOnly?: boolean;
}) {
  const { dependencies, reserved } = catalogue;
  const label = (key: string) => {
    for (const m of catalogue.modules)
      for (const f of m.features) {
        const p = f.permissions.find((x) => x.key === key);
        if (p) return p.name;
      }
    return key;
  };

  /** Everything `key` needs, transitively. */
  const needs = (key: string): string[] => {
    const out = new Set<string>();
    const walk = (k: string) => {
      for (const dep of dependencies[k] ?? []) {
        if (!out.has(dep)) {
          out.add(dep);
          walk(dep);
        }
      }
    };
    walk(key);
    return [...out];
  };

  /** Everything that would break if `key` went away. */
  const dependents = (key: string): string[] =>
    Object.keys(dependencies).filter((k) => needs(k).includes(key));

  const apply = (keys: string[], turnOn: boolean) => {
    const next = new Set(selected);
    const added: string[] = [];
    const removed: string[] = [];
    for (const key of keys) {
      if (reserved.includes(key)) continue;
      if (turnOn) {
        if (!next.has(key)) next.add(key);
        for (const dep of needs(key)) {
          if (!next.has(dep) && !reserved.includes(dep)) {
            next.add(dep);
            added.push(dep);
          }
        }
      } else {
        next.delete(key);
        for (const dep of dependents(key)) {
          if (next.has(dep)) {
            next.delete(dep);
            removed.push(dep);
          }
        }
      }
    }
    const note = added.length
      ? `${added.map(label).join(', ')} ${added.length === 1 ? 'was' : 'were'} enabled too — the option above needs ${added.length === 1 ? 'it' : 'them'}.`
      : removed.length
        ? `${removed.map(label).join(', ')} ${removed.length === 1 ? 'was' : 'were'} switched off too — ${removed.length === 1 ? 'it does' : 'they do'} not work without it.`
        : null;
    onChange(next, note);
  };

  const state = (keys: string[]) => {
    const grantable = keys.filter((k) => !reserved.includes(k));
    const on = grantable.filter((k) => selected.has(k));
    return {
      checked: grantable.length > 0 && on.length === grantable.length,
      some: on.length > 0,
      grantable,
    };
  };

  return (
    <div data-testid="permission-tree" className="flex flex-col gap-4">
      {catalogue.modules.map((mod) => {
        const keys = mod.features.flatMap((f) => f.permissions.map((p) => p.key));
        const m = state(keys);
        const allReserved = keys.every((k) => reserved.includes(k));
        return (
          <div key={mod.module} className="rounded-xl border border-neutral-200 bg-white p-4">
            <label className="flex items-start gap-2.5 font-bold">
              <TriCheckbox
                testId={`module-${mod.module}`}
                label={mod.module}
                checked={m.checked}
                indeterminate={m.some}
                disabled={readOnly || allReserved}
                // Clicking a partly-ticked parent selects all: when somebody
                // is building a role up, that is nearly always the intent.
                onChange={() => apply(m.grantable, !m.checked)}
              />
              <span>
                {mod.module}
                {allReserved && (
                  <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">
                    Super Admin only
                  </span>
                )}
              </span>
            </label>

            {mod.features.map((feat) => {
              const fkeys = feat.permissions.map((p) => p.key);
              const f = state(fkeys);
              return (
                <div key={feat.feature} className="mt-3 pl-6">
                  <label className="flex items-start gap-2.5 text-sm font-semibold text-neutral-600">
                    <TriCheckbox
                      // Three modules have a feature called "Archive", so the
                      // module has to be part of the id for it to identify one box.
                      testId={`feature-${mod.module}-${feat.feature}`}
                      label={`${mod.module} — ${feat.feature}`}
                      checked={f.checked}
                      indeterminate={f.some}
                      disabled={readOnly || !f.grantable.length}
                      onChange={() => apply(f.grantable, !f.checked)}
                    />
                    {feat.feature}
                  </label>
                  <div className="mt-1.5 flex flex-col gap-1.5 pl-6">
                    {feat.permissions.map((p) => {
                      const locked = reserved.includes(p.key);
                      return (
                        <label
                          key={p.key}
                          className="flex items-start gap-2.5"
                          title={p.description}
                        >
                          <TriCheckbox
                            testId={`perm-${p.key}`}
                            label={p.name}
                            checked={selected.has(p.key)}
                            disabled={readOnly || locked}
                            onChange={() => apply([p.key], !selected.has(p.key))}
                          />
                          <span className={locked ? 'text-neutral-400' : ''}>
                            {p.name}
                            <span className="ml-2 font-mono text-xs text-neutral-400">
                              {p.key}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
