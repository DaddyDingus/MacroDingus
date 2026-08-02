import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { localDateString } from "./date";

const ViewedDateContext = createContext<{
  viewedDate: string | null;
  setViewedDate: (date: string | null) => void;
} | null>(null);

export function ViewedDateProvider({ children }: { children: ReactNode }) {
  const [viewedDate, setViewedDate] = useState<string | null>(null);
  return <ViewedDateContext.Provider value={{ viewedDate, setViewedDate }}>{children}</ViewedDateContext.Provider>;
}

// What "today" should actually mean for a quick action right now — the
// day TodayScreen's own date nav is currently showing, or real today
// wherever that doesn't apply (Dashboard's shortcuts, or the FAB reached
// from any other screen). Read by QuickActionFlow, the sole place every
// quick-action entry point (pinned shortcuts, the "+" FAB menu) actually
// picks a date, so fixing it there covers both.
export function useEffectiveLogDate(): string {
  const ctx = useContext(ViewedDateContext);
  return ctx?.viewedDate ?? localDateString();
}

// Only TodayScreen calls this — announces whichever day its ‹/› nav is
// currently on, so the globally-rendered FAB (mounted once in App.tsx,
// outside TodayScreen entirely — see BottomNav) and the pinned shortcuts
// both act on that same day instead of always defaulting to real today.
// Clears back to null on unmount/date-change cleanup so leaving the Log tab
// (or this provider not being present at all, e.g. in a context that never
// wraps TodayScreen) can't leave a stale non-today date silently governing
// quick actions fired from somewhere else.
export function useAnnounceViewedDate(date: string) {
  const ctx = useContext(ViewedDateContext);
  const setViewedDate = ctx?.setViewedDate;
  useEffect(() => {
    setViewedDate?.(date);
    return () => setViewedDate?.(null);
  }, [date, setViewedDate]);
}
