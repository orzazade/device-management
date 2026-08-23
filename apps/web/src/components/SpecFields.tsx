import { SPEC_FIELDS, SPEC_SECTIONS } from '../lib/specs';
import { year, type Rule } from '../lib/validate';
import { VField } from './VForm';

const SPEC_RULES: Record<string, Rule[]> = { releaseYear: [year()] };

/** The spec form block — same fields in Add device and Edit device. */
export default function SpecFields({ specs = {} }: { specs?: Record<string, unknown> }) {
  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Specs
      </p>
      {SPEC_SECTIONS.map((section) => {
        const fields = SPEC_FIELDS.filter((d) => d.section === section);
        return (
          <div key={section} className="mb-3 last:mb-0">
            <p className="mb-1.5 text-xs font-semibold text-neutral-400">{section}</p>
            <div className="grid grid-cols-2 gap-2">
              {fields
                .filter((d) => d.type === 'text')
                .map((d) => (
                  <VField
                    key={d.key}
                    name={`spec_${d.key}`}
                    label={d.label}
                    defaultValue={specs[d.key] == null ? '' : String(specs[d.key])}
                    placeholder={d.placeholder}
                    rules={SPEC_RULES[d.key] ?? []}
                    className={d.key === 'notes' ? 'col-span-2' : ''}
                  />
                ))}
            </div>
            {fields.some((d) => d.type === 'bool') && (
              <div className="mt-1.5 flex flex-wrap gap-4">
                {fields
                  .filter((d) => d.type === 'bool')
                  .map((d) => (
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
            )}
          </div>
        );
      })}
    </div>
  );
}
