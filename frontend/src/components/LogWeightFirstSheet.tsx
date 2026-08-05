import BottomSheet from "./BottomSheet";
import LogWeightInline from "./LogWeightInline";

// Shown from every "New Goal" entry point (Dashboard's "Set a goal" card,
// CoachScreen's own "New Goal" pill) when there's no weight history yet —
// Coached program generation needs a trend weight to compute targets
// (`routes/programs.ts`), and Goal Progress can't show anything until one
// exists either. Doesn't hard-block: "Continue without weighing in" still
// gets you into the wizard, since a Manual program or a maintain-type goal
// never actually needed a weight.
export default function LogWeightFirstSheet({ onClose, onContinue }: { onClose: () => void; onContinue: () => void }) {
  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-dashboardBg rounded-t-xl border-t border-line">
      {(dragHandlers) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Log a weight first?</h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-muted">
              For accurate calorie targets, log today's weight before setting a goal.
            </p>
            <LogWeightInline autoFocus onLogged={onContinue} />
            <button onClick={onContinue} className="w-full text-xs text-muted underline underline-offset-2 text-center">
              Continue without weighing in
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
