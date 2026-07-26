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

function minutesSinceMidnight(loggedAt: string): number {
  const match = loggedAt.match(/T(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesBetweenLoggedAt(a: string, b: string): number {
  return Math.abs(minutesSinceMidnight(b) - minutesSinceMidnight(a));
}

export function formatDayLabel(dateStr: string): string {
  const today = localDateString();
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
