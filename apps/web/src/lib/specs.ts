/** Specs are free key/value pairs — the lab decides what matters per device.
 * Stored as { "RAM": "8 GB", "5G": "yes" }; keys are the labels people typed. */
export interface SpecPair {
  key: string;
  value: string;
}

/** Offered as autocomplete so common names stay consistent across devices. */
export const SPEC_SUGGESTIONS = [
  'RAM', 'Storage', 'Screen', 'Chipset', 'Battery', '5G', 'eSIM', 'NFC', 'Color', 'Notes',
];

export function specsToPairs(specs: Record<string, unknown> | undefined): SpecPair[] {
  return Object.entries(specs ?? {}).map(([key, v]) => ({
    key,
    value: v === true ? 'yes' : v === false ? 'no' : v == null ? '' : String(v),
  }));
}

/** Reads spec_k_N / spec_v_N inputs from a submitted form. Empty names are
 * dropped; a name with no value is kept as '' so "has NFC" style flags work. */
export function collectSpecs(f: FormData): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const [name, raw] of f.entries()) {
    const m = /^spec_k_(\d+)$/.exec(name);
    if (!m) continue;
    const key = String(raw).trim();
    if (!key) continue;
    specs[key] = String(f.get(`spec_v_${m[1]}`) ?? '').trim();
  }
  return specs;
}
