/** One source of truth for device specs — the form, the detail page, and
 * future filters all read this list. Adding a spec = adding one line. */
export interface SpecDef {
  key: string;
  label: string;
  type: 'text' | 'bool';
  section: 'Hardware' | 'Display' | 'Connectivity' | 'Other';
  placeholder?: string;
}

export const SPEC_FIELDS: SpecDef[] = [
  { key: 'chipset', label: 'Chipset', type: 'text', section: 'Hardware', placeholder: 'Snapdragon 8 Gen 3' },
  { key: 'ram', label: 'RAM', type: 'text', section: 'Hardware', placeholder: '12 GB' },
  { key: 'storage', label: 'Storage', type: 'text', section: 'Hardware', placeholder: '256 GB' },
  { key: 'battery', label: 'Battery', type: 'text', section: 'Hardware', placeholder: '5000 mAh' },
  { key: 'screenSize', label: 'Screen size', type: 'text', section: 'Display', placeholder: '6.7"' },
  { key: 'resolution', label: 'Resolution', type: 'text', section: 'Display', placeholder: '1440 × 3120' },
  { key: 'refreshRate', label: 'Refresh rate', type: 'text', section: 'Display', placeholder: '120 Hz' },
  { key: 'fiveG', label: '5G', type: 'bool', section: 'Connectivity' },
  { key: 'nfc', label: 'NFC', type: 'bool', section: 'Connectivity' },
  { key: 'esim', label: 'eSIM', type: 'bool', section: 'Connectivity' },
  { key: 'wifi', label: 'Wi-Fi', type: 'text', section: 'Connectivity', placeholder: 'Wi-Fi 7' },
  { key: 'bluetooth', label: 'Bluetooth', type: 'text', section: 'Connectivity', placeholder: '5.4' },
  { key: 'fingerprint', label: 'Fingerprint', type: 'bool', section: 'Other' },
  { key: 'faceUnlock', label: 'Face unlock', type: 'bool', section: 'Other' },
  { key: 'releaseYear', label: 'Release year', type: 'text', section: 'Other', placeholder: '2024' },
  { key: 'color', label: 'Color', type: 'text', section: 'Other', placeholder: 'Black' },
  { key: 'notes', label: 'Notes', type: 'text', section: 'Other', placeholder: 'Anything testers should know' },
];

export const SPEC_SECTIONS = ['Hardware', 'Display', 'Connectivity', 'Other'] as const;

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
