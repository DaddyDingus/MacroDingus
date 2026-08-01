import { addDaysToDateString } from "../engine/trendWeight.js";

function dayOfWeekUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The date the next check-in becomes due, given the last completed
// check-in's date. With no fixed weekday chosen (checkInDayOfWeek === null)
// it's a rolling 7-day cycle from that check-in. With a fixed weekday, it's
// the next occurrence of that weekday strictly after the last check-in — so
// picking "Sunday" pins every future check-in to a Sunday, not to "7 days
// after whenever you happened to last check in" (the two only coincide if
// the last check-in itself landed on that weekday).
export function nextCheckinDueDate(lastCheckinDate: string, checkInDayOfWeek: number | null): string {
  if (checkInDayOfWeek === null) return addDaysToDateString(lastCheckinDate, 7);
  let due = addDaysToDateString(lastCheckinDate, 1);
  while (dayOfWeekUtc(due) !== checkInDayOfWeek) due = addDaysToDateString(due, 1);
  return due;
}
