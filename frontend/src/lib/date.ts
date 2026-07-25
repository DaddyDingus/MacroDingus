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
