/**
 * Calendar-day helpers.
 *
 * Booking dates (`from_date`, `to_date`) are plain calendar days in the
 * lab's own timezone — they are what a person wrote on a form, not moments
 * in time. Comparing them against `new Date().toISOString()` compares a local
 * day against a UTC one, and those disagree for as many hours as the offset:
 * in Baku (UTC+4) every day between 00:00 and 04:00 local. During that window
 * a booking starting today looks like it starts tomorrow.
 *
 * Postgres already answers CURRENT_DATE in the server's zone, so using the
 * local day here keeps the API, the database and the user in agreement.
 */

/** The given moment (default: now) as a local `YYYY-MM-DD` calendar day. */
export function localDay(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The local calendar day `days` away from now — negative looks backwards. */
export function localDayOffset(days: number): string {
  return localDay(new Date(Date.now() + days * 86400000));
}
