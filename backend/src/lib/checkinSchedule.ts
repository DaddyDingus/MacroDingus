import { addDaysToDateString } from "../engine/trendWeight.js";

function dayOfWeekUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Floor on how short a check-in cycle may get. In steady state this is inert
// (consecutive occurrences of the same weekday are 7 days apart regardless);
// it exists for the one case that can produce a shorter gap — *changing* the
// check-in weekday, which re-aims the next due date at a different day of the
// same week and could otherwise land it a day or two after the check-in you
// just did. That's a cycle with essentially no new data in it: the adaptive
// TDEE window is 21 days and the trend EWMA is alpha 0.1, so both come back
// with the previous answer, targets regenerate off nothing, and it spends a
// paid narrative call to say so. (Confirmed live on 2026-08-10 — a Sunday
// check-in followed by a switch to Monday produced a second check-in the next
// day whose narrative opened "Only 1 day has passed since the last check-in".)
//
// 4 rather than 7 deliberately: 7 would make a day change defer the next
// check-in by up to 13 days, whereas this keeps every cycle inside 4–10 days
// while still killing the 1–3 day case.
export const MIN_CHECKIN_CYCLE_DAYS = 4;

// The date the next check-in becomes due, given the last completed
// check-in's date. With no fixed weekday chosen (checkInDayOfWeek === null)
// it's a rolling 7-day cycle from that check-in. With a fixed weekday, it's
// the first occurrence of that weekday at least MIN_CHECKIN_CYCLE_DAYS after
// the last check-in — so picking "Sunday" pins every future check-in to a
// Sunday, not to "7 days after whenever you happened to last check in" (the
// two only coincide if the last check-in itself landed on that weekday).
export function nextCheckinDueDate(lastCheckinDate: string, checkInDayOfWeek: number | null): string {
  if (checkInDayOfWeek === null) return addDaysToDateString(lastCheckinDate, 7);
  let due = addDaysToDateString(lastCheckinDate, MIN_CHECKIN_CYCLE_DAYS);
  while (dayOfWeekUtc(due) !== checkInDayOfWeek) due = addDaysToDateString(due, 1);
  return due;
}
