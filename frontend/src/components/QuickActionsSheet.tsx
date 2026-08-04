import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, ChevronRight, GripVertical, Plus } from "lucide-react";
import {
  SHORTCUT_CATALOG,
  SHORTCUT_COLOR_CATALOG,
  MAX_DASHBOARD_SHORTCUTS,
  useDashboardShortcuts,
  type ShortcutId,
} from "../lib/shortcuts";
import QuickActionFlow from "./QuickActionFlow";
import BottomSheet from "./BottomSheet";
import ToggleSwitch from "./ToggleSwitch";
import { armTrapHandoff } from "../lib/useBackDismiss";

interface ShortcutDragState {
  id: ShortcutId;
  startIndex: number;
  currentIndex: number;
  startY: number;
  rowHeight: number;
  offset: number;
}

// The center nav button and everything it opens: the full quick-actions menu,
// an edit-shortcuts checklist, and (once an action is picked) the shared
// QuickActionFlow that also backs the Dashboard's pinned shortcut buttons.
export default function QuickActionsButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-1 self-stretch flex items-center justify-center">
      <button
        onClick={() => setOpen(true)}
        aria-label="Quick actions"
        className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus size={20} strokeWidth={2.5} />
      </button>
      {open && <QuickActionsSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

function QuickActionsSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { shortcuts, toggle, reorder, order, reorderMore, colors, setColor } = useDashboardShortcuts();
  const [view, setView] = useState<"menu" | "edit">("menu");
  const [runningAction, setRunningAction] = useState<ShortcutId | null>(null);
  // Hand-rolled pointer drag, not a DnD library — same reasoning and same
  // pattern as DashboardCustomizeScreen's own tile reordering (this app
  // deliberately has no drag-and-drop dependency anywhere). Two independent
  // drag states rather than one generalized one: the pinned grid and the
  // "more shortcuts" list below it are separate lists with separate backing
  // arrays (`shortcuts` vs `order`/`reorderMore`), same reasoning as keeping
  // the two handler sets textually separate instead of threading a "which
  // list" flag through one shared implementation.
  const [drag, setDrag] = useState<ShortcutDragState | null>(null);
  const [moreDrag, setMoreDrag] = useState<ShortcutDragState | null>(null);
  // Set by selectAction, read by handleSheetClosed once BottomSheet has
  // finished animating away — distinguishes "picked an action" from the
  // swipe-down/backdrop-tap closes that share the same onClose.
  const pendingActionRef = useRef<ShortcutId | null>(null);

  // Photos is a lazy route. Start fetching/evaluating its chunk while the
  // user is looking at this menu so its real content is normally ready by
  // the time the sheet slides away after a Photos tap.
  useEffect(() => {
    void import("../screens/PhotosScreen");
  }, []);

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>, id: ShortcutId, index: number) {
    e.preventDefault();
    const row = e.currentTarget.closest("[data-shortcut-row]") as HTMLElement | null;
    const rowHeight = row?.getBoundingClientRect().height ?? 52;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, startIndex: index, currentIndex: index, startY: e.clientY, rowHeight, offset: 0 });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const clientY = e.clientY;
    setDrag((d) => {
      if (!d) return d;
      const deltaY = clientY - d.startY;
      const maxIndex = shortcuts.length - 1;
      const rawShift = Math.round(deltaY / d.rowHeight);
      const newIndex = Math.min(Math.max(d.startIndex + rawShift, 0), maxIndex);
      if (newIndex !== d.currentIndex) reorder(d.id, newIndex);
      return { ...d, currentIndex: newIndex, offset: deltaY - (newIndex - d.startIndex) * d.rowHeight };
    });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
  }

  function handleMorePointerDown(e: ReactPointerEvent<HTMLButtonElement>, id: ShortcutId, index: number) {
    e.preventDefault();
    const row = e.currentTarget.closest("[data-shortcut-row]") as HTMLElement | null;
    const rowHeight = row?.getBoundingClientRect().height ?? 52;
    e.currentTarget.setPointerCapture(e.pointerId);
    setMoreDrag({ id, startIndex: index, currentIndex: index, startY: e.clientY, rowHeight, offset: 0 });
  }

  function handleMorePointerMove(e: ReactPointerEvent<HTMLButtonElement>, maxIndex: number) {
    const clientY = e.clientY;
    setMoreDrag((d) => {
      if (!d) return d;
      const deltaY = clientY - d.startY;
      const rawShift = Math.round(deltaY / d.rowHeight);
      const newIndex = Math.min(Math.max(d.startIndex + rawShift, 0), maxIndex);
      if (newIndex !== d.currentIndex) reorderMore(d.id, newIndex);
      return { ...d, currentIndex: newIndex, offset: deltaY - (newIndex - d.startIndex) * d.rowHeight };
    });
  }

  function handleMorePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setMoreDrag(null);
  }

  // Most actions let this BottomSheet finish its ordinary close animation
  // before mounting their next overlay in handleSheetClosed below. Recipes
  // is deliberately a direct overlay handoff: waiting 320ms for this menu to
  // slide all the way down before AddFoodSheet could start sliding up made a
  // single navigation feel like two unrelated interactions.
  function selectAction(id: ShortcutId, close: () => void) {
    // Photos is a route rather than another overlay. Begin its page load and
    // transition immediately underneath this still-visible sheet, then let
    // the sheet use its normal slide-down animation to reveal it. Keep this
    // sheet's history entry as the real route entry underneath Photos;
    // otherwise unmount cleanup calls history.back() and cancels the route.
    if (id === "photos") {
      armTrapHandoff();
      navigate("/photos");
      close();
      return;
    }
    if (id === "recipes") {
      // The outgoing menu and incoming AddFoodSheet swap in one commit and
      // share the existing history entry. AddFoodSheet's own Library panel
      // then supplies the only transition: one immediate upward reveal.
      armTrapHandoff();
      setRunningAction(id);
      return;
    }
    pendingActionRef.current = id;
    close();
  }

  // BottomSheet's real onClose — fires once its close animation completes,
  // whether that was triggered by selectAction above, a swipe-down, or the
  // backdrop tap. Only the first of those leaves something in
  // pendingActionRef; the other two mean the user just wanted the menu gone.
  function handleSheetClosed() {
    const id = pendingActionRef.current;
    if (!id) {
      onClose();
      return;
    }
    pendingActionRef.current = null;
    // BottomSheet's trap unmounts and QuickActionFlow's mounts in the one
    // commit this setState triggers. Armed right here rather than back in
    // selectAction so the window it's open for is that single commit: the
    // outgoing trap hands its history entry straight to the incoming one and
    // neither touches the History API, which is what keeps this path's
    // browser-visible history identical to the Dashboard's pinned-shortcut
    // path (see lib/useBackDismiss.ts).
    armTrapHandoff();
    setRunningAction(id);
  }

  if (runningAction) {
    return <QuickActionFlow action={runningAction} onClose={onClose} />;
  }

  // The same pinned shortcuts that back the Dashboard's ShortcutsBar (and
  // this sheet's own "edit" view below) get the fast icon-tap treatment up
  // top here too, in the user's own chosen order — everything else in the
  // catalog falls through to a plain list underneath. Reusing `shortcuts`
  // for both means "pin to the Dashboard" and "put it in the quick-glance
  // row here" are the same decision, not two separate settings to keep in
  // sync.
  const iconGrid = shortcuts
    .map((id) => SHORTCUT_CATALOG.find((s) => s.id === id))
    .filter((s): s is (typeof SHORTCUT_CATALOG)[number] => Boolean(s));
  // In the user's own custom order (see reorderMore below), not raw catalog
  // declaration order — `order` already excludes nothing, so this filters
  // out whatever's currently pinned the same way the old catalog-order
  // version did.
  const listItems = order
    .map((id) => SHORTCUT_CATALOG.find((s) => s.id === id))
    .filter((s): s is (typeof SHORTCUT_CATALOG)[number] => s !== undefined && !shortcuts.includes(s.id));

  return (
    <BottomSheet
      onClose={handleSheetClosed}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
        {view === "menu" && (
          <>
            {/* Sharing the sheet's own drag gesture on the header and the
                pinned-shortcut grid below (not just the slim grabber notch
                above) — a plain tap still opens/closes as normal (see
                BottomSheet's commit-threshold), a real swipe up/down on
                either controls the sheet the same as dragging the grabber.
                No separate Close button — swipe-down (here, the grabber, or
                tapping the backdrop) is the dismiss gesture everywhere now,
                so a redundant × just added clutter. */}
            <div {...dragHandlers} className="px-4 pt-1 pb-3 flex items-center justify-between shrink-0 touch-none">
              <span className="text-sm font-medium">Quick actions</span>
              <button
                onClick={() => setView("edit")}
                aria-label="Edit shortcuts"
                className="text-muted active:text-white"
              >
                <SlidersHorizontal className="w-[18px] h-[18px]" strokeWidth={2} />
              </button>
            </div>

            {iconGrid.length > 0 && (
              <div {...dragHandlers} className="px-4 pb-3 shrink-0 touch-none">
                <div className="grid grid-cols-4 gap-x-2 gap-y-2">
                  {iconGrid.map((s) => {
                    const Icon = s.icon;
                    const colorId = colors[s.id] ?? "default";
                    const color = SHORTCUT_COLOR_CATALOG.find((c) => c.id === colorId) ?? SHORTCUT_COLOR_CATALOG[0];
                    return (
                      <button
                        key={s.id}
                        onClick={() => selectAction(s.id, close)}
                        className="flex flex-col items-center gap-1 active:opacity-80"
                      >
                        <span className="h-11 w-11 rounded-full bg-dashboardChip flex items-center justify-center">
                          <Icon
                            size={18}
                            strokeWidth={2}
                            style={colorId !== "default" ? { color: color.hex } : undefined}
                            className={colorId === "default" ? "text-white" : ""}
                          />
                        </span>
                        <span className="text-[10px] text-center leading-tight">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto pb-2 border-t border-line">
              {listItems.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => selectAction(s.id, close)}
                    className="w-full flex items-center gap-3 px-4 py-3 border-b border-line/60 text-left active:bg-surface-raised text-sm"
                  >
                    <Icon className="w-[18px] h-[18px] text-muted shrink-0" strokeWidth={2} />
                    <span className="flex-1">{s.label}</span>
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" strokeWidth={2} />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {view === "edit" && (
          <>
            <div {...dragHandlers} className="px-4 pt-1 pb-1 flex items-center justify-between shrink-0 touch-none">
              <span className="text-sm font-medium text-white">Edit shortcuts</span>
              <button onClick={() => setView("menu")} className="text-xs font-bold text-accent">
                Done
              </button>
            </div>
            <div className="px-4 pb-3 flex items-center justify-between gap-3 shrink-0">
              <p className="text-xs text-muted">
                Pick up to {MAX_DASHBOARD_SHORTCUTS} — drag the handle to reorder. These show as buttons on your
                Dashboard, in this order.
              </p>
              <span className="text-xs font-medium text-muted shrink-0">
                {shortcuts.length}/{MAX_DASHBOARD_SHORTCUTS}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
              {shortcuts.length > 0 && (
                <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
                  {shortcuts.map((id, i) => {
                    const s = SHORTCUT_CATALOG.find((c) => c.id === id);
                    if (!s) return null;
                    const Icon = s.icon;
                    const colorId = colors[id] ?? "default";
                    const color = SHORTCUT_COLOR_CATALOG.find((c) => c.id === colorId) ?? SHORTCUT_COLOR_CATALOG[0];
                    const isDragging = drag?.id === id;
                    return (
                      <div key={id}>
                        <div
                          data-shortcut-row
                          className="flex items-center gap-3 px-4 py-3 bg-dashboardCard"
                          style={
                            isDragging
                              ? { transform: `translateY(${drag.offset}px)`, position: "relative", zIndex: 10 }
                              : undefined
                          }
                        >
                          <span className="h-9 w-9 rounded-full bg-dashboardChip flex items-center justify-center shrink-0">
                            <Icon
                              size={16}
                              strokeWidth={2}
                              style={colorId !== "default" ? { color: color.hex } : undefined}
                              className={colorId === "default" ? "text-muted" : ""}
                            />
                          </span>
                          <span className="text-sm text-white flex-1 truncate min-w-0">{s.label}</span>
                          <button onClick={() => toggle(id)} aria-label={`Remove ${s.label} from Dashboard`} className="shrink-0 p-1">
                            <ToggleSwitch on={true} />
                          </button>
                          <button
                            onPointerDown={(e) => handlePointerDown(e, id, i)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                            aria-label={`Reorder ${s.label}`}
                            className="text-muted shrink-0 p-1 touch-none cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical size={18} strokeWidth={2} />
                          </button>
                        </div>
                        <div className="pl-[64px] pr-4 pb-3 flex items-center gap-2.5 flex-wrap bg-dashboardCard">
                          {SHORTCUT_COLOR_CATALOG.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setColor(id, c.id)}
                              aria-label={c.label}
                              className={`h-7 w-7 rounded-full shrink-0 transition ${
                                colorId === c.id ? "ring-2 ring-white ring-offset-2 ring-offset-dashboardCard" : ""
                              }`}
                              style={{ backgroundColor: c.hex }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {(() => {
                // In the user's own custom order (reorderMore below), not
                // raw catalog declaration order.
                const more = order
                  .map((id) => SHORTCUT_CATALOG.find((s) => s.id === id))
                  .filter((s): s is (typeof SHORTCUT_CATALOG)[number] => s !== undefined && !shortcuts.includes(s.id));
                if (more.length === 0) return null;
                return (
                  <div>
                    <p className="text-[11px] tracking-widest uppercase text-muted px-1 pb-2">
                      More shortcuts — drag the handle to reorder
                    </p>
                    <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
                      {more.map((s, i) => {
                        const Icon = s.icon;
                        const disabled = shortcuts.length >= MAX_DASHBOARD_SHORTCUTS;
                        const isDragging = moreDrag?.id === s.id;
                        return (
                          <div
                            key={s.id}
                            data-shortcut-row
                            className="flex items-center gap-3 px-4 py-3 bg-dashboardCard"
                            style={
                              isDragging
                                ? { transform: `translateY(${moreDrag.offset}px)`, position: "relative", zIndex: 10 }
                                : undefined
                            }
                          >
                            <span className="h-9 w-9 rounded-full bg-dashboardChip flex items-center justify-center shrink-0">
                              <Icon size={16} strokeWidth={2} className="text-muted" />
                            </span>
                            <span className="text-sm text-white flex-1 truncate min-w-0">{s.label}</span>
                            <button
                              onClick={() => toggle(s.id)}
                              disabled={disabled}
                              aria-label={`Add ${s.label} to Dashboard`}
                              className="shrink-0 p-1 disabled:opacity-30"
                            >
                              <ToggleSwitch on={false} />
                            </button>
                            <button
                              onPointerDown={(e) => handleMorePointerDown(e, s.id, i)}
                              onPointerMove={(e) => handleMorePointerMove(e, more.length - 1)}
                              onPointerUp={handleMorePointerUp}
                              onPointerCancel={handleMorePointerUp}
                              aria-label={`Reorder ${s.label}`}
                              className="text-muted shrink-0 p-1 touch-none cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical size={18} strokeWidth={2} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
        </>
      )}
    </BottomSheet>
  );
}
