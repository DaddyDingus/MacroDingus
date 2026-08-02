import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVisualViewportMetrics } from "../lib/useVisualViewportMetrics";

// The stepper chrome shared by every multi-step flow in the Strategy
// redesign (New Goal, Edit Goal, New Program) — top progress bar, back
// chevron, centered title, a scrollable content area, and a pinned
// full-width CTA footer. This is the first place the app needed a real
// linear "step N of M, Next/Back" wizard shape, as opposed to the
// branching step/view state machines QuickActionFlow/AddFoodSheet/
// QuickActionsSheet already use (those pick one leaf feature and stay
// there — no shared progress indicator, no forward/back navigation between
// peer steps).
export default function WizardShell({
  title,
  progress,
  onBack,
  children,
  footer,
}: {
  title: string;
  progress: number; // 0-1
  onBack: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  // Animate main content in on each mount. Callers add key={step} so React
  // unmounts+remounts WizardShell on every step change, triggering this each
  // time. The header and footer stay visually stable (progress bar, back
  // button, CTA) — only the scrollable content between them slides in.
  const [contentVisible, setContentVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setContentVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Sized off the *visual* viewport, not `h-dvh` — Chrome's default
  // `interactive-widget` behavior (`resizes-visual`, no override set in
  // index.html) shrinks the visual viewport when the on-screen keyboard
  // opens but leaves the layout viewport (and therefore `dvh`) untouched, so
  // a `fixed`/`h-dvh` footer stayed put behind the keyboard instead of
  // riding above it — the weight step's autofocused input plus its "Skip
  // for now" footer button was how this got noticed, but it'd hit any step
  // with an autofocused field. Same `useVisualViewportMetrics` +
  // `fixed inset-x-0` technique BottomSheet/AddFoodSheet already use.
  const { height: viewportHeight, offsetTop: viewportOffsetTop } = useVisualViewportMetrics();

  return (
    <div className="fixed inset-x-0 flex flex-col" style={{ top: viewportOffsetTop, height: viewportHeight }}>
      <header className="px-4 pt-5 pb-3 shrink-0">
        {/* Grid, not flex — three fix attempts on a `flex-1 + text-center`
            title (min-w-0, line-clamp-2, dropping overflow entirely) all
            rendered the title as fully blank, reproducing identically on
            both Samsung Internet Beta (Chromium) and Firefox Focus (Gecko).
            Two unrelated engines failing the same way rules out an
            engine-specific rendering quirk — the common factor was flex-grow
            centering itself. Grid with a back-button-width spacer column
            centers the title without flex-basis/grow arithmetic at all. */}
        <div className="grid grid-cols-[28px_1fr_28px] items-center gap-3 mb-3">
          <button onClick={onBack} aria-label="Back" className="p-1 -ml-1 text-ink justify-self-start">
            <ChevronLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <h1 className="text-base font-medium text-center">{title}</h1>
          <div aria-hidden="true" />
        </div>
        <div className="h-1 bg-surface-raised rounded-full overflow-hidden">
          <div
            className="h-full bg-ink rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </div>
      </header>

      <main className="flex-1 px-4 pb-4 overflow-y-auto">
        <div
          style={{
            opacity: contentVisible ? 1 : 0,
            transform: `translateX(${contentVisible ? 0 : 8}px)`,
            transition: contentVisible
              ? "opacity 180ms cubic-bezier(0.2, 0, 0, 1), transform 180ms cubic-bezier(0.2, 0, 0, 1)"
              : "none",
          }}
        >
          {children}
        </div>
      </main>

      <div className="px-4 pb-6 pt-2 shrink-0">{footer}</div>
    </div>
  );
}
