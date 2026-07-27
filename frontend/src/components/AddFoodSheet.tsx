import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import {
  X,
  Search as SearchIcon,
  ScanBarcode,
  Zap,
  ChefHat,
  Plus,
  Utensils,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import type { Food, LogEntry, Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { useFoodSearch, useCreateFood, useBarcodeLookup } from "../api/foods";
import { useCreateRecipe } from "../api/recipes";
import { useAddLog, useBulkAddLog, useUpdateLogQuantity, useDeleteLog, useSmartHistory } from "../api/logs";
import { scaleNutrition, sumNutrition } from "../lib/nutrition";
import { localTimeString } from "../lib/date";
import { usePlateState, type PlateItem } from "../lib/quickAddPlate";
import { useVisualViewportMetrics } from "../lib/useVisualViewportMetrics";
import FoodIconAvatar from "./FoodIconAvatar";
import CreateFoodForm from "./CreateFoodForm";
import RecipeForm from "./RecipeForm";
import DraggableSnapSheet from "./DraggableSnapSheet";
import FoodDetailScreen from "./FoodDetailScreen";

// zxing's decoder is ~400kB and only ever needed for the occasional barcode
// scan, not the everyday search-and-log path — split it into its own chunk
// so it doesn't weigh down the initial load.
const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

type Step = "browse" | "quantity" | "create" | "scan" | "recipe" | "detail";
type Tab = "search" | "quickAdd" | "custom";

// Order matches the redesign spec: Search, Scan, Quick Add, Custom/Recipe.
// "scan" isn't a Tab value (it launches the fullscreen camera step instead
// of switching the browse pane), so it's flagged separately here rather
// than folded into the Tab union.
const BASE_TAB_BAR_ITEMS: { id: Tab | "scan"; label: string; icon: LucideIcon }[] = [
  { id: "search", label: "Search", icon: SearchIcon },
  { id: "scan", label: "Scan", icon: ScanBarcode },
  { id: "quickAdd", label: "Quick Add", icon: Zap },
  { id: "custom", label: "Custom", icon: ChefHat },
];

// The Search/Scan/Quick Add/Custom sheet (Layer 2) sits over the Plate View
// (Layer 1, the full-screen background) rather than the other way around —
// a "Google Maps" style dual layer. EXPANDED covers most of the screen;
// COLLAPSED shrinks the sheet's own real height (see DraggableSnapSheet) down
// to just this peek height (grabber + the compact tab-icon row), fully
// revealing the plate underneath. Both are plain constants (not measured)
// since nothing here needs to be pixel-perfect the way the real-viewport
// height/header height below do (those chase actual iOS keyboard/notch
// behavior; these two don't) — just comfortably bigger than the grabber
// (~17px) + collapsed row's own natural height so nothing in the collapsed
// content gets clipped.
const SHEET_EXPANDED_RATIO = 0.88;
const SHEET_COLLAPSED_PEEK_PX = 68;

const NUTRITION_METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; unit: string; color: string }[] = [
  // Same categorical hex values as tailwind.config.js / MacroSummaryBar.tsx
  // (calories=blue, protein=orange, fat=yellow, carbs=green) — reused as-is
  // rather than introducing a separate "coral" for protein, since this
  // exact four-color set is the one already validated across light/dark and
  // color-vision-deficiency pairs elsewhere in the app.
  { key: "calories", label: "Calories", unit: "", color: "#3987E5" },
  { key: "protein", label: "Protein", unit: "g", color: "#D95926" },
  { key: "fat", label: "Fat", unit: "g", color: "#F0B400" },
  { key: "carbs", label: "Carbs", unit: "g", color: "#059669" },
];

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

// "8 AM" — hour-only, no minutes. Display context for the header pill only;
// there's no meal concept in this app (see backend/src/db/schema.ts) and
// every log is written at the current time (localIsoNoTz()), so this isn't
// an editable time picker, just a glance at "when this will be logged."
function formatHourLabel(d = new Date()): string {
  const hour = d.getHours() % 12 || 12;
  const suffix = d.getHours() >= 12 ? "PM" : "AM";
  return `${hour} ${suffix}`;
}

function targetFor(targets: MacroTargets | null | undefined, key: "calories" | "protein" | "fat" | "carbs"): number {
  if (!targets) return 0;
  if (key === "calories") return targets.calories;
  if (key === "protein") return targets.proteinG;
  if (key === "fat") return targets.fatG;
  return targets.carbsG;
}

export default function AddFoodSheet({
  open,
  date,
  editingEntry,
  onClose,
  initialStep,
  initialFood,
  totals,
  targets,
}: {
  open: boolean;
  date: string;
  editingEntry: LogEntry | null;
  onClose: () => void;
  // Lets callers outside the timeline's own "+ Log food" button (the global
  // quick-actions sheet, a recipe picker) skip straight to scanning or to a
  // preselected food's quantity step instead of always landing on search.
  initialStep?: "search" | "scan";
  initialFood?: Food;
  // Today's running totals/targets, for the header's "N left" budget badges
  // and the Plate Review's Day-impact nutrition view. Optional — callers
  // that haven't loaded a check-in yet just get badge-less/target-less UI
  // rather than a broken one.
  totals?: Nutrition;
  targets?: MacroTargets | null;
}) {
  const [step, setStep] = useState<Step>("browse");
  const [activeTab, setActiveTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);
  const [scannedBarcode, setScannedBarcode] = useState<string | undefined>(undefined);
  // Which snap point the Search sheet (Layer 2) is at — expanded by default
  // whenever the modal opens (see the reset effect below), toggled by the
  // header's chevron, a drag on the sheet's own grabber, or tapping a tab
  // while collapsed.
  const [sheetExpanded, setSheetExpanded] = useState(true);
  // Confirmation gate for the X button specifically — see requestClose below.
  // Not shown for the chevron/collapse or for a successful "Log Foods"
  // commit, only for actually leaving the modal with unlogged items still on
  // the plate.
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  // Always locally owned now — every open clears it (see the reset effect
  // below), so there's no cross-unmount persistence left to worry about:
  // TodayScreen's instance just clears its own state on reopen, and
  // QuickActionFlow's instance gets a brand new empty one for free every
  // time it's freshly mounted, since React destroys local state on unmount
  // regardless. lib/quickAddPlate.tsx used to also export a Context/Provider
  // for QuickActionFlow to share a plate across its own unmount/remount
  // cycle — removed once that stopped being the desired behavior.
  const {
    stagedPlate,
    addToPlate,
    removeFromPlate,
    updatePlateItemQuantity,
    clearPlate,
    editingPlateKey,
    setEditingPlateKey,
    nutritionView,
    setNutritionView,
  } = usePlateState();
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Set when the sheet is opened via the dedicated "Search" shortcut
  // (initialStep === "search"), which explicitly signals "I want to type a
  // search right now" — as opposed to the timeline's generic "+ Log food"
  // button, which lands on the same tab but shouldn't pop the keyboard
  // immediately. Consumed (and cleared) by the effect below once the search
  // tab's input has actually mounted.
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);
  // Real visual-viewport metrics (not vh/%) so the full-screen modal and the
  // sheet-height math below stay correct as iOS Safari's on-screen keyboard
  // opens/closes — see the shared hook's own comment for why vh doesn't work
  // here. This component used to get this for free from BottomSheet; now
  // that Layer 1/Layer 2 need their own geometry, it's read directly.
  const { height: viewportHeight, offsetTop: viewportOffsetTop } = useVisualViewportMetrics();
  // The pinned header's real rendered height, measured rather than guessed —
  // it isn't a fixed single row (budget badges only show once targets have
  // loaded, the avatar stack only once something's staged), and Layer
  // 1/Layer 2 both need to know exactly how much space is left below it.
  // Re-measured whenever the "browse" step (which is what actually renders
  // BrowseHeader) becomes active again, since the ref's DOM node is a fresh
  // element each time that step mounts.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(96);
  useEffect(() => {
    if (step !== "browse") return;
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step]);
  // The pinned bottom action bar (search pill + Log Foods) is a normal flex
  // sibling after the Layer 1/Layer 2 region, not a `position: fixed`
  // overlay — it's already inside this component's own visual-viewport-
  // tracked wrapper, so ordinary flex flow keeps it correctly above the
  // iOS keyboard for free, and its height just needs to be subtracted from
  // Layer 1/Layer 2's own budget the same way the header's is.
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [actionBarHeight, setActionBarHeight] = useState(84);
  useEffect(() => {
    if (step !== "browse") return;
    const el = actionBarRef.current;
    if (!el) return;
    const update = () => setActionBarHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step]);
  const contentHeight = Math.max(0, viewportHeight - headerHeight - actionBarHeight);
  const sheetPanelHeightPx = contentHeight * SHEET_EXPANDED_RATIO;
  // How much of Layer 1 (the Plate View) is actually visible above the
  // sheet's current top edge — used to center the empty-plate message within
  // what's really on screen rather than the full (mostly sheet-covered)
  // layer height. See the empty-state block below for why this matters.
  const visibleLayer1Height = Math.max(0, contentHeight - (sheetExpanded ? sheetPanelHeightPx : SHEET_COLLAPSED_PEEK_PX));

  useEffect(() => {
    if (!open) return;
    if (editingEntry) {
      setSelectedFood(editingEntry.food);
      setGrams(editingEntry.quantityGrams);
      setStep("quantity");
    } else if (initialFood) {
      setSelectedFood(initialFood);
      setGrams(initialFood.servingSizeGrams ?? 100);
      setStep("quantity");
    } else {
      setSelectedFood(null);
      setGrams(100);
      setStep(initialStep === "scan" ? "scan" : "browse");
      setActiveTab("search");
      setPendingSearchFocus(initialStep === "search");
    }
    setQuery("");
    setDebouncedQuery("");
    setScannedBarcode(undefined);
    setSheetExpanded(true);
    // Every open starts from a clean plate — staging within one open session
    // still survives collapsing/expanding the sheet or editing a quantity,
    // but closing (X, "Close anyway" on the unlogged-plate warning, or a
    // completed Log Foods) and reopening always starts fresh rather than
    // resurfacing whatever was left over from last time.
    clearPlate();
    // clearPlate itself is deliberately not a dep — it's a fresh function
    // reference every render (not memoized), so depending on it would refire
    // this effect (and re-clear the plate) on every render instead of only
    // on an actual open/step transition.
  }, [open, editingEntry, initialFood, initialStep]);

  useEffect(() => {
    if (!pendingSearchFocus || step !== "browse" || activeTab !== "search") return;
    searchInputRef.current?.focus();
    setPendingSearchFocus(false);
  }, [pendingSearchFocus, step, activeTab]);

  // Every keystroke used to fire an immediate request, including the
  // name-search fallback to OpenFoodFacts (see api/foods.ts on the backend) —
  // typing "oats" fired "o", "oa", "oat", "oats" back to back, hammering
  // OFF's search endpoint fast enough that it started 503-ing mid-word, so
  // the last keystroke's results (what the user actually sees) sometimes
  // came back empty even though the same term worked a moment later.
  // Debouncing to one request per pause fixes that at the source.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const search = useFoodSearch(debouncedQuery);
  const smartHistory = useSmartHistory(localTimeString());
  const addLog = useAddLog(date);
  const bulkAddLog = useBulkAddLog(date);
  const updateLog = useUpdateLogQuantity(date);
  const deleteLog = useDeleteLog(date);
  const createFood = useCreateFood();
  const createRecipe = useCreateRecipe();
  const barcodeLookup = useBarcodeLookup();

  if (!open) return null;

  // The universal "I picked this food" entry point for Search results, Scan
  // results, and anything created via the Custom tab's forms — stages it
  // rather than writing it anywhere, and returns to the browse view (which
  // also dismisses the fullscreen scanner, since that's driven by `step`).
  // Editing an existing log entry or logging a preselected recipe
  // (initialFood, from QuickActionFlow's recipe picker) never goes through
  // here — both start the sheet directly on the old single-item
  // QuantityStep instead, since neither fits the multi-item staging model.
  function pickFood(food: Food) {
    // A search result from OpenFoodFacts (not yet a real row — see
    // GET /api/foods on the backend) has a synthetic `off:<barcode>` id.
    // Resolve it into an actual cached food first, via the same
    // cache-or-fetch endpoint the barcode scanner uses, so staging always
    // references a real foods.id.
    if (food.id.startsWith("off:") && food.barcode) {
      barcodeLookup.mutate(food.barcode, { onSuccess: (resolved) => pickFood(resolved) });
      return;
    }
    addToPlate(food);
    setStep("browse");
  }

  // Tapping a search result's row body (as opposed to its "+" quick-add
  // button, which still goes straight through pickFood above) opens the
  // detail/nutrition-breakdown view instead of staging immediately — same
  // OpenFoodFacts resolution as pickFood, since the detail screen needs the
  // food's real fiber/sugar/saturated-fat/sodium fields, which a synthetic
  // `off:` search result doesn't carry until resolved.
  function openFoodDetail(food: Food) {
    if (food.id.startsWith("off:") && food.barcode) {
      barcodeLookup.mutate(food.barcode, { onSuccess: (resolved) => openFoodDetail(resolved) });
      return;
    }
    setSelectedFood(food);
    setStep("detail");
  }

  function confirmQuantity() {
    if (!selectedFood) return;
    if (editingEntry) {
      updateLog.mutate({ id: editingEntry.id, quantityGrams: grams });
    } else {
      addLog.mutate({ food: selectedFood, quantityGrams: grams });
    }
    onClose();
  }

  function removeEntry() {
    if (!editingEntry) return;
    deleteLog.mutate(editingEntry.id);
    onClose();
  }

  function handleScan(barcode: string) {
    barcodeLookup.mutate(barcode, {
      onSuccess: (food) => pickFood(food),
      onError: () => {
        setScannedBarcode(barcode);
        setStep("create");
      },
    });
  }

  // The batch commit — this project's equivalent of a single bulkAdd write,
  // via the same POST /api/logs/bulk endpoint the old multi-select flow
  // used (backend/src/routes/logs.ts), just fed from stagedPlate instead of
  // a checked-rows Set.
  function confirmPlate() {
    if (stagedPlate.length === 0) return;
    bulkAddLog.mutate({
      entries: stagedPlate.map((item) => ({ food: item.food, quantityGrams: item.quantityGrams })),
    });
    clearPlate();
    onClose();
  }

  // The X button's handler — staged items already survive closing this
  // sheet (see the reset effect above and lib/quickAddPlate.tsx), but that
  // persistence only covers reopening the sheet within the same running app
  // session, not a real page refresh/PWA relaunch, so it's still worth an
  // explicit heads-up before actually leaving with something unlogged.
  function requestClose() {
    if (stagedPlate.length > 0) {
      setShowCloseWarning(true);
    } else {
      onClose();
    }
  }

  const suggestions = query.trim() ? search.data : smartHistory.data?.foods;
  const suggestionsLabel = query.trim()
    ? "Results"
    : smartHistory.data?.basis === "time-of-day"
      ? "Usually around now"
      : "Recently logged";

  const plateTotals = sumNutrition(stagedPlate.map((item) => scaleNutrition(item.food, item.quantityGrams)));

  return (
    <>
    {/* The parent Logging Modal — genuinely full-screen (not a bottom sheet
        shell), positioned against real visual-viewport metrics rather than
        vh/inset-0 for the same iOS-keyboard reasons BottomSheet.tsx documents.
        Only the "browse" step gets the dual-layer Plate/Search treatment
        below; quantity/create/recipe are focused single-purpose steps that
        just fill this same full-screen container with their own header. */}
    <div
      className="fixed inset-x-0 z-50 bg-dashboardBg flex flex-col pb-[env(safe-area-inset-bottom)]"
      style={{ top: viewportOffsetTop, height: viewportHeight }}
    >
        {step === "browse" && (
          <>
            <div ref={headerRef}>
              <BrowseHeader
                onClose={requestClose}
                totals={totals}
                plateTotals={plateTotals}
                targets={targets}
                stagedPlate={stagedPlate}
                sheetExpanded={sheetExpanded}
                onToggleSheet={() => setSheetExpanded((v) => !v)}
              />
            </div>

            {/* Layer 1 (background) + Layer 2 (foreground) both live in this
                relative region, sized to exactly what's left below the header. */}
            <div className="relative flex-1 min-h-0">
              {/* Layer 1: Plate View — full-screen background. Bottom padding
                  reserves room for the Search sheet's collapsed peek, which is
                  always visible on top of it regardless of expand state. */}
              <div
                className="absolute inset-0 overflow-y-auto"
                style={{ paddingBottom: SHEET_COLLAPSED_PEEK_PX }}
              >
                {stagedPlate.length > 0 ? (
                  <StagedPlateSection
                    stagedPlate={stagedPlate}
                    plateTotals={plateTotals}
                    totals={totals}
                    targets={targets}
                    nutritionView={nutritionView}
                    setNutritionView={setNutritionView}
                    editingPlateKey={editingPlateKey}
                    setEditingPlateKey={setEditingPlateKey}
                    updatePlateItemQuantity={updatePlateItemQuantity}
                    removeFromPlate={removeFromPlate}
                  />
                ) : (
                  // Centered within visibleLayer1Height — the space actually
                  // visible above the sheet's current top edge — not the
                  // full layer height. Centering in the full height would put
                  // this dead center of the whole background layer, which
                  // when the sheet is expanded (the default) is mostly
                  // covered by it, making the message invisible; anchoring it
                  // to a fixed top offset instead looks stranded near the
                  // header once the sheet is collapsed and most of the layer
                  // is visible. This tracks whichever amount is actually on
                  // screen right now, animating alongside the sheet itself.
                  <div
                    className="flex flex-col items-center justify-center gap-1.5 px-8 text-center"
                    style={{ height: visibleLayer1Height, transition: "height 220ms ease-out" }}
                  >
                    <Utensils className="w-4 h-4 text-muted" strokeWidth={1.5} />
                    <p className="text-[11px] text-muted">Nothing on your plate yet — search below to add something</p>
                  </div>
                )}
              </div>

              {/* Layer 2 (foreground): the Search/Scan/Quick Add/Custom sheet. */}
              <DraggableSnapSheet
                expanded={sheetExpanded}
                onExpandedChange={setSheetExpanded}
                panelHeight={sheetPanelHeightPx}
                collapsedPeek={SHEET_COLLAPSED_PEEK_PX}
                panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
              >
                {sheetExpanded ? (
                  <>
                    <div className="flex border-b border-dashboardDivider px-2 shrink-0">
                      {BASE_TAB_BAR_ITEMS.map((t) => {
                        const active = t.id !== "scan" && activeTab === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => (t.id === "scan" ? setStep("scan") : setActiveTab(t.id))}
                            className="flex-1 flex justify-center py-2"
                          >
                            {/* The border lives on this inline-content span, not the flex-1
                                button, so the indicator hugs the icon+label instead of the
                                button's full equal-width tap target. */}
                            <span
                              className={`flex items-center gap-1.5 pb-1.5 border-b-2 transition-colors ${
                                active ? "border-white text-white" : "border-transparent text-muted"
                              }`}
                            >
                              <t.icon className="w-3.5 h-3.5" strokeWidth={2} />
                              <span className="text-[11px] font-medium">{t.label}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* pb-4, not pb-2 — there's no longer an in-sheet search
                        footer sitting right below this to lean on for
                        breathing room; the last row needs its own. */}
                    <div className="flex-1 overflow-y-auto pb-4">
                      {activeTab === "search" && (
                        <div>
                          <div className="px-4 pt-3 pb-1">
                            <p className="text-[11px] tracking-widest uppercase text-muted">{suggestionsLabel}</p>
                          </div>
                          {suggestions?.length === 0 && <p className="px-4 py-3 text-sm text-muted">No foods found.</p>}
                          {suggestions?.map((food) => {
                            const refGrams = food.servingSizeGrams ?? 100;
                            const n = scaleNutrition(food, refGrams);
                            return (
                              <div
                                key={food.id}
                                className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-dashboardDivider/60"
                              >
                                {/* Tapping the row itself opens the detail/nutrition
                                    breakdown view (MacroFactor-style "inspect before
                                    adding"); the separate "+" stages it instantly with
                                    the same default quantity tapping used to use,
                                    preserving the fast multi-add flow. */}
                                <button
                                  onClick={() => openFoodDetail(food)}
                                  className="flex-1 flex items-center gap-3 min-w-0 text-left active:bg-white/5"
                                >
                                  <FoodIconAvatar name={food.name} />
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm text-white truncate">{food.name}</span>
                                    <span className="block text-[11px] text-muted truncate mt-1 tabular">
                                      {fmt(n.protein)}P {fmt(n.fat)}F {fmt(n.carbs)}C · {fmt(refGrams)}g
                                    </span>
                                  </span>
                                  <span className="tabular text-sm text-white shrink-0 ml-2">{fmt(n.calories)}</span>
                                </button>
                                <button
                                  onClick={() => pickFood(food)}
                                  aria-label={`Quick add ${food.name}`}
                                  className="shrink-0 w-7 h-7 rounded-full bg-dashboardChip flex items-center justify-center text-white active:bg-white/20"
                                >
                                  <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {activeTab === "quickAdd" && <QuickAddTab createFood={createFood} onCreated={addToPlate} />}

                      {activeTab === "custom" && (
                        <div>
                          <button
                            onClick={() => setStep("create")}
                            className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-dashboardDivider/60 text-left active:bg-white/5"
                          >
                            <span className="shrink-0 w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                              <Plus className="w-4 h-4 text-white" strokeWidth={2} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm text-white">Create custom food</span>
                              <span className="block text-[11px] text-muted mt-0.5">Enter nutrition facts manually</span>
                            </span>
                          </button>
                          <button
                            onClick={() => setStep("recipe")}
                            className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-dashboardDivider/60 text-left active:bg-white/5"
                          >
                            <span className="shrink-0 w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                              <ChefHat className="w-4 h-4 text-white" strokeWidth={2} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm text-white">Create recipe</span>
                              <span className="block text-[11px] text-muted mt-0.5">Combine ingredients into one loggable food</span>
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  // COLLAPSED: just the tab-icon row (no active-tab content,
                  // no search input) — tapping a tab re-expands the sheet and
                  // switches to it in one motion, same as tapping it expanded
                  // would switch tabs. shrink-0 with its own compact height,
                  // not flex-1 — the panel's real CSS height is now exactly
                  // SHEET_COLLAPSED_PEEK_PX when collapsed (see
                  // DraggableSnapSheet), so a flex-1 row here would still lay
                  // out correctly, but there's no reason to stretch a row of
                  // icons across the whole panel height when it's this short.
                  <div className="shrink-0 flex items-center px-2 py-1.5">
                    {BASE_TAB_BAR_ITEMS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (t.id === "scan") {
                            setStep("scan");
                          } else {
                            setActiveTab(t.id);
                            setSheetExpanded(true);
                          }
                        }}
                        className="flex-1 flex flex-col items-center justify-center gap-1 text-muted active:text-white"
                      >
                        <t.icon className="w-4 h-4" strokeWidth={2} />
                        <span className="text-[10px] font-medium">{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </DraggableSnapSheet>
            </div>

            {/* Unified pinned action bar — search pill + Log Foods, always in
                the same place together regardless of which tab is active or
                whether the sheet above is expanded or collapsed. A normal
                flex sibling (not absolutely/fixed-positioned over Layer
                1/Layer 2), so it can't drift out of sync with — or overlap —
                the collapsed sheet's own peek row the way two independently
                bottom-pinned elements could. */}
            <div ref={actionBarRef}>
              <ActionBar
                activeTab={activeTab}
                onFocusSearch={() => {
                  setActiveTab("search");
                  setSheetExpanded(true);
                }}
                query={query}
                setQuery={setQuery}
                searchInputRef={searchInputRef}
                stagedPlate={stagedPlate}
                onLogFoods={confirmPlate}
              />
            </div>
          </>
        )}

        {step === "quantity" && selectedFood && (
          <QuantityStep
            food={selectedFood}
            grams={grams}
            setGrams={setGrams}
            isEditing={!!editingEntry}
            onBack={() => (editingEntry ? onClose() : setStep("browse"))}
            onConfirm={confirmQuantity}
            onRemove={editingEntry ? removeEntry : undefined}
          />
        )}

        {step === "detail" && selectedFood && (
          <FoodDetailScreen
            food={selectedFood}
            totals={totals}
            targets={targets}
            onBack={() => setStep("browse")}
            onAdd={(food, quantityGrams) => {
              addToPlate(food, quantityGrams);
              setStep("browse");
            }}
          />
        )}

        {step === "create" && (
          <CreateFoodForm
            initialName={query.trim()}
            barcode={scannedBarcode}
            onCancel={() => setStep("browse")}
            onCreated={(food) => {
              createFood.mutate(food, {
                onSuccess: (created) => pickFood(created),
              });
            }}
          />
        )}

        {step === "recipe" && (
          <RecipeForm
            initialName={query.trim()}
            onCancel={() => setStep("browse")}
            onCreated={(input) => {
              createRecipe.mutate(
                {
                  name: input.name,
                  servings: input.servings,
                  totalWeightGrams: input.totalWeightGrams,
                  ingredients: input.ingredients.map((i) => ({
                    foodId: i.food.id,
                    quantityGrams: i.quantityGrams,
                  })),
                },
                { onSuccess: (created) => pickFood(created) }
              );
            }}
          />
        )}
    </div>

      {step === "scan" && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
          <BarcodeScanner onScan={handleScan} onClose={() => setStep("browse")} />
        </Suspense>
      )}

      {showCloseWarning && (
        <UnloggedPlateWarning
          count={stagedPlate.length}
          onKeepEditing={() => setShowCloseWarning(false)}
          onCloseAnyway={() => {
            setShowCloseWarning(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

// Close button, time-of-day pill, compact calorie/protein "left" budget
// badges, and (once something's staged) a tiny overlapping avatar stack for
// the plate — deliberately monochrome (white/grey only, no accent teal) per
// the redesigned sheet's high-contrast look. Only calories + protein get
// budget badges (not all four macros) to keep this row from crowding next
// to the tab bar.
function BrowseHeader({
  onClose,
  totals,
  plateTotals,
  targets,
  stagedPlate,
  sheetExpanded,
  onToggleSheet,
}: {
  onClose: () => void;
  totals?: Nutrition;
  // Folded into the badges below so "N left" ticks down live as items are
  // staged, not just once they're actually logged — otherwise this header
  // (visible in both sheet states, including collapsed) would silently lag
  // behind the Nutrition grid's own Plate/Day totals, which already do this.
  plateTotals: Nutrition;
  targets?: MacroTargets | null;
  stagedPlate: PlateItem[];
  sheetExpanded: boolean;
  onToggleSheet: () => void;
}) {
  const consumedCal = (totals?.calories ?? 0) + plateTotals.calories;
  const consumedProtein = (totals?.protein ?? 0) + plateTotals.protein;
  const calPct = targets && targets.calories > 0 ? Math.min(100, Math.max(0, (consumedCal / targets.calories) * 100)) : 0;
  const proteinPct =
    targets && targets.proteinG > 0 ? Math.min(100, Math.max(0, (consumedProtein / targets.proteinG) * 100)) : 0;
  const visibleAvatars = stagedPlate.slice(0, 3);
  const overflowCount = stagedPlate.length - visibleAvatars.length;

  return (
    // items-start (not items-center): the badges are a two-line block
    // (number + progress line) while the close button, time pill, avatar
    // stack, and chevron are single-line, so centering the row by each
    // child's *total* box height would pull the badge numbers down off
    // everything else's center. Every child instead gets its own fixed h-5
    // first line, so top-aligning the row lines up all of their "first
    // lines" exactly, regardless of what follows underneath the badges.
    // pt accounts for the status bar/notch now that this sits at the very
    // top of a genuinely full-screen modal, not a few percent down inside a
    // rounded sheet.
    <div className="flex items-start gap-3 px-4 pb-3 shrink-0" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
      <button onClick={onClose} aria-label="Close" className="shrink-0 h-5 flex items-center text-white/70 active:text-white">
        <X className="w-5 h-5" strokeWidth={2} />
      </button>
      <div className="flex-1 flex items-start justify-center gap-3 min-w-0">
        <span className="shrink-0 h-5 flex items-center rounded-full bg-dashboardChip px-2.5 text-[11px] font-medium text-white tabular">
          {formatHourLabel()}
        </span>
        {targets && (
          <>
            <BudgetBadge label={`${fmt(targets.calories - consumedCal)} left`} pct={calPct} />
            <BudgetBadge label={`${fmt(targets.proteinG - consumedProtein)}P left`} pct={proteinPct} />
          </>
        )}
      </div>
      {stagedPlate.length > 0 && (
        <div className="shrink-0 h-5 flex items-center -space-x-1.5">
          {visibleAvatars.map((item) => (
            <FoodIconAvatar
              key={item.key}
              name={item.food.name}
              className="w-5 h-5 rounded-md ring-2 ring-dashboardBg"
              emojiClassName="text-[10px]"
              letterClassName="text-[9px]"
            />
          ))}
          {overflowCount > 0 && (
            <span className="w-5 h-5 rounded-md ring-2 ring-dashboardBg bg-white/10 flex items-center justify-center text-[9px] font-bold text-white">
              +{overflowCount}
            </span>
          )}
        </div>
      )}
      <button
        onClick={onToggleSheet}
        aria-label={sheetExpanded ? "Collapse to review plate" : "Expand search"}
        className="shrink-0 h-5 w-5 flex items-center justify-center text-white/70 active:text-white"
      >
        {sheetExpanded ? <ChevronDown className="w-5 h-5" strokeWidth={2} /> : <ChevronUp className="w-5 h-5" strokeWidth={2} />}
      </button>
    </div>
  );
}

function BudgetBadge({ label, pct }: { label: string; pct: number }) {
  return (
    <span className="flex flex-col items-center gap-1 min-w-0">
      <span className="h-5 flex items-center text-[11px] font-medium text-white whitespace-nowrap tabular">{label}</span>
      <span className="block h-[3px] w-10 rounded-full bg-dashboardTrack overflow-hidden">
        <span className="block h-full rounded-full bg-white/70" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

// A small centered confirmation, not a native window.confirm() — this app
// builds its own dark-themed dialogs/sheets everywhere else, and a native
// browser prompt would look jarringly out of place here. z-[70], above both
// the modal itself (z-50) and the barcode scanner (z-[60]), since either
// could in principle be what's open when this fires (though in practice only
// the browse step's X button triggers it).
function UnloggedPlateWarning({
  count,
  onKeepEditing,
  onCloseAnyway,
}: {
  count: number;
  onKeepEditing: () => void;
  onCloseAnyway: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6" onClick={onKeepEditing}>
      <div
        className="w-full max-w-xs rounded-2xl bg-dashboardCard border border-white/10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-white">
          {count} unlogged item{count === 1 ? "" : "s"} on your plate
        </p>
        <p className="text-[13px] text-muted mt-1.5 leading-snug">
          {count === 1 ? "It hasn't" : "They haven't"} been logged yet. {count === 1 ? "It" : "They"}'ll still be here
          if you come back, but will be lost if you refresh or fully close the app.
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onKeepEditing}
            className="flex-1 py-2.5 rounded-full border border-white/15 text-sm font-medium text-white active:bg-white/5"
          >
            Keep editing
          </button>
          <button
            onClick={onCloseAnyway}
            className="flex-1 py-2.5 rounded-full bg-white text-sm font-bold text-black active:bg-white/90"
          >
            Close anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// The one place "Search for a food" and "Log Foods" live — previously the
// search input was tab-specific footer content inside the sheet (Layer 2)
// while Log Foods floated as its own absolutely-positioned pill elsewhere,
// which visually read as two unrelated controls and moved independently as
// the sheet expanded/collapsed. Unifying them into a single pinned row fixes
// both: the search pill keeps its own consistent shape and position
// regardless of tab (showing the real input on the Search tab, or a
// tap-to-switch affordance on the others — this app has more than one
// logging mode, unlike a plain search-only sheet, so "always show a search
// pill" only works if the other tabs get a sensible non-input version of it
// rather than nothing), and the button next to it never has to be told
// where the sheet currently is.
function ActionBar({
  activeTab,
  onFocusSearch,
  query,
  setQuery,
  searchInputRef,
  stagedPlate,
  onLogFoods,
}: {
  activeTab: Tab;
  onFocusSearch: () => void;
  query: string;
  setQuery: (q: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  stagedPlate: PlateItem[];
  onLogFoods: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-dashboardBg border-t border-white/10">
      <div className="flex-1 min-w-0">
        {activeTab === "search" ? (
          <div className="flex items-center gap-2 rounded-full bg-dashboardChip px-4 py-2.5 min-w-0">
            <SearchIcon className="w-4 h-4 text-muted shrink-0" strokeWidth={2} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a food"
              className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={onFocusSearch}
            className="w-full flex items-center gap-2 rounded-full bg-dashboardChip px-4 py-2.5 min-w-0 text-left"
          >
            <SearchIcon className="w-4 h-4 text-muted shrink-0" strokeWidth={2} />
            <span className="text-sm text-muted truncate">Search for a food</span>
          </button>
        )}
      </div>
      <button
        onClick={onLogFoods}
        disabled={stagedPlate.length === 0}
        className="shrink-0 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50"
      >
        {stagedPlate.length > 0 ? `Log Foods (${stagedPlate.length})` : "Log Foods"}
      </button>
    </div>
  );
}

// Renders at the top of the browse step's scrollable body, above the mode
// tabs — only mounted by the caller once stagedPlate is non-empty (see the
// `stagedPlate.length > 0 &&` guard around it), so there's no blank state to
// own here anymore.
function StagedPlateSection({
  stagedPlate,
  plateTotals,
  totals,
  targets,
  nutritionView,
  setNutritionView,
  editingPlateKey,
  setEditingPlateKey,
  updatePlateItemQuantity,
  removeFromPlate,
}: {
  stagedPlate: PlateItem[];
  plateTotals: Nutrition;
  totals?: Nutrition;
  targets?: MacroTargets | null;
  nutritionView: "plate" | "day";
  setNutritionView: (v: "plate" | "day") => void;
  editingPlateKey: string | null;
  setEditingPlateKey: (key: string | null) => void;
  updatePlateItemQuantity: (key: string, quantityGrams: number) => void;
  removeFromPlate: (key: string) => void;
}) {
  return (
    <div>
      <h2 className="px-4 pt-4 pb-2 text-base font-bold text-white">Your Plate</h2>
      {stagedPlate.map((item) => {
        const n = scaleNutrition(item.food, item.quantityGrams);
        const isEditingQty = editingPlateKey === item.key;
        return (
          <div
            key={item.key}
            className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-dashboardDivider/60"
          >
            <FoodIconAvatar name={item.food.name} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-white truncate">{item.food.name}</span>
              <span className="block text-[11px] text-muted truncate mt-1 tabular">
                {fmt(n.protein)}P {fmt(n.fat)}F {fmt(n.carbs)}C · {fmt(n.calories)} kcal
              </span>
            </span>
            {isEditingQty ? (
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                defaultValue={item.quantityGrams}
                onBlur={(e) => {
                  updatePlateItemQuantity(item.key, Math.max(0, Number(e.target.value) || 0));
                  setEditingPlateKey(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="w-16 shrink-0 tabular text-sm text-white bg-dashboardChip rounded-full px-3 py-1.5 text-center focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setEditingPlateKey(item.key)}
                className="shrink-0 tabular text-xs text-white rounded-full bg-dashboardChip px-3 py-1.5"
              >
                {fmt(item.quantityGrams)} g
              </button>
            )}
            <button
              onClick={() => removeFromPlate(item.key)}
              aria-label={`Remove ${item.food.name}`}
              className="text-muted text-lg leading-none px-1 shrink-0 active:text-white"
            >
              ×
            </button>
          </div>
        );
      })}

      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <p className="text-[11px] tracking-widest uppercase text-muted">Nutrition</p>
        <div className="flex rounded-full bg-dashboardChip p-0.5 text-[11px]">
          <button
            onClick={() => setNutritionView("plate")}
            className={`px-3 py-1 rounded-full transition-colors ${
              nutritionView === "plate" ? "bg-white text-black font-medium" : "text-muted"
            }`}
          >
            Plate
          </button>
          <button
            onClick={() => setNutritionView("day")}
            className={`px-3 py-1 rounded-full transition-colors ${
              nutritionView === "day" ? "bg-white text-black font-medium" : "text-muted"
            }`}
          >
            Day
          </button>
        </div>
      </div>

      <div className="px-4 pb-4 grid grid-cols-2 gap-3">
        {NUTRITION_METRICS.map((m) => {
          const plateVal = plateTotals[m.key];
          const shownVal = nutritionView === "plate" ? plateVal : (totals?.[m.key] ?? 0) + plateVal;
          const target = targetFor(targets, m.key);
          // NUTRITION_METRICS leaves calories' own `unit` blank (nothing to
          // show inline next to a bare kcal figure elsewhere in the app), but
          // the subtext line here needs a real unit word regardless.
          const unitLabel = m.key === "calories" ? "kcal" : m.unit;
          return (
            <div key={m.key} className="rounded-2xl bg-dashboardCard px-3.5 py-3">
              <p className="text-[11px] text-muted">{m.label}</p>
              <p className="tabular text-base font-semibold text-white mt-0.5">{fmt(shownVal)}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {fmt(shownVal)} {unitLabel} {nutritionView === "plate" ? "in plate" : "today"}
              </p>
              <span className="block h-[3px] w-full rounded-full bg-dashboardTrack overflow-hidden mt-2">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct(shownVal, target)}%`, backgroundColor: m.color }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact fields mirroring QuickAddSheet.tsx's logic (calories auto-fill from
// whichever macros are entered, but stay directly editable) — kept as its
// own small component here rather than reusing QuickAddSheet itself, since
// that component renders its own BottomSheet and is used standalone
// elsewhere (QuickActionFlow's "Quick add" shortcut). Submitting stages the
// newly created food (onCreated = addToPlate) and resets the form instead
// of closing the sheet, so a few quick-adds in a row can all land on the
// same plate before one batch commit.
function QuickAddTab({
  createFood,
  onCreated,
}: {
  createFood: ReturnType<typeof useCreateFood>;
  onCreated: (food: Food) => void;
}) {
  const [name, setName] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [calories, setCalories] = useState("");

  useEffect(() => {
    if (!protein.trim() && !carbs.trim() && !fat.trim()) return;
    const p = Number(protein) || 0;
    const c = Number(carbs) || 0;
    const f = Number(fat) || 0;
    setCalories(String(Math.round(p * 4 + c * 4 + f * 9)));
  }, [protein, carbs, fat]);

  const canSave = name.trim() !== "" && calories.trim() !== "";

  function submit() {
    if (!canSave) return;
    createFood.mutate(
      {
        name: name.trim(),
        servingSizeGrams: 100,
        caloriesPer100g: Number(calories) || 0,
        proteinPer100g: Number(protein) || 0,
        carbsPer100g: Number(carbs) || 0,
        fatPer100g: Number(fat) || 0,
      },
      {
        onSuccess: (food) => {
          onCreated(food);
          setName("");
          setProtein("");
          setCarbs("");
          setFat("");
          setCalories("");
        },
      }
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Restaurant lunch"
            className="w-full rounded-md bg-dashboardCard border border-dashboardDivider px-3 py-2.5 text-sm text-white placeholder:text-muted focus:outline-none focus:border-white/40"
          />
        </label>
        <p className="text-[11px] tracking-widest uppercase text-muted pt-1">
          Macros — fill in what you know, calories fill themselves in
        </p>
        <div className="grid grid-cols-2 gap-3">
          <QuickAddField label="Protein" value={protein} onChange={setProtein} suffix="g" />
          <QuickAddField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" />
          <QuickAddField label="Fat" value={fat} onChange={setFat} suffix="g" />
          <QuickAddField label="Calories" value={calories} onChange={setCalories} suffix="kcal" />
        </div>
      </div>
      <div className="p-4 shrink-0">
        <button
          onClick={submit}
          disabled={!canSave || createFood.isPending}
          className="w-full py-3 rounded-full bg-white text-sm font-bold text-black disabled:opacity-50"
        >
          Add to Plate
        </button>
      </div>
    </>
  );
}

function QuickAddField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1">{label}</span>
      <div className="flex items-center rounded-md bg-dashboardCard border border-dashboardDivider px-3 focus-within:border-white/40">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tabular w-full bg-transparent py-2.5 text-sm text-white focus:outline-none"
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

// Single-item precise quantity entry — still used, but only for editing an
// already-logged entry or logging a preselected recipe (QuickActionFlow's
// recipe picker), neither of which goes through the plate. Everything else
// (Search/Scan/Quick Add/Custom taps) stages onto stagedPlate instead and
// adjusts quantity later via the Plate Review's quantity pill.
function QuantityStep({
  food,
  grams,
  setGrams,
  isEditing,
  onBack,
  onConfirm,
  onRemove,
}: {
  food: Food;
  grams: number;
  setGrams: (g: number) => void;
  isEditing: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onRemove?: () => void;
}) {
  const nutrition = scaleNutrition(food, grams);
  const chips = [
    food.servingSizeGrams && { label: `1 serving (${food.servingSizeGrams}g)`, value: food.servingSizeGrams },
    { label: "50 g", value: 50 },
    { label: "100 g", value: 100 },
    { label: "150 g", value: 150 },
  ].filter(Boolean) as { label: string; value: number }[];

  return (
    <>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="text-muted text-lg leading-none px-1">
          ‹
        </button>
        <span className="text-sm font-medium truncate">{food.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        <div className="flex items-center justify-center gap-4 py-4">
          <button
            onClick={() => setGrams(Math.max(1, grams - 10))}
            className="h-10 w-10 rounded-full border border-line text-lg active:bg-surface-raised"
          >
            −
          </button>
          <div className="flex items-baseline gap-1">
            <input
              type="number"
              inputMode="decimal"
              value={grams}
              onChange={(e) => setGrams(Math.max(0, Number(e.target.value) || 0))}
              className="tabular w-24 bg-transparent text-3xl text-center border-b-2 border-transparent focus:outline-none focus:border-accent"
            />
            <span className="text-sm text-muted">g</span>
          </div>
          <button
            onClick={() => setGrams(grams + 10)}
            className="h-10 w-10 rounded-full border border-line text-lg active:bg-surface-raised"
          >
            +
          </button>
        </div>

        <div className="flex flex-wrap gap-2 justify-center pb-4">
          {chips.map((chip) => (
            <button
              key={chip.label}
              onClick={() => setGrams(chip.value)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                grams === chip.value ? "border-accent text-accent" : "border-line text-muted"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="border border-line rounded-md px-4 py-3 grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="tabular text-sm">{Math.round(nutrition.calories)}</div>
            <div className="text-[11px] text-muted">kcal</div>
          </div>
          <div>
            <div className="tabular text-sm text-protein">{nutrition.protein.toFixed(1)}</div>
            <div className="text-[11px] text-muted">protein</div>
          </div>
          <div>
            <div className="tabular text-sm text-carbs">{nutrition.carbs.toFixed(1)}</div>
            <div className="text-[11px] text-muted">carbs</div>
          </div>
          <div>
            <div className="tabular text-sm text-fat">{nutrition.fat.toFixed(1)}</div>
            <div className="text-[11px] text-muted">fat</div>
          </div>
        </div>
      </div>

      <div className="p-4 shrink-0 flex gap-2">
        {onRemove && (
          <button
            onClick={onRemove}
            className="px-4 py-3 rounded-md border border-line text-sm text-muted"
          >
            Remove
          </button>
        )}
        <button
          onClick={onConfirm}
          disabled={grams <= 0}
          className="flex-1 py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
          style={{ color: "#0B1210" }}
        >
          {isEditing ? "Save" : "Add"}
        </button>
      </div>
    </>
  );
}
