import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Palette, Ruler, CalendarDays, UtensilsCrossed, Camera, ChevronRight, AlertTriangle, LogOut, User, KeyRound, Activity } from "lucide-react";
import { useRecipes } from "../api/recipes";
import { useAuthStatus, useLogout } from "../api/auth";
import { useCoachStatus, useSaveProfile } from "../api/coach";
import { useTheme, THEME_CATALOG } from "../lib/theme";
import { useEnergyUnit, kcalToUnit, energyUnitLabel, type EnergyUnit } from "../lib/energyUnit";
import { useWeightUnit, type WeightUnit } from "../lib/weightUnit";
import { staggerStyle } from "../lib/stagger";
import RecipeEditSheet from "../components/RecipeEditSheet";
import ClearAccountDataSheet from "../components/ClearAccountDataSheet";
import ChangeCheckInDaySheet from "../components/ChangeCheckInDaySheet";
import RenameAccountSheet from "../components/RenameAccountSheet";
import ChangePasswordSheet from "../components/ChangePasswordSheet";
import EditBodyProfileSheet from "../components/EditBodyProfileSheet";

const ENERGY_UNITS: EnergyUnit[] = ["kcal", "kj"];
const WEIGHT_UNITS: WeightUnit[] = ["kg", "lb"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export default function MoreScreen() {
  const navigate = useNavigate();
  const recipes = useRecipes();
  const authStatus = useAuthStatus();
  const logout = useLogout();
  const coachStatus = useCoachStatus();
  const saveProfile = useSaveProfile();
  const { theme, setTheme } = useTheme();
  const { unit: energyUnit, setUnit: setEnergyUnit } = useEnergyUnit();
  const { unit: weightUnit, setUnit: setWeightUnit } = useWeightUnit();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showClearData, setShowClearData] = useState(false);
  const [showCheckInDaySheet, setShowCheckInDaySheet] = useState(false);
  const [showRenameSheet, setShowRenameSheet] = useState(false);
  const [showPasswordSheet, setShowPasswordSheet] = useState(false);
  const [showBodyProfileSheet, setShowBodyProfileSheet] = useState(false);

  let block = 0;
  const name = authStatus.data?.user?.name ?? "";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const profile = coachStatus.data?.profile ?? null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <p className="text-[11px] text-muted">Preferences &amp; Account</p>
        <h1 className="text-2xl font-semibold tracking-tight mt-0.5">More</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        {/* Profile header — same "gradient + radial glow" treatment as
            WizardIllustration, tinted with the app's own accent instead of a
            wizard-specific color, so this reads as an on-brand extension of
            that idiom rather than a new one. */}
        <div
          className="tile-enter relative rounded-2xl overflow-hidden border border-line bg-gradient-to-br from-[#2A1B33] via-[#171319] to-[#111418]"
          style={staggerStyle(block++, 60, 5)}
        >
          <div
            className="absolute inset-0 opacity-40"
            style={{ background: "radial-gradient(circle at 80% 15%, rgba(216,150,255,0.3), transparent 60%)" }}
          />
          <div className="relative px-4 py-4 flex items-center gap-3">
            <span className="shrink-0 w-12 h-12 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-accent text-lg font-semibold">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold truncate">{name || "—"}</p>
              <p className="text-xs text-muted mt-0.5">Signed in</p>
            </div>
            <button
              onClick={() => logout.mutate()}
              className="shrink-0 flex items-center gap-1.5 text-xs text-muted px-3 py-1.5 rounded-full border border-line active:bg-surface-raised"
            >
              <LogOut size={13} strokeWidth={2} />
              Log out
            </button>
          </div>
        </div>

        <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <SectionHeader icon={<Palette size={15} strokeWidth={2} className="text-muted" />} label="Appearance" />
          {THEME_CATALOG.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0 text-left active:bg-surface-raised"
            >
              <span
                className="shrink-0 w-7 h-7 rounded-full border border-line"
                style={{ backgroundColor: t.swatch }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{t.label}</span>
                <span className="block text-xs text-muted">{t.description}</span>
              </span>
              {theme === t.id && <Check size={18} className="shrink-0 text-accent" />}
            </button>
          ))}
        </section>

        <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <SectionHeader icon={<Ruler size={15} strokeWidth={2} className="text-muted" />} label="Units" />
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-line/60">
            <span className="text-sm">Energy unit</span>
            <div className="flex rounded-full border border-line overflow-hidden text-xs">
              {ENERGY_UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => setEnergyUnit(u)}
                  className={`px-2.5 py-1 ${energyUnit === u ? "bg-accent" : "text-muted"}`}
                  style={energyUnit === u ? { color: "#0B1210" } : undefined}
                >
                  {energyUnitLabel(u)}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm">Weight unit</span>
            <div className="flex rounded-full border border-line overflow-hidden text-xs">
              {WEIGHT_UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => setWeightUnit(u)}
                  className={`px-2.5 py-1 ${weightUnit === u ? "bg-accent" : "text-muted"}`}
                  style={weightUnit === u ? { color: "#0B1210" } : undefined}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <SectionHeader icon={<User size={15} strokeWidth={2} className="text-muted" />} label="Account" />
          <button
            onClick={() => setShowRenameSheet(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60 text-left active:bg-surface-raised"
          >
            <span className="text-sm">Rename account</span>
            <span className="flex items-center gap-1 text-sm text-muted">
              {name}
              <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setShowPasswordSheet(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left active:bg-surface-raised"
          >
            <span className="flex items-center gap-2 text-sm">
              <KeyRound size={14} strokeWidth={2} className="text-muted" />
              Change password
            </span>
            <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
          </button>
        </section>

        {profile && (
          <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
            <SectionHeader icon={<CalendarDays size={15} strokeWidth={2} className="text-muted" />} label="Coaching" />
            <button
              onClick={() => setShowCheckInDaySheet(true)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60 text-left active:bg-surface-raised"
            >
              <span className="text-sm">Check-in day</span>
              <span className="flex items-center gap-1 text-sm text-muted">
                {profile.checkInDayOfWeek != null ? DAY_LABELS[profile.checkInDayOfWeek] : "Not set"}
                <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
              </span>
            </button>
            <button
              onClick={() => setShowBodyProfileSheet(true)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left active:bg-surface-raised"
            >
              <span className="flex items-center gap-2 text-sm">
                <Activity size={14} strokeWidth={2} className="text-muted" />
                Body &amp; lifestyle profile
              </span>
              <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
            </button>
          </section>
        )}

        <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <SectionHeader icon={<UtensilsCrossed size={15} strokeWidth={2} className="text-muted" />} label="My Recipes" />
          {recipes.data?.length === 0 && (
            <p className="px-4 py-4 text-sm text-muted">
              No recipes yet — create one from the "Add food" sheet on any meal.
            </p>
          )}
          {recipes.data?.map((r) => (
            <button
              key={r.id}
              onClick={() => setEditingId(r.id)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60 last:border-b-0 text-left active:bg-surface-raised"
            >
              <span className="min-w-0">
                <span className="block text-sm truncate">{r.name}</span>
                <span className="block text-xs text-muted tabular">
                  {r.servings} serving{r.servings === 1 ? "" : "s"} ·{" "}
                  {Math.round(kcalToUnit(r.food.caloriesPer100g, energyUnit))} {energyUnitLabel(energyUnit)}/100g
                </span>
              </span>
            </button>
          ))}
        </section>

        <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <button
            onClick={() => navigate("/photos")}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-surface-raised"
          >
            <Camera size={15} strokeWidth={2} className="text-muted shrink-0" />
            <span className="text-sm font-medium flex-1 min-w-0">Progress photos</span>
            <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
          </button>
        </section>

        <section className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <button
            onClick={() => setShowClearData(true)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-surface-raised"
          >
            <span
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: "rgba(217,89,38,0.12)" }}
            >
              <AlertTriangle size={14} strokeWidth={2} style={{ color: "#D95926" }} />
            </span>
            <span className="text-sm flex-1 min-w-0" style={{ color: "#D95926" }}>
              Clear Account Data
            </span>
            <ChevronRight size={16} strokeWidth={2.5} className="shrink-0" style={{ color: "#D95926" }} />
          </button>
        </section>
      </main>

      {editingId && <RecipeEditSheet id={editingId} onClose={() => setEditingId(null)} />}
      {showClearData && <ClearAccountDataSheet onClose={() => setShowClearData(false)} />}
      {showCheckInDaySheet && profile && (
        <ChangeCheckInDaySheet
          value={profile.checkInDayOfWeek}
          onSelect={(dayOfWeek) => saveProfile.mutate({ ...profile, checkInDayOfWeek: dayOfWeek })}
          onClose={() => setShowCheckInDaySheet(false)}
        />
      )}
      {showRenameSheet && <RenameAccountSheet currentName={name} onClose={() => setShowRenameSheet(false)} />}
      {showPasswordSheet && <ChangePasswordSheet onClose={() => setShowPasswordSheet(false)} />}
      {showBodyProfileSheet && profile && (
        <EditBodyProfileSheet profile={profile} onClose={() => setShowBodyProfileSheet(false)} />
      )}
    </div>
  );
}
