import type { Checkin } from "../api/coach";

// Which check-in's targets were "current" on a given date. Check-ins are
// sparse (one per check-in event, not one per day) and small in count even
// over years, and `useCheckinHistory()` already fetches the full unbounded
// history, so this is a plain client-side lookup — no backend join needed.
// Same-day tiebreak on createdAt (not just c.date > active.date, which never
// fires for a tie): performCheckin() runs on every profile save as well as
// the explicit "check in" button, so two-plus check-ins on the same calendar
// day are a real, common case, not an edge case — without the tiebreak,
// which of them "won" depended on whatever order the caller's array
// happened to be in.
export function activeCheckinForDate(checkins: Checkin[], date: string): Checkin | null {
  let active: Checkin | null = null;
  for (const c of checkins) {
    if (c.date > date) continue;
    if (!active || c.date > active.date || (c.date === active.date && c.createdAt > active.createdAt)) active = c;
  }
  return active;
}

// Collapses same-day check-ins down to the latest one per calendar day —
// for views that plot/list check-ins directly (TdeeChart, the Expenditure
// screen's history) rather than looking one up for a specific date, so a
// day with several profile-save-triggered check-ins doesn't render as
// several stacked points/rows for that single day. Input order doesn't
// matter; output is date-ascending.
export function latestPerDayCheckins(checkins: Checkin[]): Checkin[] {
  const byDate = new Map<string, Checkin>();
  for (const c of checkins) {
    const existing = byDate.get(c.date);
    if (!existing || c.createdAt > existing.createdAt) byDate.set(c.date, c);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
