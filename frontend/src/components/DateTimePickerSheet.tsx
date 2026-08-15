import { useState } from "react";
import BottomSheet from "./BottomSheet";
import TimeWheelPicker from "./TimeWheelPicker";
import CalendarJumpSheet from "./CalendarJumpSheet";
import { formatDayLabel } from "../lib/date";

// Shared by two Food Log flows: "modify timestamp" (mode="time", the date
// row is hidden — that action only ever changes the time-of-day an entry
// keeps on its existing day) and "to date & time" under copy/move/log-time
// (mode "datetime", both shown). Date opens the app's own CalendarJumpSheet
// as a nested sheet rather than a native <input type="date"> — the OS picker
// broke the app's visual language (system chrome popping over a dark sheet)
// and, unlike CalendarJumpSheet, can't show which days already have entries.
// Time is the OS picker this app replaces for a different reason: the native
// <input type="time"> (an analog clock-face dial on Android) was explicitly
// called out as something to replace, not just live with, so it uses the
// in-app TimeWheelPicker instead — see that component's own comment.
export default function DateTimePickerSheet({
  mode,
  title,
  confirmLabel = "Confirm",
  initialDate,
  initialTime,
  onConfirm,
  onClose,
}: {
  mode: "time" | "datetime";
  title: string;
  confirmLabel?: string;
  initialDate: string;
  initialTime: string;
  onConfirm: (date: string, time: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [calendarOpen, setCalendarOpen] = useState(false);

  function confirm() {
    onConfirm(date, time);
  }

  return (
    <>
      <BottomSheet
        onClose={onClose}
        backdropClassName="bg-black/60"
        panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
      >
        {(dragHandlers) => (
          <>
        {/* No Close button — swipe-down (the grabber, or this header) or a tap
            on the backdrop dismiss the sheet, so a redundant × isn't needed. */}
        <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
          <span className="text-sm font-medium text-white">{title}</span>
        </div>

        <div className="px-4 pb-4 space-y-3">
          {mode === "datetime" && (
            <div>
              <span className="block text-xs text-muted mb-1">Date</span>
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                className="w-full rounded-md bg-dashboardCard border border-white/10 px-3 py-2.5 text-sm text-white text-left focus:outline-none focus:border-accent"
              >
                {formatDayLabel(date)}
              </button>
            </div>
          )}
          <div>
            <span className="block text-xs text-muted mb-1">Time</span>
            <TimeWheelPicker value={time} onChange={setTime} />
          </div>
        </div>

        <div className="p-4 pt-0 shrink-0">
          <button
            onClick={confirm}
            className="w-full py-3 rounded-md bg-accent text-base font-medium"
            style={{ color: "#0B1210" }}
          >
            {confirmLabel}
          </button>
        </div>
          </>
        )}
      </BottomSheet>

      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={[]}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
          allowFuture
        />
      )}
    </>
  );
}
