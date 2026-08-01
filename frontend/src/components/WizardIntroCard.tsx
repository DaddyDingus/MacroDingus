import { X, Check } from "lucide-react";
import WizardIllustration from "./WizardIllustration";

export interface WizardIntroStep {
  label: string;
  description?: string;
  status: "done" | "active" | "pending";
}

// The illustrated full-screen intro shown before New Goal / Edit Goal /
// New Program's actual step-by-step wizard — X-close over an illustration,
// a bold title, a numbered step list (checkmark for completed steps, so
// New Program's intro can show "Set new goal ✓ / Set new program ●" when
// chained after finishing a goal), and a single CTA into the real flow.
export default function WizardIntroCard({
  title,
  illustration,
  steps,
  ctaLabel,
  onCta,
  onClose,
}: {
  title: string;
  illustration: "goal" | "program";
  steps: WizardIntroStep[];
  ctaLabel: string;
  onCta: () => void;
  onClose: () => void;
}) {
  return (
    <div className="min-h-dvh flex flex-col step-enter">
      <div className="relative shrink-0">
        <WizardIllustration variant={illustration} />
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-ink flex items-center justify-center"
        >
          <X className="w-4 h-4" style={{ color: "#0B1210" }} strokeWidth={2.5} />
        </button>
      </div>

      <div className="px-4 pt-5">
        <h1 className="text-2xl font-bold uppercase tracking-tight">{title}</h1>
      </div>

      <div className="flex-1 px-4 pt-6">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                  s.status === "pending" ? "bg-surface-raised text-muted" : ""
                }`}
                style={s.status === "pending" ? undefined : { background: "#ECEDEE", color: "#0B1210" }}
              >
                {s.status === "done" ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
              </span>
              {i < steps.length - 1 && <span className="w-px flex-1 bg-line my-1" />}
            </div>
            <div className={`pb-6 ${s.status === "pending" ? "opacity-50" : ""}`}>
              <p className="text-sm font-semibold">{s.label}</p>
              {s.description && <p className="text-xs text-muted mt-0.5">{s.description}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-6 shrink-0">
        <button
          onClick={onCta}
          className="w-full py-3.5 rounded-full text-sm font-semibold"
          style={{ background: "#ECEDEE", color: "#0B1210" }}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
