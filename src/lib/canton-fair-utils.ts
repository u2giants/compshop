/**
 * Canton Fair session utilities.
 *
 * Canton Fair runs two sessions every year on fixed dates:
 *   Phase 1 (Spring): April 23 – 27
 *   Phase 2 (Autumn): October 23 – 27
 */

export interface CantonFairSession {
  label: string; // e.g. "Canton Fair Spring 2026"
  year: number;
  phase: "spring" | "autumn";
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

/** Return the Canton Fair session a date falls into, or null if it doesn't. */
export function getCantonFairSession(dateStr: string): CantonFairSession | null {
  const d = new Date(dateStr + "T12:00:00"); // noon to avoid TZ issues
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-indexed
  const day = d.getDate();

  if (month === 4 && day >= 23 && day <= 27) {
    return {
      label: `Canton Fair Spring ${year}`,
      year,
      phase: "spring",
      startDate: `${year}-04-23`,
      endDate: `${year}-04-27`,
    };
  }

  if (month === 10 && day >= 23 && day <= 27) {
    return {
      label: `Canton Fair Autumn ${year}`,
      year,
      phase: "autumn",
      startDate: `${year}-10-23`,
      endDate: `${year}-10-27`,
    };
  }

  return null;
}

/** Build a unique key for a session so we can group photos. */
export function sessionKey(session: CantonFairSession): string {
  return `${session.year}-${session.phase}`;
}
