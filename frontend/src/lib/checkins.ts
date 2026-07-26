import type { Checkin } from "../api/coach";

// Which check-in's targets were "current" on a given date. Check-ins are
// sparse (one per check-in event, not one per day) and small in count even
// over years, and `useCheckinHistory()` already fetches the full unbounded
// history, so this is a plain client-side lookup — no backend join needed.
export function activeCheckinForDate(checkins: Checkin[], date: string): Checkin | null {
  let active: Checkin | null = null;
  for (const c of checkins) {
    if (c.date > date) continue;
    if (!active || c.date > active.date) active = c;
  }
  return active;
}
