// Original SVG scenes for the wizard intro cards (New Goal / Edit Goal /
// New Program) — deliberately not MacroFactor's specific rocket-ship/planet
// artwork, but built in the same spirit (a full-bleed illustrated header
// above the step list) using this app's own accent colors instead of new
// ones. "goal" is concentric target rings (goal accent green); "program" is
// a small bar-chart motif in the three macro colors.
export default function WizardIllustration({ variant }: { variant: "goal" | "program" }) {
  if (variant === "goal") {
    return (
      <div className="w-full aspect-[2/1] rounded-xl overflow-hidden relative bg-gradient-to-br from-[#0B2A20] via-[#0E1B16] to-[#111418] flex items-center justify-center">
        <div className="absolute inset-0 opacity-40" style={{ background: "radial-gradient(circle at 50% 45%, rgba(5,150,105,0.35), transparent 60%)" }} />
        <svg width="150" height="150" viewBox="0 0 150 150" fill="none" className="relative">
          <circle cx="75" cy="75" r="64" stroke="#059669" strokeWidth="2.5" opacity="0.25" />
          <circle cx="75" cy="75" r="46" stroke="#059669" strokeWidth="2.5" opacity="0.45" />
          <circle cx="75" cy="75" r="28" stroke="#059669" strokeWidth="2.5" opacity="0.7" />
          <circle cx="75" cy="75" r="9" fill="#059669" />
          <circle cx="75" cy="20" r="4" fill="#D896FF" opacity="0.8" />
          <circle cx="130" cy="95" r="3" fill="#D896FF" opacity="0.5" />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-full aspect-[2/1] rounded-xl overflow-hidden relative bg-gradient-to-br from-[#241407] via-[#161512] to-[#111418] flex items-center justify-center">
      <div className="absolute inset-0 opacity-40" style={{ background: "radial-gradient(circle at 50% 55%, rgba(239,141,106,0.3), transparent 60%)" }} />
      <svg width="170" height="110" viewBox="0 0 170 110" fill="none" className="relative">
        <rect x="18" y="55" width="26" height="45" rx="5" fill="#EF8D6A" />
        <rect x="72" y="24" width="26" height="76" rx="5" fill="#F7D372" />
        <rect x="126" y="42" width="26" height="58" rx="5" fill="#5ABC80" />
        <circle cx="31" cy="42" r="4" fill="#EF8D6A" opacity="0.6" />
        <circle cx="85" cy="12" r="4" fill="#F7D372" opacity="0.6" />
        <circle cx="139" cy="28" r="4" fill="#5ABC80" opacity="0.6" />
      </svg>
    </div>
  );
}
