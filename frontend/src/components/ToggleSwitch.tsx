// Purely presentational — no click handler of its own. The parent row is the
// actual button (see AddTilesSheet), so this never nests a control inside
// another interactive element.
export default function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-white" : "bg-dashboardChip"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full transition-transform ${
          on ? "translate-x-5 bg-black" : "translate-x-0.5 bg-muted"
        }`}
      />
    </span>
  );
}
