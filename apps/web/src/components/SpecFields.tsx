import { useState } from 'react';
import { SPEC_SUGGESTIONS, specsToPairs, type SpecPair } from '../lib/specs';

/** Free key/value spec rows — same block in Add device and Edit device.
 * Inputs are named spec_k_N / spec_v_N; collectSpecs() reads them back. */
type Row = SpecPair & { id: number };
let nextId = 1;

export default function SpecFields({ specs }: { specs?: Record<string, unknown> }) {
  // Inputs are uncontrolled, so each row needs a stable id as its React key —
  // an index key would hand a deleted row's typed text to its neighbour.
  const [rows, setRows] = useState<Row[]>(() => {
    const init = specsToPairs(specs).map((p) => ({ ...p, id: nextId++ }));
    return init.length ? init : [{ key: '', value: '', id: nextId++ }];
  });
  const input =
    'w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-accent focus:outline-none';

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="mb-2 flex items-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Specs</p>
        <span className="ml-2 text-xs text-neutral-400">any name, any value — optional</span>
      </div>
      <datalist id="spec-names">
        {SPEC_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div key={r.id} className="flex gap-1.5">
            <input
              name={`spec_k_${i}`}
              list="spec-names"
              placeholder="Name (e.g. RAM)"
              defaultValue={r.key}
              className={`${input} max-w-[40%]`}
            />
            <input
              name={`spec_v_${i}`}
              placeholder="Value (e.g. 8 GB)"
              defaultValue={r.value}
              className={input}
            />
            <button
              type="button"
              aria-label="Remove spec"
              onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}
              className="shrink-0 rounded-lg border border-neutral-300 px-2.5 text-neutral-500 hover:bg-white"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRows((x) => [...x, { key: '', value: '', id: nextId++ }])}
        className="mt-2 text-sm font-semibold text-accent"
      >
        + Add spec
      </button>
    </div>
  );
}
