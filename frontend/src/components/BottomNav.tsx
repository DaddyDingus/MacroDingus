import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/", label: "Log" },
  { to: "/trends", label: "Trends" },
  { to: "/coach", label: "Coach" },
  { to: "/photos", label: "Photos" },
  { to: "/more", label: "More" },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-surface border-t border-line flex z-40 pb-[env(safe-area-inset-bottom)]">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className={({ isActive }) =>
            `flex-1 py-3 text-center text-xs ${isActive ? "text-accent font-medium" : "text-muted"}`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
