const pad = (n: number) => String(n).padStart(2, "0");

export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTimeString(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The backend buckets "time of day" by reading the hour straight out of loggedAt
// with SQLite's strftime. There's exactly one user on one phone, so rather than
// store true UTC and convert both ends, we write local wall-clock numbers into
// an ISO-shaped string — simpler than timezone math, and correct for this app.
export function localIsoNoTz(d = new Date()): string {
  return `${localDateString(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000Z`;
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return localDateString(dt);
}

// UTC-based so a server-timezone-dependent off-by-one never creeps in here
// the way it could with plain Date subtraction — same reasoning as the
// trend-weight engine's date math.
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split("-").map(Number);
  const [ty, tm, td] = toDateStr.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

// loggedAt is a fake-UTC ISO string that's actually local wall-clock time
// (see localIsoNoTz above) — pull the hour/minute out directly rather than
// going through `Date`, which would apply a real UTC-to-local conversion and
// shift the displayed time by the browser's timezone offset.
export function formatLogTime(loggedAt: string): string {
  const match = loggedAt.match(/T(\d{2}):(\d{2})/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

// Raw "HH:MM" out of a loggedAt string, for prefilling a time picker or
// reusing an entry's original time-of-day when copying/moving it elsewhere —
// same fake-UTC-is-actually-local reasoning as formatLogTime above, just
// without the 12-hour formatting.
export function loggedAtTimeString(loggedAt: string): string {
  const match = loggedAt.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "00:00";
}

// Inverse of loggedAtTimeString — builds a loggedAt string from a plain date
// + "HH:MM", in the same fake-UTC-but-really-local shape localIsoNoTz produces.
export function buildLoggedAt(dateStr: string, time: string): string {
  return `${dateStr}T${time}:00.000Z`;
}

// Which hour bucket (0-23) a loggedAt string falls into — see
// groupLogEntriesByTime in logGrouping.ts. Same fake-UTC-is-actually-local
// extraction as formatLogTime above.
export function hourOfLoggedAt(loggedAt: string): number {
  const match = loggedAt.match(/T(\d{2}):/);
  return match ? Number(match[1]) : 0;
}

// "10 AM" / "11 PM" label for a calendar-hour bucket (0-23) — TimeBlockGroup's
// header chip is one per hour, not the exact timestamp of its first entry.
export function formatHourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h} ${suffix}`;
}

// Same extraction as formatLogTime, minus the AM/PM suffix — each food row
// shows its own exact time nested under a group header that already
// establishes AM/PM via formatHourLabel above.
export function formatLogTimeShort(loggedAt: string): string {
  const match = loggedAt.match(/T(\d{2}):(\d{2})/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2];
  hour = hour % 12 || 12;
  return `${hour}:${minute}`;
}

// Same fake-UTC-is-actually-local regex extraction as the helpers above —
// for bucketing a day's log entries by hour of day (Nutrient Timing chart).
// Must not go through `new Date(loggedAt).getHours()`, which would apply a
// real UTC-to-local conversion and shift every bucket by the browser's
// timezone offset.
export function hourFromLoggedAt(loggedAt: string): number {
  const match = loggedAt.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) : 0;
}

// Numeric day-index (days since the epoch), for charts that need a real
// linear/time-scaled X axis instead of Recharts' default categorical
// index-spacing — required once a series can have gap days (a categorical
// axis would space a gap day's neighbors as if they were adjacent). Inverse
// is just addDays(EPOCH, index).
const EPOCH = "1970-01-01";
export function dayIndex(dateStr: string): number {
  return daysBetween(EPOCH, dateStr);
}
export function dateFromDayIndex(index: number): string {
  return addDays(EPOCH, index);
}

export function formatDayLabel(dateStr: string): string {
  const today = localDateString();
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  if (dateStr === addDays(today, 1)) return "Tomorrow";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
