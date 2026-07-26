export interface RangePreset {
  label: string;
  days: number;
}

export default function RangeToggle({
  presets,
  value,
  onChange,
}: {
  presets: RangePreset[];
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="flex gap-2 px-1">
      {presets.map((p) => (
        <button
          key={p.days}
          onClick={() => onChange(p.days)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            value === p.days ? "border-accent text-accent" : "border-line text-muted"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
