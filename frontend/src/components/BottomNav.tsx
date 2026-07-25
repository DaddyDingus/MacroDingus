import { NavLink } from "react-router-dom";
import QuickActionsButton from "./QuickActionsSheet";

const TABS_LEFT = [
  { to: "/", label: "Dashboard" },
  { to: "/log", label: "Food log" },
];
const TABS_RIGHT = [
  { to: "/strategy", label: "Strategy" },
  { to: "/more", label: "More" },
];

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex-1 py-3 text-center text-xs ${isActive ? "text-accent font-medium" : "text-muted"}`
      }
    >
      {label}
    </NavLink>
  );
}

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-surface border-t border-line flex z-40 pb-[env(safe-area-inset-bottom)]">
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
