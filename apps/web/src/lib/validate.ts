/** Per-type validation rules. A rule returns null when the value is fine,
 * or the message to show under the field. Empty values pass unless
 * `required` is in the list — so optional fields validate only when filled. */
export type Rule = (v: string) => string | null;

export const required =
  (msg = 'This field is required'): Rule =>
  (v) =>
    v.trim() ? null : msg;

export const minLen =
  (n: number, what = 'characters'): Rule =>
  (v) =>
    !v.trim() || v.trim().length >= n ? null : `At least ${n} ${what}`;

export const email = (): Rule => (v) =>
  !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
    ? null
    : 'Enter a valid email, like name@company.com';

export const password = (): Rule => (v) =>
  !v || (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v))
    ? null
    : 'At least 8 characters, with letters and numbers';

export const imei = (): Rule => (v) =>
  !v || /^\d{8,20}$/.test(v) ? null : 'IMEI is 8–20 digits, numbers only';

export const serial = (): Rule => (v) =>
  !v || /^[A-Za-z0-9-]{4,}$/.test(v)
    ? null
    : 'Letters and numbers only, at least 4, no spaces';

export const year = (): Rule => (v) =>
  !v || (/^\d{4}$/.test(v) && +v >= 1990 && +v <= 2100)
    ? null
    : 'A four-digit year, like 2024';

export function runRules(rules: Rule[], value: string): string | null {
  for (const rule of rules) {
    const err = rule(value);
    if (err) return err;
  }
  return null;
}
