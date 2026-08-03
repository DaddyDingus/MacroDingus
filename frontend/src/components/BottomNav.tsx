import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, UtensilsCrossed, Target, Menu, type LucideIcon } from "lucide-react";
import QuickActionsButton from "./QuickActionsSheet";
import { useNavVisibility } from "../lib/navVisibility";

const TABS_LEFT = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/log", label: "Food log", icon: UtensilsCrossed },
];
const TABS_RIGHT = [
  { to: "/strategy", label: "Strategy", icon: Target },
  { to: "/more", label: "More", icon: Menu },
];

function Tab({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex-1 py-2 flex flex-col items-center gap-0.5 transition-colors duration-150 ${
          isActive ? "text-accent font-semibold" : "text-muted hover:text-white/80"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} className="transition-all duration-150" />
          <span className="text-[10px] font-medium leading-none mt-0.5">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function BottomNav() {
  const location = useLocation();
  const { hidden } = useNavVisibility();
  // The Strategy wizard screens (New Goal/Edit Goal/New Program/Edit
  // Program) are full-screen takeovers, same intent as MacroFactor's own —
  // none of their screenshots show a bottom tab bar during a wizard, and
  // leaving it visible would just fight the wizard's own pinned CTA button
  // for the same strip of screen (the CTA sat underneath the nav's "+"
  // button, unclickable, until this was caught in scratch-container testing).
  // The bare "/strategy" tab root is unaffected — only its sub-routes hide the nav.
  if (location.pathname.startsWith("/strategy/")) return null;
  // /photos/compare (full-bleed slider) plus non-routed full-screen overlays
  // opted in via useHideBottomNav — same fixed-bar-competing-for-the-bottom-
  // strip problem as above, just signaled through context instead of a URL.
  if (location.pathname === "/photos/compare") return null;
  if (hidden) return null;

  return (
    <nav
      id="app-bottom-nav"
      className="fixed bottom-0 inset-x-0 bg-dashboardBg border-t border-dashboardDivider flex z-40 pb-[env(safe-area-inset-bottom)]"
    >
      {TABS_LEFT.map((t) => (
        <Tab key={t.to} {...t} />
      ))}
      <QuickActionsButton />
      {TABS_RIGHT.map((t) => (
        <Tab key={t.to} {...t} />
      ))}
    </nav>
  );
}
