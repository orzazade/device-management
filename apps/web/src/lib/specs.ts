/** One source of truth for device specs — the form, the detail page, the
 * list line and the Excel importer all read this list. Deliberately short:
 * only what decides which phone a tester picks. */
export interface SpecDef {
  key: string;
  label: string;
  type: 'text' | 'bool';
  placeholder?: string;
}

export const SPEC_FIELDS: SpecDef[] = [
  { key: 'ram', label: 'RAM', type: 'text', placeholder: '12 GB' },
  { key: 'storage', label: 'Storage', type: 'text', placeholder: '256 GB' },
  { key: 'screenSize', label: 'Screen size', type: 'text', placeholder: '6.7"' },
  { key: 'fiveG', label: '5G', type: 'bool' },
  { key: 'esim', label: 'eSIM', type: 'bool' },
  { key: 'nfc', label: 'NFC', type: 'bool' },
  { key: 'notes', label: 'Notes', type: 'text', placeholder: 'Anything testers should know' },
];

/** Reads spec_* inputs from a submitted form into a clean specs object. */
export function collectSpecs(f: FormData): Record<string, unknown> {
  const specs: Record<string, unknown> = {};
  for (const def of SPEC_FIELDS) {
    if (def.type === 'bool') {
      if (f.get(`spec_${def.key}`) === 'on') specs[def.key] = true;
    } else {
      const v = String(f.get(`spec_${def.key}`) ?? '').trim();
      if (v) specs[def.key] = v;
    }
  }
  return specs;
}
