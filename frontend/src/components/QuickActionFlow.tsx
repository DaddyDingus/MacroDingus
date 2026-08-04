import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDayLog } from "../api/logs";
import { usePrograms } from "../api/programs";
import { targetsForDate } from "../lib/programTargets";
import { useEffectiveLogDate } from "../lib/viewedDate";
import type { ShortcutId } from "../lib/shortcuts";
import AddFoodSheet from "./AddFoodSheet";
import QuickAddSheet from "./QuickAddSheet";
import CopyDaySheet from "./CopyDaySheet";
import LogWeightInline from "./LogWeightInline";
import BottomSheet from "./BottomSheet";

// Runs a single quick action to completion, against whichever date is
// currently "effective" (lib/viewedDate.tsx) — real today everywhere except
// while TodayScreen's own ‹/› date nav is showing a different day, in which
// case a quick action fired from its pinned shortcuts *or* the global FAB
// (mounted outside TodayScreen entirely, in App.tsx) lands on that same day
// instead of always defaulting to today. Shared by the FAB's quick-actions
// menu and the Dashboard's pinned shortcut buttons, since a pinned shortcut
// is just a shortcut into this same flow, skipping the menu step. No meal
// selection anywhere in here — logging no longer tracks a meal at all (see
// backend/src/db/schema.ts), it's a straight timeline of when things were
// actually logged.
export default function QuickActionFlow({ action, onClose }: { action: ShortcutId; onClose: () => void }) {
  const navigate = useNavigate();
  const date = useEffectiveLogDate();
  const dayLog = useDayLog(date);
  const programs = usePrograms();
  const step = action === "logWeight"
    ? "logWeight"
    : action === "copyDay"
      ? "copyDay"
      : action === "quickAdd"
        ? "quickAdd"
        : "addFood"; // search / scan / newFood / describe / newRecipe / recipes

  // Photos has no sheet of its own — jump straight there. Navigating (and
  // closing the menu that triggered this) has to happen in an effect, not
  // directly in the render body: onClose() sets state on an ancestor
  // (QuickActionsButton's `open`), and calling that synchronously while this
  // component is still rendering is exactly the "update a component while
  // rendering a different component" case React doesn't guarantee applies
  // correctly — in practice here it meant tapping "Photos" from the "+"
  // button's menu silently did nothing.
  useEffect(() => {
    if (action === "photos") {
      navigate("/photos");
      onClose();
    }
    // navigate/onClose deliberately not deps — both are fresh references on
    // every render (onClose especially, an inline arrow at the call site),
    // and this should only ever fire once, right when a "photos" instance
    // first mounts, not on every subsequent re-render of this component.
  }, [action]);

  if (action === "photos") return null;

  // Same "whichever program was active on the viewed date" lookup
  // TodayScreen uses, so the sheet's header badges match what the Food log
  // screen itself would show for this date.
  const dayTargets = targetsForDate(programs.data ?? [], date);
  const targets = dayTargets
    ? { calories: dayTargets.calories, proteinG: dayTargets.proteinG, fatG: dayTargets.fatG, carbsG: dayTargets.carbsG }
    : null;

  // Leaf flows that already own a full-screen backdrop+panel.
  if (step === "addFood") {
    return (
      <AddFoodSheet
        open
        date={date}
        editingEntry={null}
        initialStep={
          action === "scan"
            ? "scan"
            : action === "newFood"
              ? "create"
              : action === "describe"
                ? "describe"
                : action === "newRecipe"
                  ? "recipe"
                  : action === "recipes"
                    ? "library"
                    : "search"
        }
        onClose={onClose}
        totals={dayLog.data?.totals}
        targets={targets}
      />
    );
  }
  if (step === "quickAdd") {
    return <QuickAddSheet date={date} onClose={onClose} />;
  }
  if (step === "copyDay") {
    return <CopyDaySheet targetDate={date} onClose={onClose} />;
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers) => (
        <>
        {step === "logWeight" && (
          <>
            <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
              <span className="text-sm font-medium text-white">Log weight</span>
            </div>
            <div className="px-4 pb-4">
              <LogWeightInline onLogged={onClose} autoFocus />
            </div>
          </>
        )}

        </>
      )}
    </BottomSheet>
  );
}
