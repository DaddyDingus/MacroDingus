import { useState } from "react";
import { useLogWeight } from "../api/weights";
import { localDateString } from "../lib/date";
import { useWeightUnit, unitToKg } from "../lib/weightUnit";

// Shared by the weight detail page and the global quick-actions sheet — same
// input+button, just reused wherever "log today's weight" needs to appear.
export default function LogWeightInline({ onLogged }: { onLogged?: () => void }) {
  const { unit } = useWeightUnit();
  const logWeight = useLogWeight();
  const [weightInput, setWeightInput] = useState("");

  function submit() {
    const value = Number(weightInput);
    if (!value || value <= 0) return;
    logWeight.mutate(
      { date: localDateString(), weightKg: unitToKg(value, unit) },
      { onSuccess: () => onLogged?.() }
    );
    setWeightInput("");
  }

  return (
    <div className="border border-line bg-surface rounded-md p-4 flex items-center gap-2 focus-within:border-accent">
      <input
        type="number"
        inputMode="decimal"
        value={weightInput}
        onChange={(e) => setWeightInput(e.target.value)}
        placeholder="Log today's weight"
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
  );
}
