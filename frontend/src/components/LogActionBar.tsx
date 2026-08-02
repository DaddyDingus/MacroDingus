import { useState } from "react";
import { Pencil, Copy, Move, Clock, ChefHat, Trash2, ChevronLeft, X, type LucideIcon } from "lucide-react";
import type { LogEntry } from "../api/types";
import { useCopyLogEntries, useMoveLogEntries, useDeleteLogEntries } from "../api/logs";
import { localDateString, localTimeString, addDays, loggedAtTimeString, buildLoggedAt } from "../lib/date";
import useBottomNavHeight from "../lib/useBottomNavHeight";
import DateTimePickerSheet from "./DateTimePickerSheet";
import CreateRecipeFromGroupSheet from "./CreateRecipeFromGroupSheet";
import ConfirmDeleteSheet from "./ConfirmDeleteSheet";

export type LogSelection = { kind: "entry"; entry: LogEntry } | { kind: "group"; entries: LogEntry[] };

type RootView = "root" | "copy" | "move";
type PendingSheet = "copy" | "move" | "modifyTimestamp" | null;

function Chip({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 flex items-center gap-1.5 rounded-full bg-dashboardCard border border-white/10 px-3.5 py-2 text-xs text-white active:bg-white/10 whitespace-nowrap"
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </button>
  );
}

// The Food Log's contextual selection toolbar — appears while a single entry
// or a whole time-group is selected (see TodayScreen/TimeBlockGroup), floats
// directly above BottomNav like the Dashboard's ShortcutsBar, but stays
// pinned regardless of scroll (unlike that bar) since a selection is an
// active state the user is mid-interaction with, not passive chrome.
export default function LogActionBar({
  selection,
  sourceDate,
  onClose,
  onEdit,
}: {
  selection: LogSelection;
  sourceDate: string;
  onClose: () => void;
  onEdit: (entry: LogEntry) => void;
}) {
  const [view, setView] = useState<RootView>("root");
  const [pendingSheet, setPendingSheet] = useState<PendingSheet>(null);
  const [recipeSheetOpen, setRecipeSheetOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const navHeight = useBottomNavHeight();
  const copyEntries = useCopyLogEntries();
  const moveEntries = useMoveLogEntries();
  const deleteEntries = useDeleteLogEntries();

  const entries = selection.kind === "entry" ? [selection.entry] : selection.entries;
  const isGroup = selection.kind === "group";
  // The group's own display already collapses every entry under one shared
  // timestamp (TimeBlockGroup shows only entries[0].loggedAt) — copy/move/
  // modify-timestamp on a group follows that same convention and lands every
  // entry in it on one new shared date/time, rather than trying to preserve
  // individual offsets between them.
  const anchorTime = loggedAtTimeString(entries[0].loggedAt);

  function executeCopy(date: string, time: string) {
    copyEntries.mutate({
      date,
      loggedAt: buildLoggedAt(date, time),
      items: entries.map((e) => ({ foodId: e.food.id, quantityGrams: e.quantityGrams })),
    });
    onClose();
  }

  function executeMove(date: string, time: string) {
    moveEntries.mutate({ ids: entries.map((e) => e.id), date, loggedAt: buildLoggedAt(date, time) });
    onClose();
  }

  function executeModifyTimestamp(time: string) {
    moveEntries.mutate({ ids: entries.map((e) => e.id), loggedAt: buildLoggedAt(sourceDate, time) });
    onClose();
  }

  function apply(date: string, time: string) {
    if (view === "copy") executeCopy(date, time);
    else if (view === "move") executeMove(date, time);
  }

  function toNow() {
    const now = new Date();
    apply(localDateString(now), localTimeString(now));
  }
  function toToday() {
    apply(localDateString(), anchorTime);
  }
  function toTomorrow() {
    apply(addDays(localDateString(), 1), anchorTime);
  }
  function toDateAndTime() {
    setPendingSheet(view === "copy" ? "copy" : "move");
  }

  function executeDelete() {
    deleteEntries.mutate(
      entries.map((e) => e.id),
      { onSuccess: () => { setConfirmingDelete(false); onClose(); } }
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 z-30" style={{ bottom: navHeight }}>
        <div className="bg-dashboardBg border-t border-dashboardDivider flex items-center gap-2 px-3 py-2">
          {view !== "root" && (
            <button
              type="button"
              onClick={() => setView("root")}
              aria-label="Back"
              className="shrink-0 text-white/70 active:text-white p-1"
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
          )}

          {/* touch-action: pan-x + data-no-rubber-band — same fix
              MacroSummaryBar's own horizontal scroller needed. This bar is
              fixed at the bottom of the screen, which is exactly where
              window.scrollY sits at the page's max (or at 0, on a short log)
              while the user is selecting entries down there — without both
              of these, a horizontal swipe across the chips got read as
              vertical wobble by useRubberBandScroll's global touchmove
              listener and dragged the whole page into its pull-to-refresh
              stretch instead of just scrolling this row. */}
          <div
            className="flex-1 min-w-0 overflow-x-auto no-scrollbar overscroll-x-contain flex items-center gap-2"
            data-no-rubber-band
            style={{ touchAction: "pan-x" }}
          >
            {view === "root" && (
              <>
                {!isGroup && (
                  <Chip
                    icon={Pencil}
                    label="Edit"
                    onClick={() => {
                      onEdit(entries[0]);
                      onClose();
                    }}
                  />
                )}
                <Chip icon={Copy} label="Copy" onClick={() => setView("copy")} />
                <Chip icon={Move} label="Move" onClick={() => setView("move")} />
                <Chip icon={Clock} label="Modify timestamp" onClick={() => setPendingSheet("modifyTimestamp")} />
                {isGroup && (
                  <Chip icon={ChefHat} label="Create recipe" onClick={() => setRecipeSheetOpen(true)} />
                )}
                <Chip icon={Trash2} label="Delete" onClick={() => setConfirmingDelete(true)} />
              </>
            )}
            {(view === "copy" || view === "move") && (
              <>
                <Chip icon={Clock} label="To now" onClick={toNow} />
                <Chip icon={Clock} label="To today" onClick={toToday} />
                <Chip icon={Clock} label="To tomorrow" onClick={toTomorrow} />
                <Chip icon={Clock} label="To date & time" onClick={toDateAndTime} />
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel selection"
            className="shrink-0 text-white/70 active:text-white p-1"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      {pendingSheet === "modifyTimestamp" && (
        <DateTimePickerSheet
          mode="time"
          title="Modify timestamp"
          confirmLabel="Save"
          initialDate={sourceDate}
          initialTime={anchorTime}
          onConfirm={(_date, time) => {
            executeModifyTimestamp(time);
            setPendingSheet(null);
          }}
          onClose={() => setPendingSheet(null)}
        />
      )}

      {(pendingSheet === "copy" || pendingSheet === "move") && (
        <DateTimePickerSheet
          mode="datetime"
          title={pendingSheet === "copy" ? "Copy to date & time" : "Move to date & time"}
          confirmLabel={pendingSheet === "copy" ? "Copy" : "Move"}
          initialDate={sourceDate}
          initialTime={anchorTime}
          onConfirm={(date, time) => {
            if (pendingSheet === "copy") executeCopy(date, time);
            else executeMove(date, time);
            setPendingSheet(null);
          }}
          onClose={() => setPendingSheet(null)}
        />
      )}

      {recipeSheetOpen && (
        <CreateRecipeFromGroupSheet
          entries={entries}
          onClose={() => setRecipeSheetOpen(false)}
          onCreated={() => {
            setRecipeSheetOpen(false);
            onClose();
          }}
        />
      )}

      {confirmingDelete && (
        <ConfirmDeleteSheet
          title={isGroup ? "Delete Group" : "Delete Food"}
          message={
            entries.length === 1
              ? `Remove ${entries[0].food.name} from this day's log? This can't be undone.`
              : `Remove all ${entries.length} items logged at this time from this day's log? This can't be undone.`
          }
          confirmLabel={isGroup ? "Delete Group" : "Delete Food"}
          onConfirm={executeDelete}
          onClose={() => setConfirmingDelete(false)}
          isPending={deleteEntries.isPending}
        />
      )}
    </>
  );
}
