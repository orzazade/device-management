/**
 * Field-level audit diff (the Stripe/GitHub pattern): one row per changed
 * field — label, old value struck through in red, arrow, new value in green.
 * Raw JSON never reaches the reader's eyes.
 */

const label = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

function human(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (Array.isArray(v)) return v.length ? v.map(human).join(', ') : '—';
  if (typeof v === 'object') return Object.values(v as object).map(human).join(', ');
  return String(v).replace(/_/g, ' ');
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// Bare UUIDs mean nothing to a reader — drop those fields from the view.
const isUuid = (v: unknown) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function OldChip({ v }: { v: string }) {
  return (
    <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-400">
      {v}
    </span>
  );
}

function NewChip({ v }: { v: string }) {
  return <span className="rounded-md bg-green-50 px-1.5 py-0.5 font-semibold text-green-800">{v}</span>;
}

export default function ChangeDiff({
  oldValue,
  newValue,
}: {
  oldValue: unknown;
  newValue: unknown;
}) {
  // Both sides are objects → field-by-field diff rows.
  if (isObj(newValue) || isObj(oldValue)) {
    const o = isObj(oldValue) ? oldValue : {};
    const n = isObj(newValue) ? newValue : {};
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter(
      (k) => k !== 'link' && !isUuid(o[k]) && !isUuid(n[k]),
    );
    return (
      <div className="flex flex-col gap-1">
        {keys.map((k) => {
          const before = k in o ? human(o[k]) : null;
          const after = k in n ? human(n[k]) : null;
          return (
            <div key={k} className="flex flex-wrap items-center gap-1.5">
              <span className="text-neutral-500">{label(k)}:</span>
              {before !== null && after !== null && before !== after ? (
                <>
                  <OldChip v={before} />
                  <span className="text-neutral-400">→</span>
                  <NewChip v={after} />
                </>
              ) : after !== null ? (
                <NewChip v={after} />
              ) : (
                <OldChip v={before!} />
              )}
            </div>
          );
        })}
        {keys.length === 0 && <span className="text-neutral-400">—</span>}
      </div>
    );
  }

  // Scalars (or nothing) — still no raw JSON.
  const before = oldValue == null ? null : human(oldValue);
  const after = newValue == null ? null : human(newValue);
  if (before === null && after === null) return <span className="text-neutral-400">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {before !== null && <OldChip v={before} />}
      {before !== null && after !== null && <span className="text-neutral-400">→</span>}
      {after !== null && <NewChip v={after} />}
    </span>
  );
}
