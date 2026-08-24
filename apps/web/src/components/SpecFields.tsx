import { SPEC_FIELDS } from '../lib/specs';
import { VField } from './VForm';

/** The spec form block — same fields in Add device and Edit device. */
export default function SpecFields({ specs = {} }: { specs?: Record<string, unknown> }) {
  const text = SPEC_FIELDS.filter((d) => d.type === 'text');
  const bools = SPEC_FIELDS.filter((d) => d.type === 'bool');
  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Specs
      </p>
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
        {text.map((d) => (
          <VField
            key={d.key}
            name={`spec_${d.key}`}
            label={d.label}
            defaultValue={specs[d.key] == null ? '' : String(specs[d.key])}
            placeholder={d.placeholder}
            className={d.key === 'notes' ? 'col-span-full' : ''}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4">
        {bools.map((d) => (
          <label key={d.key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name={`spec_${d.key}`}
              defaultChecked={specs[d.key] === true}
            />
            {d.label}
          </label>
        ))}
      </div>
    </div>
  );
}
