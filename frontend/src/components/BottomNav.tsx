import { NavLink } from "react-router-dom";
import { LayoutDashboard, UtensilsCrossed, Target, Menu, type LucideIcon } from "lucide-react";
import QuickActionsButton from "./QuickActionsSheet";

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
        `flex-1 py-2 flex flex-col items-center gap-0.5 ${isActive ? "text-[11px] text-white font-medium" : "text-[10px] text-muted"}`
      }
    >
      <Icon size={20} strokeWidth={2} />
      {label}
    </NavLink>
  );
}

export default function BottomNav() {
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
