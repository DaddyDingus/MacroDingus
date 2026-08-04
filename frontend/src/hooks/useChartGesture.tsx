import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { dayIndex, dateFromDayIndex, localDateString } from "../lib/date";
import { CHART_HEIGHT, CHART_HEIGHT_EXPANDED, CHART_MARGIN, Y_AXIS_WIDTH } from "../lib/chartLayout";

// A 3-day window is illegible on a stepped/daily chart — floor how far a
// pinch can zoom in before it stops being useful. Shared across every chart
// this hook drives, same reasoning as the original Expenditure-only version.
const MIN_WINDOW_DAYS = 7;
// Every history-chart query is capped at this same range. Keeping it as the
// zoom-out ceiling also lets a preset retain its real duration when the user
// only has a few days of data, instead of collapsing every preset to the
// tiny data span (and, for one day of data, a zero-width window).
const MAX_WINDOW_DAYS = 3650;

export interface WindowRange {
  start: number; // day-index, see lib/date.ts's dayIndex
  end: number;
}

export interface ChartGesture {
  view: WindowRange;
  expanded: boolean;
  toggleExpanded: () => void;
  chartHeight: number;
  activeDays: number;
  selectPreset: (days: number) => void;
  overlay: ReactNode;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

// Drag-to-pan + pinch-to-zoom over a Recharts chart, generalized from the
// gesture logic originally built for Expenditure's TdeeChart so every
// history chart in the app (Weight, Scale Weight, Energy Balance, Macros,
// Nutrient) can share one implementation. Pointer Events only, matching
// every other hand-rolled gesture in this codebase (DraggableSnapSheet.tsx,
// BottomSheet.tsx, DashboardCustomizeScreen.tsx) — never raw touch/mouse
// events, transient per-frame state in refs, `setPointerCapture` explicit,
// and `touch-action: pan-y` so native vertical scrolling remains available.
//
// `viewRef` is the single source of truth for the live gesture, read/written
// synchronously by the pointer handlers — reading React state here would
// mean every handler closes over whatever `view` was at the last render,
// which during a 60fps drag is already stale by the time the next
// pointermove fires. `view` state exists purely to drive re-renders,
// coalesced through one requestAnimationFrame per gesture rather than one
// state update per pointermove, so Recharts isn't asked to re-render at raw
// pointer-event rate.
export function useChartGesture({
  earliestTs,
  initialDays = 30,
  minWindowDays = MIN_WINDOW_DAYS,
  onViewChange,
}: {
  earliestTs: number;
  initialDays?: number;
  minWindowDays?: number;
  onViewChange?: (start: string, end: string) => void;
}): ChartGesture {
  const todayTs = useMemo(() => dayIndex(localDateString()), []);

  // useState's lazy initializer (not useMemo) so this object is only ever
  // built once, on mount — panning into empty space before real data just
  // shows a blank chart, exactly like selecting "All" with less history always has.
  const [view, setView] = useState<WindowRange>(() => ({ start: todayTs - (initialDays - 1), end: todayTs }));
  const viewRef = useRef<WindowRange>(view);

  // Collapsed by default — most of the benefit (more vertical room per day)
  // only shows up on the denser 1M+ views; 1W already has plenty of space.
  const [expanded, setExpanded] = useState(false);
  const chartHeight = expanded ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT;

  const overlayRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panGesture = useRef<{ startClientX: number; startWindow: WindowRange } | null>(null);
  const pinchGesture = useRef<{ startDistance: number; startWindow: WindowRange; anchorTs: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const pendingView = useRef<WindowRange | null>(null);
  // A separate rAF handle from the gesture-coalescing one above — a preset
  // tap runs its own multi-frame tween, not a single coalesced update.
  const presetAnimId = useRef<number | null>(null);

  function clampWindow(start: number, end: number): WindowRange {
    const safeEarliestTs = Math.min(earliestTs, todayTs);
    const minSpan = minWindowDays - 1;
    const maxSpan = Math.max(todayTs - safeEarliestTs, MAX_WINDOW_DAYS - 1, minSpan);
    const width = clamp(end - start, minSpan, maxSpan);
    // When history is shorter than the visible window, allow the empty part
    // of that window to extend before the first real point. Clamping `start`
    // straight back to earliestTs used to shrink a 7-day minimum to one or
    // even zero days; from there pan divided by zero and pinch could never
    // grow the window again, leaving every chart permanently stuck.
    const earliestWindowStart = Math.min(safeEarliestTs, todayTs - width);
    const latestWindowStart = todayTs - width;
    const s = clamp(start, earliestWindowStart, latestWindowStart);
    return { start: Math.round(s), end: Math.round(s + width) };
  }

  const commitView = useCallback((next: WindowRange) => {
    viewRef.current = next;
    pendingView.current = next;
    if (rafId.current == null) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (pendingView.current) setView(pendingView.current);
      });
    }
  }, []);

  // Only used for preset-pill taps, never for pan/pinch — a live gesture has
  // to track the finger 1:1 with zero added latency, but a discrete jump
  // (tapping "1Y" from "1M") reads as an abrupt cut without easing, where
  // MacroFactor's own preset switches visibly glide. Ease-out cubic over
  // ~350ms, running its own rAF loop rather than routing through
  // `commitView` — that one intentionally coalesces to "the latest value
  // wins," which would just skip straight to the end state instead of
  // animating through it.
  const animateToView = useCallback((target: WindowRange) => {
    if (presetAnimId.current != null) cancelAnimationFrame(presetAnimId.current);
    const from = { ...viewRef.current };
    const startTime = performance.now();
    const duration = 350;
    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = {
        start: Math.round(from.start + (target.start - from.start) * eased),
        end: Math.round(from.end + (target.end - from.end) * eased),
      };
      viewRef.current = next;
      setView(next);
      if (t < 1) {
        presetAnimId.current = requestAnimationFrame(step);
      } else {
        presetAnimId.current = null;
      }
    };
    presetAnimId.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    onViewChange?.(dateFromDayIndex(view.start), dateFromDayIndex(view.end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // The preset tween runs across ~21 frames at 350ms — long enough that
  // navigating away mid-animation (unlike the gesture rAF, which resolves
  // within a frame of pointerup) can otherwise outlive this component.
  useEffect(() => {
    return () => {
      if (presetAnimId.current != null) cancelAnimationFrame(presetAnimId.current);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  function selectPreset(days: number) {
    const end = todayTs;
    const target = clampWindow(end - (days - 1), end);
    pointers.current.clear();
    panGesture.current = null;
    pinchGesture.current = null;
    animateToView(target);
  }

  // Only "active" (matching a pill) when the window is exactly that preset's
  // trailing size ending today — any pan or pinch stops matching
  // automatically, no separate deselect flag needed.
  const activeDays = view.end === todayTs ? view.end - view.start + 1 : -1;

  function overlayFraction(clientX: number): number {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0.5;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // A real touch always wins over an in-flight preset tween — otherwise
    // the two would fight over `view` every frame until the tween's 350ms
    // ran out.
    if (presetAnimId.current != null) {
      cancelAnimationFrame(presetAnimId.current);
      presetAnimId.current = null;
    }
    // `lostpointercapture`/`pointercancel` normally clear this map, but Chrome
    // can omit the final event when a native scroll or browser gesture wins.
    // A new primary pointer is definitive proof that no old gesture is still
    // active, so discard any orphaned ids before starting it; otherwise the
    // first finger is misread as finger two and the chart appears frozen.
    if (e.isPrimary && pointers.current.size > 0) {
      pointers.current.clear();
      panGesture.current = null;
      pinchGesture.current = null;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      panGesture.current = { startClientX: e.clientX, startWindow: viewRef.current };
      pinchGesture.current = null;
    } else if (pointers.current.size === 2) {
      panGesture.current = null;
      const [a, b] = [...pointers.current.values()];
      const startDistance = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const midX = (a.x + b.x) / 2;
      const { start, end } = viewRef.current;
      const anchorTs = start + overlayFraction(midX) * (end - start);
      pinchGesture.current = { startDistance, startWindow: viewRef.current, anchorTs };
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchGesture.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const scale = distance / pinchGesture.current.startDistance;
      const startWidth = pinchGesture.current.startWindow.end - pinchGesture.current.startWindow.start;
      const midX = (a.x + b.x) / 2;
      const fraction = overlayFraction(midX);
      const newWidth = Math.round(startWidth / scale);
      const rawStart = pinchGesture.current.anchorTs - fraction * newWidth;
      commitView(clampWindow(rawStart, rawStart + newWidth));
      return;
    }

    if (pointers.current.size === 1 && panGesture.current) {
      const rect = overlayRef.current?.getBoundingClientRect();
      const plotWidth = Math.max(rect?.width ?? 1, 1);
      const { start, end } = panGesture.current.startWindow;
      const pxPerDay = plotWidth / (end - start);
      const deltaPx = e.clientX - panGesture.current.startClientX;
      const deltaDays = Math.round(-deltaPx / pxPerDay);
      commitView(clampWindow(start + deltaDays, end + deltaDays));
    }
  }

  function finishPointer(e: ReactPointerEvent<HTMLDivElement>, releaseCapture: boolean) {
    pointers.current.delete(e.pointerId);
    if (releaseCapture) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // already released (e.g. pointercancel beat us here) — nothing to do
      }
    }
    pinchGesture.current = null;
    if (pointers.current.size === 1) {
      // Downgraded from a pinch to a single finger — resume as a pan from
      // wherever the view (and the remaining finger) currently are.
      const [remaining] = [...pointers.current.values()];
      panGesture.current = { startClientX: remaining.x, startWindow: viewRef.current };
    } else {
      panGesture.current = null;
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    finishPointer(e, true);
  }

  function handleLostPointerCapture(e: ReactPointerEvent<HTMLDivElement>) {
    finishPointer(e, false);
  }

  const overlay = (
    <div
      ref={overlayRef}
      // Preserve native vertical page scrolling while reserving horizontal
      // movement and two-finger pinch for the chart. `touch-none` trapped any
      // scroll that happened to start over this large overlay.
      className="absolute top-0 touch-pan-y"
      style={{
        height: chartHeight,
        left: Y_AXIS_WIDTH + CHART_MARGIN.left,
        right: CHART_MARGIN.right,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
    />
  );

  return {
    view,
    expanded,
    toggleExpanded: () => setExpanded((v) => !v),
    chartHeight,
    activeDays,
    selectPreset,
    overlay,
  };
}
