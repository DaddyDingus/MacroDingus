export default function ModeToggle({
  mode,
  onModeChange,
  compact = false,
}: {
  mode: "total" | "remaining";
  onModeChange: (mode: "total" | "remaining") => void;
  compact?: boolean;
}) {
  const isRemaining = mode === "remaining";

  return (
    <div
      className={`relative grid grid-cols-2 rounded-full bg-dashboardTrack ${
        compact ? "p-0.5 text-[11px]" : "p-1 text-xs"
      }`}
    >
      <div
        className="absolute inset-y-0.5 rounded-full bg-white transition-[left,right] duration-200 ease-out"
        style={
          isRemaining
            ? { left: "50%", right: compact ? "2px" : "4px" }
            : { left: compact ? "2px" : "4px", right: "50%" }
        }
      />
      <button
        onClick={() => onModeChange("total")}
        className={`relative z-10 rounded-full transition-colors ${compact ? "px-2.5 py-1" : "px-4 py-1.5"} ${
          isRemaining ? "text-muted" : "text-black"
        }`}
      >
        Consumed
      </button>
      <button
        onClick={() => onModeChange("remaining")}
        className={`relative z-10 rounded-full transition-colors ${compact ? "px-2.5 py-1" : "px-4 py-1.5"} ${
          !isRemaining ? "text-muted" : "text-black"
        }`}
      >
        Remaining
      </button>
    </div>
  );
}
