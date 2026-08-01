import { useEffect, useLayoutEffect, useRef, useState } from "react";

// A custom scroll-snap "wheel" time picker — replaces the native
// `<input type="time">` DateTimePickerSheet used to render, which on Android
// pops the OS's own dark clock-face dial (Clear/Cancel/Set chrome, a literal
// analog clock face) rather than anything this app actually designed. That
// look was called out directly as something to replace, not just restyle —
// a real in-app component gives full control over the visuals and matches
// the rest of the sheet instead of handing off to whatever the OS renders.
const ITEM_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const PAD = ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2);

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ["AM", "PM"] as const;
type Period = (typeof PERIODS)[number];

function parse24(value: string): { hour12: number; minute: number; period: Period } {
  const [hStr, mStr] = value.split(":");
  const rawHour = Number(hStr) || 0;
  const minute = Number(mStr) || 0;
  const period: Period = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 || 12;
  return { hour12, minute, period };
}

function to24(hour12: number, minute: number, period: Period): string {
  const hour = period === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// One scrollable column — a settled selection (150ms of no scroll activity)
// commits via onSettle; `index` also drives an immediate, un-debounced
// highlight (liveIndex) so the bold center item tracks the finger while
// dragging, not just once it stops.
function WheelColumn<T>({
  items,
  label,
  index,
  onSettle,
}: {
  items: readonly T[];
  label?: (item: T) => string;
  index: number;
  onSettle: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(index);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveIndex, setLiveIndex] = useState(index);

  // Keeps the column in sync when `index` changes for a reason other than
  // this column's own scroll (the other two columns committing, or the sheet
  // opening with a new initial time) — a no-op when it's already sitting at
  // that offset, which is what lets a column's own settle round-trip back
  // through this effect without visibly re-snapping itself.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastIndex.current = index;
    setLiveIndex(index);
    const target = index * ITEM_HEIGHT;
    if (el.scrollTop !== target) el.scrollTop = target;
  }, [index]);

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_HEIGHT)));
    setLiveIndex(clamped);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (clamped !== lastIndex.current) {
        lastIndex.current = clamped;
        onSettle(clamped);
      }
    }, 150);
  }

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="flex-1 h-full overflow-y-scroll no-scrollbar"
      style={{ scrollSnapType: "y mandatory", overscrollBehavior: "contain" }}
    >
      <div style={{ height: PAD }} />
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center justify-center"
          style={{ height: ITEM_HEIGHT, scrollSnapAlign: "center" }}
        >
          <span className={`text-lg tabular ${i === liveIndex ? "text-white font-semibold" : "text-white/30"}`}>
            {label ? label(item) : String(item)}
          </span>
        </div>
      ))}
      <div style={{ height: PAD }} />
    </div>
  );
}

export default function TimeWheelPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { hour12, minute, period } = parse24(value);

  return (
    <div
      className="relative rounded-md bg-dashboardCard border border-white/10 overflow-hidden"
      style={{ height: ITEM_HEIGHT * VISIBLE_ROWS }}
    >
      {/* The selected-row band sits behind the columns, at the same fixed
          vertical offset every column's center item snaps to. */}
      <div className="absolute inset-x-0 pointer-events-none" style={{ top: PAD, height: ITEM_HEIGHT }}>
        <div className="h-full mx-2 rounded-lg bg-white/[0.06] border-y border-white/15" />
      </div>

      <div className="relative h-full flex">
        <WheelColumn items={HOURS} index={HOURS.indexOf(hour12)} onSettle={(i) => onChange(to24(HOURS[i], minute, period))} />
        <WheelColumn
          items={MINUTES}
          label={(m) => String(m).padStart(2, "0")}
          index={minute}
          onSettle={(i) => onChange(to24(hour12, MINUTES[i], period))}
        />
        <WheelColumn items={PERIODS} index={PERIODS.indexOf(period)} onSettle={(i) => onChange(to24(hour12, minute, PERIODS[i]))} />
      </div>

      {/* Top/bottom fades hint that more items scroll into view, rather than
          the column just looking like it stops dead at the visible edge. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-dashboardCard to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-dashboardCard to-transparent" />
    </div>
  );
}
