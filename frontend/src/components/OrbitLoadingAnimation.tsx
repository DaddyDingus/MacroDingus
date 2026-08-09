import { useEffect, useState } from "react";

// Original loading illustration for New Program's "generating" step — three
// dots colored protein/fat/carbs, orbiting a center point at different
// radii/speeds via CSS (@keyframes orbit-spin in index.css). Not a copy of
// MacroFactor's rocket/planet artwork; this motif was picked specifically
// because it's literally what the wizard is computing (a macro split), so
// it's meaningful rather than decorative.
const ORBITS = [
  { radius: 26, size: 11, color: "#EF8D6A", duration: "2.2s" }, // protein — innermost, fastest
  { radius: 48, size: 13, color: "#F7D372", duration: "3.4s" }, // fat
  { radius: 70, size: 15, color: "#5ABC80", duration: "4.8s" }, // carbs — outermost, slowest
];

const STATUS_LINES = [
  "Estimating your expenditure…",
  "Balancing your macros…",
  "Cranking up the success likelihood…",
  "Almost there…",
];

// `lines` is overridden by the weekly check-in (CheckInFlow), which runs the
// same illustration over a different computation — the orbit motif stays, the
// commentary has to describe what that screen is actually doing.
export default function OrbitLoadingAnimation({ lines = STATUS_LINES }: { lines?: string[] }) {
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setLineIndex((i) => (i + 1) % lines.length), 1800);
    return () => clearInterval(id);
  }, [lines.length]);

  return (
    <div className="flex flex-col items-center justify-center py-10">
      <div className="relative" style={{ width: 160, height: 160 }}>
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: "inset 0 0 40px rgba(236,237,238,0.04)" }} />
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-ink" />
        {ORBITS.map((o, i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 rounded-full border border-line/60"
            style={{
              width: o.radius * 2,
              height: o.radius * 2,
              marginLeft: -o.radius,
              marginTop: -o.radius,
              animation: `orbit-spin ${o.duration} linear infinite`,
            }}
          >
            <span
              className="absolute rounded-full"
              style={{
                width: o.size,
                height: o.size,
                background: o.color,
                top: o.radius - o.size / 2,
                left: o.radius * 2 - o.size / 2,
              }}
            />
          </div>
        ))}
      </div>
      <p className="text-sm text-muted mt-6 text-center transition-opacity">{lines[lineIndex % lines.length]}</p>
    </div>
  );
}
