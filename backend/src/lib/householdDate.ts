const HOUSEHOLD_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || "Australia/Brisbane";

const householdDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOUSEHOLD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Calendar dates in this app belong to the household, not to UTC. Keep the
// configured timezone at this one boundary; date arithmetic on the resulting
// YYYY-MM-DD strings remains UTC-based everywhere else.
export function householdDateString(date = new Date()): string {
  const parts = householdDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error(`Couldn't format date in ${HOUSEHOLD_TIME_ZONE}`);
  return `${year}-${month}-${day}`;
}
