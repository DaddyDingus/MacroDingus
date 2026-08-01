import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLogWeight, useWeights } from "../api/weights";
import { formatDayLabel, localDateString } from "../lib/date";
import { useWeightUnit, unitToKg } from "../lib/weightUnit";
import CalendarJumpSheet from "./CalendarJumpSheet";

// Shared by the weight detail page and the global quick-actions sheet — same
// input+button, just reused wherever "log today's weight" needs to appear.
export default function LogWeightInline({ onLogged, autoFocus }: { onLogged?: () => void; autoFocus?: boolean }) {
  const { unit } = useWeightUnit();
  const logWeight = useLogWeight();
  const [weightInput, setWeightInput] = useState("");
  const [showBodyFat, setShowBodyFat] = useState(false);
  const [bodyFatInput, setBodyFatInput] = useState("");
  const bodyFatRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(localDateString());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const weightDates = useWeights(3650, calendarOpen);
  const isToday = date === localDateString();

  // The toggle button below prevents itself from taking focus on tap (see
  // its onMouseDown), so the on-screen keyboard never dismisses — instead
  // we hand focus straight to the newly-revealed body fat input once it
  // mounts, so the keyboard stays up and simply retargets.
  useEffect(() => {
    if (showBodyFat) bodyFatRef.current?.focus();
  }, [showBodyFat]);

  function submit() {
    const value = Number(weightInput);
    if (!value || value <= 0) return;
    const bodyFatPercent = showBodyFat && bodyFatInput ? Number(bodyFatInput) : null;
    logWeight.mutate(
      { date, weightKg: unitToKg(value, unit), bodyFatPercent },
      { onSuccess: () => onLogged?.() }
    );
    setWeightInput("");
    setBodyFatInput("");
    setShowBodyFat(false);
    setDate(localDateString());
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={(e) => {
          // Unlike the body-fat toggle below, this one should blur whatever
          // input is focused — the on-screen keyboard covers the calendar
          // sheet otherwise, since it pops up from the bottom same as the
          // keyboard. (e.target as HTMLElement).blur() alone isn't enough on
          // some mobile browsers if a *different* element (the weight/body
          // fat input) is the one actually focused, so blur the real
          // activeElement explicitly.
          (document.activeElement as HTMLElement | null)?.blur();
          setCalendarOpen(true);
        }}
        className="self-center flex items-center gap-1.5 px-3 py-1 rounded-full border border-line text-xs font-medium text-muted active:border-accent active:text-white"
      >
        <CalendarDays className="w-3 h-3" strokeWidth={2} />
        {formatDayLabel(date)}
      </button>
      <div className="border border-line bg-surface rounded-2xl p-4 flex items-center gap-2 focus-within:border-accent">
        <input
          type="number"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={weightInput}
          onChange={(e) => setWeightInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={isToday ? "Log today's weight" : `Log weight for ${formatDayLabel(date)}`}
          className="tabular flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-muted"
        />
        <span className="text-xs text-muted shrink-0">{unit}</span>
        <button
          onClick={submit}
          disabled={!weightInput || logWeight.isPending}
          className="shrink-0 px-3 py-1.5 rounded-md bg-accent text-sm font-medium disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          Log
        </button>
      </div>
      {showBodyFat ? (
        <div className="border border-line bg-surface rounded-2xl p-4 flex items-center gap-2 focus-within:border-accent">
          <input
            ref={bodyFatRef}
            type="number"
            inputMode="decimal"
            autoComplete="off"
            value={bodyFatInput}
            onChange={(e) => setBodyFatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Body fat (optional)"
            className="tabular flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-muted"
          />
          <span className="text-xs text-muted shrink-0">%</span>
        </div>
      ) : (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowBodyFat(true)}
          className="self-start text-xs text-muted underline underline-offset-2"
        >
          + Body fat %
        </button>
      )}
      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={weightDates.data?.map((w) => w.date) ?? []}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}
