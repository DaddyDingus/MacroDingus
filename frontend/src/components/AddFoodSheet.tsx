import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search as SearchIcon,
  ScanBarcode,
  Zap,
  Plus,
  Library as LibraryIcon,
  Sparkles,
  Loader2,
  Camera,
  ChevronLeft,
  ChevronRight,
  ChefHat,
  Link2,
  Flame,
  type LucideIcon,
} from "lucide-react";
import type { Food, LogEntry, Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { useFoodSearch, useCreateFood, useCustomFoods, useBarcodeLookup, useDeleteFood, useDescribeMeal, recordFoodSearchSelection } from "../api/foods";
import { useFavorites, useAddFavorite, useRemoveFavorite } from "../api/favorites";
import { useRecipes, useRecipeDetail, useCreateRecipe, useUpdateRecipe, useDeleteRecipe, useImportRecipeUrl, useImportRecipePhoto, type RecipeSummary } from "../api/recipes";
import { useAddLog, useBulkAddLog, useUpdateLogQuantity, useDeleteLog, useSmartHistory } from "../api/logs";
import { scaleNutrition, sumNutrition, subtractNutrition } from "../lib/nutrition";
import { localTimeString, localIsoNoTz, formatLogTime, loggedAtTimeString, buildLoggedAt } from "../lib/date";
import { usePlateState, type PlateItem } from "../lib/quickAddPlate";
import { useEnergyUnit, kcalToUnit, unitToKcal, energyUnitLabel, formatEnergy, type EnergyUnit } from "../lib/energyUnit";
import { useVisualViewportMetrics } from "../lib/useVisualViewportMetrics";
import { useBackDismissDepth } from "../lib/useBackDismiss";
import { lockBodyScroll, unlockBodyScroll } from "../lib/bodyScrollLock";
import FoodIconAvatar from "./FoodIconAvatar";
import CreateFoodForm from "./CreateFoodForm";
import RecipeForm, { type RecipeFormInitial } from "./RecipeForm";
import DraggableSnapSheet from "./DraggableSnapSheet";
import FoodDetailScreen from "./FoodDetailScreen";
import NutrientStatusBar, { LogTimePill } from "./NutrientStatusBar";
import ModalMacroHeader from "./ModalMacroHeader";
import DateTimePickerSheet from "./DateTimePickerSheet";
import ConfirmDeleteSheet from "./ConfirmDeleteSheet";
import PhotoSourceSheet from "./PhotoSourceSheet";
import DiscardWarningSheet from "./DiscardWarningSheet";
import { foodMeasures } from "../lib/foodMeasures";
import DecimalInput from "./DecimalInput";
import SwipeToDeleteRow from "./SwipeToDeleteRow";

// zxing's decoder is ~400kB and only ever needed for the occasional barcode
// scan, not the everyday search-and-log path — split it into its own chunk
// so it doesn't weigh down the initial load.
const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

type Step = "browse" | "create" | "scan" | "recipe" | "recipeChoice" | "recipeImportUrl" | "recipeImportPhoto" | "detail";
// Where a hardware/gesture back press from each sub-step should land — reads
// the same as each step's own visible back button, since requestClose()
// below drives both from this one map. Most steps are one hop from "browse"
// (the sheet's own home view), but "recipeImportUrl" sits one level deeper,
// behind "recipeChoice" — collapsing it straight to "browse" (the old flat
// Set version of this) would skip the chooser screen on a single back press,
// same class of bug the Goal/Program wizards had before their own
// useBackDismiss wiring. Steps absent here (browse) aren't "sub-steps" —
// requestClose treats those as a real dismissal instead. "detail" is
// deliberately absent too, unlike every other step that fully replaces this
// sheet's own header/body: FoodDetailScreen owns its own back-dismiss
// trap(s) internally (one for the screen itself, nested with a second for
// its own custom keypad — see FoodDetailScreen's own useBackDismiss calls),
// so this sheet must contribute zero extra depth for it or its trap ends up
// on top of FoodDetailScreen's, swallowing the first press before either of
// its traps ever sees it. This is the same reason editingEntry forces
// subStepDepth to 0 below regardless of step — that path already relied on
// FoodDetailScreen owning its own dismissal; this just makes every path
// into "detail" consistent with it, not only that one.
// How many back presses it takes to walk `step` back to "browse" — i.e. how
// many history entries this sheet needs on top of the one for the sheet
// itself. Follows the same chain requestClose does, so the two can't drift.
function subStepDepth(step: Step): number {
  let depth = 0;
  let current: Step | undefined = step;
  while (current && SHEET_SUB_STEP_BACK[current]) {
    current = SHEET_SUB_STEP_BACK[current];
    depth++;
  }
  return depth;
}

const SHEET_SUB_STEP_BACK: Partial<Record<Step, Step>> = {
  create: "browse",
  scan: "browse",
  recipe: "browse",
  recipeChoice: "browse",
  recipeImportUrl: "recipeChoice",
  recipeImportPhoto: "recipeChoice",
};
type Tab = "search" | "quickAdd" | "describe" | "library";
type LibraryView = "recipes" | "foods" | "favorites";

interface DescribeAction {
  canSubmit: boolean;
  pending: boolean;
  submit: () => void;
}

// Order matches the redesign spec: Search, Scan, Quick Add, Library. There
// used to be a fifth "Custom" tab with its own "Create custom food"/"Create
// recipe" buttons — removed as a straight duplicate of the Library tab's own
// "+" button (view === "recipes" ? onCreateRecipe : onCreateFood, see
// LibraryTab below), which already reaches both of the same "create" steps.
// "scan" isn't a Tab value (it launches the fullscreen camera step instead
// of switching the browse pane), so it's flagged separately here rather than
// folded into the Tab union. "describe" sits right before Library — it's a
// library-adjacent shortcut (stages real, persisted foods just like the
// other tabs do), not a peer of Search/Scan the way Quick Add is.
const BASE_TAB_BAR_ITEMS: { id: Tab | "scan"; label: string; icon: LucideIcon }[] = [
  { id: "search", label: "Search", icon: SearchIcon },
  { id: "scan", label: "Scan", icon: ScanBarcode },
  { id: "quickAdd", label: "Quick Add", icon: Zap },
  { id: "describe", label: "Describe", icon: Sparkles },
  { id: "library", label: "Library", icon: LibraryIcon },
];

// The Search/Scan/Quick Add/Custom sheet (Layer 2) sits over the Plate View
// (Layer 1, the full-screen background) rather than the other way around —
// a "Google Maps" style dual layer. Expanded covers the full contentHeight
// (no Plate View peek — the user asked for the sheet to always stay at this
// taller layout rather than dropping down to reveal a sliver of the plate
// whenever the keyboard closes). COLLAPSED shrinks the sheet's own real
// height (see DraggableSnapSheet) down to just this peek height (grabber +
// the compact tab-icon row), fully revealing the plate underneath — a plain
// px constant (not measured, not a percentage of contentHeight) since it
// doesn't need to be pixel-perfect the way the real-viewport height/header
// height below do (those chase actual iOS keyboard/notch behavior; this
// doesn't) — just comfortably bigger than the grabber (44px — a standard
// touch-target height, since DraggableSnapSheet's own handle was widened for
// easier grabbing) + collapsed row's own natural height so nothing in the
// collapsed content gets clipped.
const SHEET_COLLAPSED_PEEK_PX = 96;

const NUTRITION_METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; letter: string; color: string }[] = [
  // Same categorical hex values as tailwind.config.js / MacroSummaryBar.tsx
  // (calories=blue, protein=orange, fat=yellow, carbs=green) — reused as-is
  // rather than introducing a separate "coral" for protein, since this
  // exact four-color set is the one used everywhere else in the app.
  { key: "calories", label: "Calories", letter: "", color: "#749EF4" },
  { key: "protein", label: "Protein", letter: "P", color: "#EF8D6A" },
  { key: "fat", label: "Fat", letter: "F", color: "#F7D372" },
  { key: "carbs", label: "Carbs", letter: "C", color: "#5ABC80" },
];

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
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
  onLogged,
  initialStep,
  initialFood,
  forcedLoggedAt,
  totals,
  targets,
  onPickItems,
  // Defaulted here, not just on ActionBar below — the floating collapsed-
  // state commit button reads this same prop directly (not through
  // ActionBar), so a default that only lived on ActionBar left that button
  // rendering the literal text "undefined" for every caller that doesn't
  // pass this explicitly (i.e. every caller except RecipeForm).
  commitLabel = "Log Foods",
}: {
  open: boolean;
  date: string;
  editingEntry: LogEntry | null;
  onClose: () => void;
  // Called only after a real log mutation succeeds. Global quick actions use
  // this to leave whichever screen launched them and reveal the Food Log;
  // ingredient-picking mode never calls it because that does not create logs.
  onLogged?: () => void;
  // Lets callers outside the timeline's own "+ Log food" button (the global
  // quick-actions sheet, a recipe picker) skip straight to scanning, the
  // library's Recipes view, the new-food form, or a preselected food's
  // quantity step instead of always landing on search.
  initialStep?: "search" | "scan" | "create" | "describe" | "recipe" | "library";
  initialFood?: Food;
  // Overrides the default "now" timestamp everything staged here gets
  // logged under — set by the Food Log's per-group "+" button so items
  // added from there land at that group's own time instead of the moment
  // the sheet happened to be opened, joining/extending that same time-group
  // with zero extra taps.
  forcedLoggedAt?: string;
  // Today's running totals/targets, for the header's "N left" budget badges
  // and the Plate Review's Day-impact nutrition view. Optional — callers
  // that haven't loaded a check-in yet just get badge-less/target-less UI
  // rather than a broken one.
  totals?: Nutrition;
  targets?: MacroTargets | null;
  // Recipe-ingredient-picker mode (RecipeForm's "+" button): most picks
  // (search "+", Quick Add, Describe) stage onto the same plate regular
  // logging uses — nothing lands in the recipe until the bottom bar's
  // commitLabel button ("Add Ingredients") is actually tapped, which hands
  // the whole staged batch to this callback instead of POSTing it to
  // today's log via bulkAddLog (see confirmPlate). Swiping the sheet away
  // (or the X) without tapping it discards whatever was staged this session
  // — same "unlogged plate" confirmation regular logging already has (see
  // requestClose/DiscardWarningSheet), just with recipe-appropriate copy.
  // The header's icon row (BrowseHeader's pickedFoods) is sourced straight
  // from this same staged plate. Food Detail's own "Add" is the one
  // exception — it calls this directly per-item instead of staging (see the
  // "detail" step's onAdd below), since setting an exact quantity there and
  // tapping Add is already a deliberate, considered action.
  onPickItems?: (items: { food: Food; quantityGrams: number }[]) => void;
  // Overrides the "Log Foods" copy everywhere it'd otherwise appear —
  // factually wrong once onPickItems is set, since nothing is being logged.
  commitLabel?: string;
}) {
  const [step, setStep] = useState<Step>("browse");
  // Mirrors `step` so requestClose (handed to useBackDismiss) always reads
  // the current value — see requestClose's own comment.
  const stepRef = useRef<Step>(step);
  stepRef.current = step;
  const [activeTab, setActiveTab] = useState<Tab>("search");
  const [describeAction, setDescribeAction] = useState<DescribeAction | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>("recipes");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  // True only for the initialFood open path (QuickActionFlow's recipe
  // picker) — Food Detail's "Add" commits immediately there instead of
  // staging, same as this screen's "Log Foods" already does, since a food
  // staged-but-not-logged is silently dropped on close (see quickAddPlate.tsx)
  // and this entry point's old single-button screen never had that footgun.
  const [quickLogInitialFood, setQuickLogInitialFood] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string | undefined>(undefined);
  // Set only by Food Detail's "To custom" button — seeds the "create" step's
  // form with an existing food's nutrition data so editing-then-saving
  // produces a separate new food. Cleared on every open (reset effect below)
  // and after leaving the "create" step, so a later, unrelated "Create
  // custom food" tap doesn't inherit a stale prefill.
  const [createPrefillFood, setCreatePrefillFood] = useState<Food | null>(null);
  // The "recipeImportUrl" step's own input/result state — url as typed, an
  // error from the last attempt (if any), and the parsed draft once a fetch
  // succeeds. The draft is handed to RecipeForm as `initial` the same way
  // CreateRecipeFromGroupSheet already pre-fills a brand-new (not yet saved)
  // recipe — see that component's own comment for why `initial` doesn't mean
  // "already persisted" here. Reset on every open (reset effect below).
  const [recipeImportUrlInput, setRecipeImportUrlInput] = useState("");
  const [recipeImportError, setRecipeImportError] = useState<string | null>(null);
  const [recipeImportInitial, setRecipeImportInitial] = useState<RecipeFormInitial | null>(null);
  // The "recipeImportPhoto" step's own error state — separate from the URL
  // import's above so switching between the two chooser options never shows
  // a stale error from the other one. Two hidden file inputs (camera vs
  // library), same PhotoSourceSheet-routed pattern as DescribeTab's own
  // photo attach — that component's refs are scoped to itself, not reusable
  // here.
  const [recipeImportPhotoError, setRecipeImportPhotoError] = useState<string | null>(null);
  const [recipePhotoDescription, setRecipePhotoDescription] = useState("");
  const [recipePhotoFile, setRecipePhotoFile] = useState<File | null>(null);
  const [recipePhotoPreviewUrl, setRecipePhotoPreviewUrl] = useState<string | null>(null);
  const recipePhotoCameraInputRef = useRef<HTMLInputElement>(null);
  const recipePhotoLibraryInputRef = useRef<HTMLInputElement>(null);
  const [recipePhotoSourcePickerOpen, setRecipePhotoSourcePickerOpen] = useState(false);
  // Set only by Food Detail's recipe "Edit" action — reuses the same
  // "recipe" step/RecipeForm/recipeImportInitial prefill machinery as
  // create-from-scratch and URL import, but with a real recipe id behind it
  // so the step's onCreated PATCHes in place instead of POSTing a new
  // recipe. Must be cleared on every other path into the "recipe" step
  // (From scratch, URL import, every open) or a stale id would silently
  // turn the next unrelated recipe creation into an update of this one.
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  // Food Detail's recipe Edit/Explode/Duplicate actions all need the full
  // ingredient breakdown, which FoodDetailScreen never has (it only knows
  // the materialized `foods` row) — this drives a one-shot useRecipeDetail
  // fetch by id, consumed by the effect below once it resolves.
  const [pendingRecipeAction, setPendingRecipeAction] = useState<{ recipeId: string; action: "edit" | "explode" | "duplicate" } | null>(null);
  // Which snap point the Search sheet (Layer 2) is at — expanded by default
  // whenever the modal opens (see the reset effect below), toggled by the
  // header's chevron, a drag on the sheet's own grabber, or tapping a tab
  // while collapsed.
  const [sheetExpanded, setSheetExpanded] = useState(true);
  // Kept in sync eagerly inside the back handler as well as on render. A
  // second, very fast gesture can arrive before React has committed the
  // collapse; reading only the render closure there could consume the outer
  // sheet entry while trying to collapse an already-collapsing panel again.
  const sheetExpandedRef = useRef(sheetExpanded);
  sheetExpandedRef.current = sheetExpanded;
  // Which dismissal path opened the unlogged-plate confirmation. A UI tap can
  // give the dialog its normal history entry; gesture-back instead restores
  // the sheet's already-owned outer entry and shows an untrapped presentation
  // of the same dialog (see useBackDismissDepth below).
  const [closeWarningSource, setCloseWarningSource] = useState<"ui" | "gesture" | null>(null);
  // Gate for the Food Detail footer's "Delete" key specifically — every other
  // delete in the app goes through ConfirmDeleteSheet, this one used to call
  // removeEntry() straight away with no confirmation step.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Library's own Recipes/Foods swipe-to-delete (LibraryTab/FoodRow) — same
  // ConfirmDeleteSheet convention as every other delete, unlike the Plate/
  // Recipe-ingredient swipe rows this reuses the gesture from, which remove
  // a draft/staged item immediately with no confirm.
  const [pendingLibraryDelete, setPendingLibraryDelete] = useState<Food | null>(null);
  // What everything staged in this session actually logs under — starts at
  // forcedLoggedAt (a time-group's own time, set by the Food Log's per-group
  // "+" button) or "now", but is then just plain local state a tap on the
  // header's time pill can override, independent of whatever the caller
  // originally passed in. Reset alongside the plate on every open (see the
  // reset effect below) so a stale override from a previous session can't
  // leak into a fresh one.
  const [loggedAtOverride, setLoggedAtOverride] = useState<string>(() => forcedLoggedAt ?? localIsoNoTz());
  const [showTimePicker, setShowTimePicker] = useState(false);
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
  // Set by changeStep() when leaving "browse" while the search input was
  // focused — read back (and cleared) by changeStep() again when returning
  // to "browse", so the keyboard reopens automatically instead of leaving
  // the user to tap the search pill again themselves.
  const returnFocusToSearchRef = useRef(false);
  // Set when the sheet is opened via the dedicated "Search" shortcut
  // (initialStep === "search"), which explicitly signals "I want to type a
  // search right now." The Food Log's per-time-group "+" uses that same
  // explicit entry path, so it focuses consistently with the other search
  // buttons. Consumed (and cleared) by the effect below once the search tab's
  // input has actually mounted.
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);
  // Real visual-viewport metrics (not vh/%) so the full-screen modal and the
  // sheet-height math below stay correct as iOS Safari's on-screen keyboard
  // opens/closes — see the shared hook's own comment for why vh doesn't work
  // here. This component used to get this for free from BottomSheet; now
  // that Layer 1/Layer 2 need their own geometry, it's read directly.
  const { height: viewportHeight, offsetTop: viewportOffsetTop } = useVisualViewportMetrics();
  // The native shell already lays the WebView out inside Android's status-bar
  // inset, and fixed elements are relative to that visible WebView. Chromium
  // nevertheless reports the same inset again as visualViewport.offsetTop;
  // applying it here double-counts the top inset (84 physical px on the S24+)
  // and shifts BrowseHeader/FoodDetailScreen below TodayScreen's header. Web
  // Safari still needs the real offset while its keyboard pans the viewport.
  const modalViewportTop = window.MacroTrackAndroid?.isNativeApp?.() ? 0 : viewportOffsetTop;
  // The pinned header's real rendered height, measured rather than guessed —
  // it isn't a fixed single row (budget badges only show once targets have
  // loaded, the avatar stack only once something's staged), and Layer
  // 1/Layer 2 both need to know exactly how much space is left below it.
  // Re-measured whenever the "browse" step (which is what actually renders
  // BrowseHeader) becomes active again, since the ref's DOM node is a fresh
  // element each time that step mounts.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(96);
  // useLayoutEffect, not useEffect — measuring after paint meant the sheet's
  // very first frame rendered against the guessed default (96), then jumped
  // to the real measured height (and again for actionBarHeight below) once
  // this ran, animated by DraggableSnapSheet's own height transition. Two
  // back-to-back animated corrections right after opening (or after
  // expanding from the collapsed tab row, which also drives this same
  // height) read as a visible bounce rather than a clean single motion.
  // Measuring synchronously before paint means the correct height is what
  // gets painted first, with nothing left to animate away from.
  //
  // `open` has to be in the dependency array too, not just `step` — this
  // component is mounted permanently by its caller (`<AddFoodSheet open={...}
  // />`, a prop toggle, not conditional JSX), and renders `null` while
  // closed, which unmounts headerRef's actual DOM node. `step` stays
  // "browse" across an entire close/reopen cycle (nothing resets it), so an
  // effect keyed on `step` alone never re-fires when the ref's node remounts
  // on reopen — headerHeight was silently stuck at the guessed default
  // forever on the very first open of a session, with nothing left to ever
  // correct it. Re-running on every `open` toggle re-measures the fresh node
  // each time it actually (re)mounts.
  useLayoutEffect(() => {
    if (!open || step !== "browse") return;
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step, open]);
  // The pinned bottom action bar (search pill + Log Foods) is a normal flex
  // sibling after the Layer 1/Layer 2 region, not a `position: fixed`
  // overlay — it's already inside this component's own visual-viewport-
  // tracked wrapper, so ordinary flex flow keeps it correctly above the
  // iOS keyboard for free, and its height just needs to be subtracted from
  // Layer 1/Layer 2's own budget the same way the header's is.
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [actionBarHeight, setActionBarHeight] = useState(84);
  // Same useLayoutEffect + `open`-dependency reasoning as headerHeight above.
  // Ignores a 0px reading — ActionBar's own slot visually collapses (grid-
  // template-rows 0fr, see its own comment above) while the sheet is
  // collapsed, which genuinely shrinks this ref'd wrapper to ~0. Without
  // this guard, actionBarHeight would follow it down, contentHeight/
  // sheetPanelHeightPx would grow to match, and the moment the sheet
  // re-expands (ActionBar's real height instantly back via CSS, but this
  // state update is one ResizeObserver tick behind) DraggableSnapSheet would
  // read the still-stale, too-large panelHeight for that render's height
  // transition, then snap down once the corrected measurement lands —
  // visible as a brief overshoot-then-snap on every expand. Keeping the last
  // real (non-zero) measurement instead means contentHeight never actually
  // reflects the collapsed state, which is fine: it only ever needs to be
  // correct for sizing the *expanded* sheet.
  useLayoutEffect(() => {
    if (!open || step !== "browse") return;
    const el = actionBarRef.current;
    if (!el) return;
    const update = () => {
      const h = el.offsetHeight;
      if (h > 0) setActionBarHeight(h);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step, open]);
  const contentHeight = Math.max(0, viewportHeight - headerHeight - actionBarHeight);
  // The expanded sheet always takes the full contentHeight now — no Layer-1
  // peek strip, regardless of keyboard state. This used to collapse to 0
  // only while the keyboard was up and restore a 96px Plate View sliver once
  // it closed; the user asked for the sheet to stay at that taller layout
  // permanently instead of dropping back down when the keyboard closes.
  const sheetPanelHeightPx = contentHeight;

  useEffect(() => {
    if (!open) return;
    if (editingEntry) {
      // Editing an already-logged entry now opens the same Food Detail
      // screen a search result's row does (full nutrition breakdown, Impact
      // on Targets rings, unit toggles) instead of the old bare +/- stepper
      // — see the "detail" step's render below for the Delete/Save footer
      // this drives instead of Log Foods/Add.
      setSelectedFood(editingEntry.food);
      setStep("detail");
      setQuickLogInitialFood(false);
    } else if (initialFood) {
      // Same "detail" step editingEntry uses above, not a dedicated
      // single-item screen — see openFoodDetail's identical wiring for the
      // Library/Search tap path this now matches.
      setSelectedFood(initialFood);
      setStep("detail");
      setQuickLogInitialFood(true);
    } else {
      setSelectedFood(null);
      setStep(initialStep === "scan" ? "scan" : initialStep === "create" ? "create" : initialStep === "recipe" ? "recipeChoice" : "browse");
      setActiveTab(initialStep === "describe" ? "describe" : initialStep === "library" ? "library" : "search");
      if (initialStep === "library") setLibraryView("recipes");
      setPendingSearchFocus(initialStep === "search");
      setQuickLogInitialFood(false);
    }
    setQuery("");
    setDebouncedQuery("");
    setScannedBarcode(undefined);
    setCreatePrefillFood(null);
    setRecipeImportUrlInput("");
    setRecipeImportError(null);
    setRecipeImportPhotoError(null);
    setRecipePhotoDescription("");
    setRecipePhotoFile(null);
    if (recipePhotoPreviewUrl) URL.revokeObjectURL(recipePhotoPreviewUrl);
    setRecipePhotoPreviewUrl(null);
    setRecipeImportInitial(null);
    setEditingRecipeId(null);
    setPendingRecipeAction(null);
    setSheetExpanded(true);
    setCloseWarningSource(null);
    setLoggedAtOverride(forcedLoggedAt ?? localIsoNoTz());
    setShowTimePicker(false);
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

  // One history entry per back press this sheet can absorb: one for the sheet
  // itself, one for the expanded Search layer above Plate View, plus one for
  // each sub-step between here and "browse". The expansion entry stays owned
  // underneath fullscreen sub-steps (including FoodDetailScreen's own nested
  // traps), so returning to browse via back reveals an already-backed UI level
  // instead of pushing a new entry from a popstate-triggered render.
  //
  // Recipe ingredient picking has no Plate View/collapsed resting state, and
  // direct edit/initial-food detail opens have no browse layer behind them, so
  // none of those paths owns this extra level.
  const ownsExpansionLevel = !editingEntry && !initialFood && !onPickItems && sheetExpanded;
  // This used to be a single `useBackDismiss(open, requestClose)` that
  // re-armed itself on every press — see useBackDismiss.ts for why that exited
  // the app instead.
  //
  // editingEntry opens straight into "detail" with no browse state behind it.
  // FoodDetailScreen already owns both levels that path needs (keypad, then
  // screen), so the host must contribute zero entries. On the direct-edit
  // mount the parent's effect runs after the child's effects; claiming the
  // usual outer sheet entry here would put it on top of both detail entries,
  // making the first back press close the keypad and the whole sheet together.
  const proceedBlockedClose = useBackDismissDepth(
    open && !editingEntry ? 1 + (ownsExpansionLevel ? 1 : 0) + subStepDepth(step) : 0,
    handleBackDismiss,
    !editingEntry && !initialFood
      ? {
          // This blocker is attached only to the bottom/outer sheet entry.
          // Search expansion and sub-step entries above it are still consumed
          // normally before a gesture can attempt to leave the dirty plate.
          shouldBlock: () => stagedPlate.length > 0,
          onBlocked: () => setCloseWarningSource((current) => current === "gesture" ? null : "gesture"),
        }
      : undefined
  );

  useEffect(() => {
    if (!pendingSearchFocus || step !== "browse" || activeTab !== "search") return;
    searchInputRef.current?.focus();
    setPendingSearchFocus(false);
  }, [pendingSearchFocus, step, activeTab]);

  // Only the online OFF leg is debounced now. The local SQLite leg follows
  // `query` directly (see useFoodSearch) so a known food appears immediately;
  // typing "oats" still makes only one remote request after the pause instead
  // of hammering OFF with "o", "oa", "oat", "oats" back to back.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const search = useFoodSearch(query, debouncedQuery);
  const smartHistory = useSmartHistory(localTimeString());
  const addLog = useAddLog(date);
  const bulkAddLog = useBulkAddLog(date);
  const updateLog = useUpdateLogQuantity(date);
  const deleteLog = useDeleteLog(date);
  const createFood = useCreateFood();
  const deleteFood = useDeleteFood();
  const createRecipe = useCreateRecipe();
  // Empty-string fallback when nothing's being edited — safe since a
  // mutation hook doesn't do anything until .mutate() is actually called,
  // and editingRecipeId is only ever set right before that happens.
  const updateRecipe = useUpdateRecipe(editingRecipeId ?? "");
  const deleteRecipe = useDeleteRecipe();
  const importRecipeUrl = useImportRecipeUrl();
  const importRecipePhoto = useImportRecipePhoto();
  const barcodeLookup = useBarcodeLookup();
  const favorites = useFavorites();
  const recipes = useRecipes();
  const pendingRecipeDetail = useRecipeDetail(pendingRecipeAction?.recipeId ?? null);
  const customFoods = useCustomFoods();
  const addFavorite = useAddFavorite();
  const removeFavorite = useRemoveFavorite();

  // Same reasoning as BottomSheet.tsx's own lock: without it, the page
  // underneath this full-screen modal is still what useRubberBandScroll's
  // window-level touch listeners see. This modal isn't built on BottomSheet
  // (it's its own fixed full-screen createPortal, positioned against
  // visual-viewport metrics instead), so it never got that lock for free —
  // scrolling within e.g. CreateFoodForm's own internal list could get
  // hijacked mid-gesture into a rubber-band pull on `document.body` (which,
  // being `position: fixed`, doesn't even visually move), silently eating
  // the touch and making the reverse-scroll direction feel dead.
  // `overflow: hidden` alone doesn't reliably block touch-driven scroll of
  // the document on mobile Chrome/Safari (it stops wheel/keyboard scroll,
  // but a finger drag can still walk the document a few px per event even
  // with the ancestor `overflow: hidden`) — pinning body to the current
  // scroll offset via `position: fixed` is what actually prevents it, since
  // there's then no scrollable box left for the touch to move at all. Losing
  // this lock is what let the real background document scroll behind this
  // full-screen modal, which (via useVisualViewportMetrics reacting to the
  // resulting browser-chrome show/hide) made this modal's own
  // viewport-tracked top/height jitter in step with it. Goes through the
  // shared lockBodyScroll/unlockBodyScroll (not a local save/restore)
  // because this sheet can have its own BottomSheet-based children open on
  // top of it (ConfirmDeleteSheet, DiscardWarningSheet, ...) — a local
  // save/restore in each instance stomps on the other's snapshot when both
  // are briefly mounted together, eventually stranding the page permanently
  // unscrollable. See bodyScrollLock.ts.
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);

  // Fires once the id set by requestRecipeAction above actually resolves to
  // a full ingredient breakdown (FoodDetailScreen only ever has the
  // materialized `foods` row, never the recipe's own ingredients/servings).
  // Must stay above the `if (!open) return null` below — it used to sit
  // after it, which is a real Rules-of-Hooks violation (not just a lint
  // nit): this whole component returns null whenever `open` is false, so
  // any hook declared after that line is skipped entirely on a closed
  // render and only registered once `open` flips true, changing this
  // instance's hook count between renders. React's real (unminified)
  // error for that is "Rendered more hooks than during the previous
  // render" — in production this throws Minified React error #310, and
  // since this app has no error boundary anywhere, that uncaught throw
  // unmounts the whole tree: a blank screen with no way back except
  // reloading. Concretely reproduced via RecipeForm's own nested
  // AddFoodSheet (its "Add ingredient" button) instance, whose `open`
  // prop is a plain toggled boolean — exactly the false→true transition
  // that hits this.
  useEffect(() => {
    if (!pendingRecipeAction || !pendingRecipeDetail.data) return;
    const detail = pendingRecipeDetail.data;
    const { action, recipeId } = pendingRecipeAction;
    if (action === "explode") {
      // "Single serving size" per the recipe's own servings count — not
      // whatever quantity happens to be dialed into the detail screen's
      // input, which Explode ignores entirely.
      const perServing = 1 / Math.max(1, detail.servings);
      for (const ing of detail.ingredients) {
        addToPlate(ing.food, ing.quantityGrams * perServing);
      }
      changeStep("browse");
      setSheetExpanded(false);
    } else {
      // Edit and Duplicate both land on the same "recipe" step RecipeForm
      // already handles for create-from-scratch/URL-import, prefilled from
      // this recipe's real data — editingRecipeId is what tells that step's
      // onCreated to PATCH in place (Edit) instead of POSTing a new recipe
      // (Duplicate leaves it null, same as every other create path).
      setEditingRecipeId(action === "edit" ? recipeId : null);
      setRecipeImportInitial({
        name: detail.name,
        icon: detail.food.icon,
        servings: detail.servings,
        totalWeightGrams: detail.totalWeightGrams,
        ingredients: detail.ingredients.map((i) => ({ food: i.food, quantityGrams: i.quantityGrams })),
      });
      changeStep("recipe");
    }
    setPendingRecipeAction(null);
    // pendingRecipeDetail.data deliberately the only dep that matters here —
    // this should fire exactly once per requestRecipeAction call, right when
    // its fetch resolves, not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRecipeDetail.data]);

  if (!open) return null;

  const favoriteFoodIds = new Set(favorites.data?.map((f) => f.id));

  function dismissNativeKeyboard() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function closeSheet() {
    dismissNativeKeyboard();
    onClose();
  }

  function toggleFavorite(food: Food) {
    if (favoriteFoodIds.has(food.id)) {
      removeFavorite.mutate(food.id);
    } else {
      addFavorite.mutate(food.id);
    }
  }

  // Blurs whatever's currently focused, then changes step — must happen in
  // this order, synchronously, inside the same click that triggers a step
  // change (not a step-keyed useEffect afterward): by the time an effect
  // runs after the old step has already unmounted, the focused input (and
  // its focus state) is already gone, so blurring then is a no-op. Doing it
  // here, still inside the real user gesture/tap, is what actually gives a
  // mobile browser a chance to hide its on-screen keyboard as a direct
  // consequence of that tap — without this, leaving "browse" could leave a
  // stray keyboard open over e.g. the create/scan steps, with nothing left
  // focused for anything afterward to blur.
  //
  // Used to skip this for "detail" on the theory that FoodDetailScreen's own
  // quantity input would immediately reclaim focus (a real autoFocus <input>
  // back then), so the old keyboard could just stay put instead of closing
  // and reopening. That input became a fake on-page keypad (see its own
  // comment in FoodDetailScreen.tsx — a real input made back-dismiss exit
  // the whole screen) which never calls focus() on anything, so nothing was
  // left to reclaim the keyboard: the search input unmounts with it still
  // technically focused, and the real on-screen keyboard can linger with a
  // stale visualViewport (AddFoodSheet's own modal is sized off
  // viewportHeight/viewportOffsetTop) — reads as the whole modal, header
  // included, squeezed upward against a keyboard nothing on screen still
  // wants open. Blurring unconditionally here, same as every other step.
  //
  // Also remembers whether the search input specifically was the thing
  // focused when leaving "browse" — restored via the ref below when
  // navigating back to "browse" (detail/create/recipe's back button, or the
  // back-gesture routed through requestClose), so returning from e.g. a
  // search result's detail view lands back on "the exact state it was
  // before," keyboard and all, not just the right tab with no focus.
  function changeStep(next: Step) {
    if (next !== "browse") {
      returnFocusToSearchRef.current = activeTab === "search" && document.activeElement === searchInputRef.current;
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setStep(next);
    if (next === "browse" && returnFocusToSearchRef.current) {
      returnFocusToSearchRef.current = false;
      setPendingSearchFocus(true);
    }
  }

  // The universal "I picked this food" entry point for Search results, Scan
  // results, and anything created via the Custom tab's forms — stages it
  // rather than writing it anywhere, and returns to the browse view (which
  // also dismisses the fullscreen scanner, since that's driven by `step`).
  // Editing an existing log entry or logging a preselected recipe
  // (initialFood, from QuickActionFlow's recipe picker) never goes through
  // here — both start the sheet directly on the "detail" step instead,
  // since neither fits the multi-item staging model.
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
    if (activeTab === "search") recordFoodSearchSelection(query, food);
    addToPlate(food);
    changeStep("browse");
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
    setQuickLogInitialFood(false);
    changeStep("detail");
  }

  // Food Detail's "+ To custom" button — opens the same "create" step a
  // fresh custom food would, just pre-seeded with this food's own nutrition
  // data (see CreateFoodForm's prefillFood) so tweaking-then-saving produces
  // a separate new food rather than editing this one in place.
  function openCreateFromFood(food: Food) {
    setCreatePrefillFood(food);
    changeStep("create");
  }

  // Food Detail's Edit/Explode/Duplicate actions, shown only for a
  // food.source === "recipe" — resolved against the already-fetched
  // recipes summary list (recipe id, distinct from this food's own id, see
  // schema.ts's recipes.foodId) rather than a second lookup endpoint.
  function recipeIdForFood(foodId: string): string | undefined {
    return recipes.data?.find((r) => r.food.id === foodId)?.id;
  }

  function requestRecipeAction(food: Food, action: "edit" | "explode" | "duplicate") {
    const recipeId = recipeIdForFood(food.id);
    if (recipeId) setPendingRecipeAction({ recipeId, action });
  }

  // Same source-based branch Food Detail's own onDeleteFood already uses
  // (see the "detail" step's render below) — a recipe deletes via its
  // recipes.id, not the materialized foods.id LibraryTab's rows carry.
  function deleteLibraryFood(food: Food) {
    if (food.source === "recipe") {
      const recipeId = recipeIdForFood(food.id);
      if (recipeId) deleteRecipe.mutate(recipeId);
    } else {
      deleteFood.mutate(food.id);
    }
  }

  function saveEditedQuantity(quantityGrams: number, unit?: { unitType: string; unitMeasureName?: string }) {
    if (!editingEntry) return;
    updateLog.mutate({ id: editingEntry.id, quantityGrams, unitType: unit?.unitType, unitMeasureName: unit?.unitMeasureName });
    closeSheet();
  }

  function removeEntry() {
    if (!editingEntry) return;
    deleteLog.mutate(editingEntry.id);
    closeSheet();
  }

  function handleScan(barcode: string) {
    barcodeLookup.mutate(barcode, {
      onSuccess: (food) => openFoodDetail(food),
      onError: () => {
        setScannedBarcode(barcode);
        changeStep("create");
      },
    });
  }

  // Import-from-link's own submit — fetches+parses the page server-side (see
  // engine/recipeImport.ts), then hands the result to RecipeForm as a
  // pre-filled but still-unsaved draft via recipeImportInitial, same as
  // CreateRecipeFromGroupSheet's own group-to-recipe prefill.
  function submitRecipeImport() {
    const url = recipeImportUrlInput.trim();
    if (!url) return;
    setRecipeImportError(null);
    importRecipeUrl.mutate(url, {
      onSuccess: (result) => {
        setEditingRecipeId(null);
        setRecipeImportInitial({
          name: result.name,
          servings: result.servings,
          totalWeightGrams: result.totalWeightGrams ?? result.ingredients.reduce((sum, i) => sum + i.quantityGrams, 0),
          ingredients: result.ingredients,
        });
        changeStep("recipe");
      },
      onError: (err) => setRecipeImportError(err instanceof Error ? err.message : "Couldn't import a recipe from that link"),
    });
  }

  // Photo import's own submit — same shape/contract as submitRecipeImport
  // above, just a photo of a handwritten/printed ingredient list instead of
  // a URL (see engine/recipeImport.ts's importRecipeFromPhoto). Called
  // directly from the hidden file inputs' onChange, not a form submit.
  function submitRecipeImportPhoto(file: File) {
    setRecipeImportPhotoError(null);
    importRecipePhoto.mutate({ file, description: recipePhotoDescription }, {
      onSuccess: (result) => {
        setEditingRecipeId(null);
        setRecipeImportInitial({
          name: result.name,
          servings: result.servings,
          totalWeightGrams: result.totalWeightGrams ?? result.ingredients.reduce((sum, i) => sum + i.quantityGrams, 0),
          ingredients: result.ingredients,
        });
        changeStep("recipe");
      },
      onError: (err) => setRecipeImportPhotoError(err instanceof Error ? err.message : "Couldn't import a recipe from that photo"),
    });
  }

  // The batch commit — this project's equivalent of a single bulkAdd write,
  // via the same POST /api/logs/bulk endpoint the old multi-select flow
  // used (backend/src/routes/logs.ts), just fed from stagedPlate instead of
  // a checked-rows Set.
  function confirmPlate() {
    if (stagedPlate.length === 0 || bulkAddLog.isPending) return;
    const entries = stagedPlate.map((item) => ({
      food: item.food,
      quantityGrams: item.quantityGrams,
      unitType: item.unitType,
      unitMeasureName: item.unitMeasureName,
    }));
    if (onPickItems) {
      onPickItems(entries);
      clearPlate();
      closeSheet();
    } else {
      bulkAddLog.mutate(
        { entries, loggedAt: loggedAtOverride },
        {
          onSuccess: () => {
            clearPlate();
            dismissNativeKeyboard();
            (onLogged ?? onClose)();
          },
        }
      );
    }
  }

  // FoodDetailScreen's numpad "Log Foods" key — commits whatever's already
  // staged *plus* the food currently on screen, in one tap. Builds the
  // entries array explicitly rather than calling addToPlate() then
  // confirmPlate() back to back: setStagedPlate is regular React state, so
  // reading `stagedPlate` immediately after an addToPlate() call in the same
  // handler would still see the pre-update array (state hasn't re-rendered
  // yet), silently dropping the just-added item from the log.
  function confirmPlateWithExtra(
    food: Food,
    quantityGrams: number,
    unit?: { unitType: string; unitMeasureName?: string }
  ) {
    if ((stagedPlate.length === 0 && quantityGrams <= 0) || bulkAddLog.isPending) return;
    const entries = [
      ...stagedPlate.map((item) => ({
        food: item.food,
        quantityGrams: item.quantityGrams,
        unitType: item.unitType,
        unitMeasureName: item.unitMeasureName,
      })),
      ...(quantityGrams > 0
        ? [{ food, quantityGrams, unitType: unit?.unitType, unitMeasureName: unit?.unitMeasureName }]
        : []),
    ];
    if (onPickItems) {
      onPickItems(entries);
      clearPlate();
      closeSheet();
    } else {
      bulkAddLog.mutate(
        { entries, loggedAt: loggedAtOverride },
        {
          onSuccess: () => {
            clearPlate();
            dismissNativeKeyboard();
            (onLogged ?? onClose)();
          },
        }
      );
    }
  }

  // The X button's handler — staged items already survive closing this
  // sheet (see the reset effect above and lib/quickAddPlate.tsx), but that
  // persistence only covers reopening the sheet within the same running app
  // session, not a real page refresh/PWA relaunch, so it's still worth an
  // explicit heads-up before actually leaving with something unlogged.
  // The header X only — the back gesture routes through handleBackDismiss
  // just below instead. Step-aware either way: from detail/create/recipe/scan
  // both re-surface browse (in whatever tab, with whatever focus, changeStep()
  // already restores) rather than leaving the sheet entirely. editingEntry is
  // the exception — it drops straight into "detail" on open with no browse
  // state to go back to, so it closes immediately, same as that screen's own
  // "‹ Close" button.
  //
  // Reads stepRef (kept in sync every render, just below) rather than the
  // `step` from this render's closure — in practice `step` is already current
  // by the time a real press reaches it, but the ref removes any dependency on
  // that being true and costs nothing.
  function requestClose() {
    const backTarget = !editingEntry ? SHEET_SUB_STEP_BACK[stepRef.current] : undefined;
    if (backTarget) {
      changeStep(backTarget);
      return;
    }
    if (stagedPlate.length > 0) {
      setCloseWarningSource("ui");
    } else {
      closeSheet();
    }
  }

  // The back gesture's ordinary step/collapse/close handler. The outer entry
  // is now an opt-in blocker while the plate is dirty: it restores that same
  // entry with history.forward() and opens the confirmation before this
  // handler can close. No pushState occurs from popstate, preserving the
  // one-entry-per-level contract in useBackDismiss.ts.
  function handleBackDismiss() {
    const backTarget = !editingEntry ? SHEET_SUB_STEP_BACK[stepRef.current] : undefined;
    if (backTarget) {
      changeStep(backTarget);
      return;
    }
    if (!editingEntry && !initialFood && !onPickItems && sheetExpandedRef.current) {
      // This consumes the expansion entry and exposes Plate View. Update the
      // ref before scheduling React state so a rapid follow-up gesture sees
      // the collapsed state and can consume the outer sheet entry exactly
      // once, rather than no-oping against the same level twice.
      sheetExpandedRef.current = false;
      setSheetExpanded(false);
      return;
    }
    closeSheet();
  }

  const suggestions = query.trim() ? search.data : smartHistory.data?.foods;
  const suggestionsLabel = query.trim()
    ? "Results"
    : smartHistory.data?.basis === "time-of-day"
      ? "Usually around now"
      : "Recently logged";

  const plateTotals = sumNutrition(stagedPlate.map((item) => scaleNutrition(item.food, item.quantityGrams)));
  const commitDisabled = stagedPlate.length === 0 || bulkAddLog.isPending;

  // Portaled straight to <body>, same as BottomSheet.tsx and for the same
  // reason: this is mounted from several different call sites at very
  // different DOM depths (TodayScreen's own "+ Log food" button, the
  // Dashboard's ShortcutsBar, QuickActionFlow nested inside BottomNav's "+"
  // sheet), and some of those ancestors force their own stacking context
  // (e.g. the routed page-enter wrapper's opacity animation) that this
  // modal's z-50 can't out-rank from the inside — it only wins against
  // siblings within whatever context it's nested in. That let BottomNav's
  // own z-40 paint over this sheet's bottom action bar (double borders,
  // taps landing on the nav instead of the search input, keyboard unable to
  // reopen) specifically when opened via ShortcutsBar, since that path
  // doesn't happen to nest inside BottomNav the way the "+" button's own
  // menu does. Portaling to body sidesteps the whole ancestor-context
  // question regardless of call site.
  return createPortal(
    <>
    {/* The parent Logging Modal — genuinely full-screen (not a bottom sheet
        shell), positioned against real visual-viewport metrics rather than
        vh/inset-0 for the same iOS-keyboard reasons BottomSheet.tsx documents.
        Only the "browse" step gets the dual-layer Plate/Search treatment
        below; quantity/create/recipe are focused single-purpose steps that
        just fill this same full-screen container with their own header. */}
    <div
      // page-enter: same transform-free opacity fade App.tsx uses for routed
      // screens (see its own comment — a transform here would make this div a
      // new containing block for every position:fixed descendant it renders,
      // e.g. the barcode scanner). This component returns null while closed
      // and only renders this subtree once `open` flips true, so it's a fresh
      // DOM node — and therefore a fresh animation — on every open, regardless
      // of which step (browse/search/scan/create) it lands on.
      //
      // Recipe-picker mode's own "browse" step goes without the opaque
      // background here (and re-adds it explicitly on the header/Layer 2
      // below, which do need to stay legible) — the caller (RecipeForm, via
      // AddFoodSheet's own "recipe" step) is a second AddFoodSheet instance
      // rendered directly underneath this one, at the exact same visual-
      // viewport-tracked box, so leaving Layer 1's own region transparent
      // reveals the real Create Recipe screen through it while dragging
      // instead of a blank sliver — see Layer 1 below. Every other step
      // (detail/create/scan) still wants the normal opaque background
      // regardless of onPickItems, hence the `step === "browse"` half of
      // this check.
      className={`fixed inset-x-0 z-50 flex flex-col pb-[env(safe-area-inset-bottom)] page-enter ${
        step === "browse" && onPickItems ? "" : "bg-dashboardBg"
      }`}
      style={{ top: modalViewportTop, height: viewportHeight }}
    >
        {step === "browse" && (
          <>
            <div ref={headerRef} className={onPickItems ? "bg-dashboardBg" : undefined}>
              <BrowseHeader
                onClose={requestClose}
                totals={totals}
                plateTotals={plateTotals}
                targets={targets}
                stagedPlate={stagedPlate}
                timeLabel={formatLogTime(loggedAtOverride)}
                onTimeClick={() => setShowTimePicker(true)}
                pickedFoods={onPickItems ? stagedPlate.map((i) => i.food) : undefined}
              />
            </div>

            {/* Layer 1 (background) + Layer 2 (foreground) both live in this
                relative region, sized to exactly what's left below the header. */}
            <div className="relative flex-1 min-h-0">
              {/* Layer 1: Plate View — full-screen background. Bottom padding
                  reserves room for the Search sheet's collapsed peek, which is
                  always visible on top of it regardless of expand state.
                  Recipe-picker mode never renders StagedPlateSection here —
                  BrowseHeader's icon row above already shows what's staged,
                  and leaving this region empty is what lets the real Create
                  Recipe screen show through it (see the outer container's own
                  comment above). */}
              <div
                className="absolute inset-0 overflow-y-auto"
                style={{ paddingBottom: SHEET_COLLAPSED_PEEK_PX }}
              >
                {!onPickItems ? (
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
                ) : null}
              </div>

              {/* Layer 2 (foreground): the Search/Scan/Quick Add/Custom sheet. */}
              <DraggableSnapSheet
                expanded={sheetExpanded}
                onExpandedChange={(next) => {
                  // A downward handle swipe collapses this custom snap sheet
                  // rather than closing AddFoodSheet, so it never reaches
                  // BottomSheet.close() or closeSheet() above. Blur while the
                  // search input is still mounted; otherwise Android keeps
                  // its IME open over Plate View after the panel collapses.
                  if (!next) dismissNativeKeyboard();
                  // Recipe-picker mode has no real "collapsed" resting state
                  // of its own (no Plate View worth peeking at — see Layer 1
                  // above), so the collapse gesture instead means what it
                  // visually looks like: dismiss the sheet, back to the
                  // recipe screen. Goes through requestClose (not a bare
                  // onClose) so a non-empty staged plate still gets its
                  // discard confirmation, same as the X button.
                  if (!next && onPickItems) {
                    requestClose();
                    return;
                  }
                  setSheetExpanded(next);
                }}
                panelHeight={sheetPanelHeightPx}
                collapsedPeek={SHEET_COLLAPSED_PEEK_PX}
                panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
              >
                {(dragHandlers) => sheetExpanded ? (
                  <>
                    {/* Icon-over-label, matching the collapsed peek row's own shape
                        (below) instead of the old icon-beside-label row — that
                        horizontal pairing needed a horizontal scroll to fit all five
                        tabs, and a scroll affordance subtle enough to look
                        intentional (an edge fade, tried first) turned out not to
                        read as "scrollable" at a glance anyway. Stacking each
                        label under its icon is narrower per tab, so all five go
                        back to sharing the row at flex-1 equal widths with no
                        scrolling — the actual fix, not a better hint. Sharing the
                        sheet's own drag gesture on this row too (not just the
                        grabber above) — a plain tap on a tab still switches tabs as
                        normal (see DraggableSnapSheet's commit-threshold), a real
                        drag collapses/expands the sheet the same as dragging the
                        grabber. */}
                    <div {...dragHandlers} className="flex border-b border-dashboardDivider px-2 shrink-0 touch-none">
                      {BASE_TAB_BAR_ITEMS.map((t) => {
                        const active = t.id !== "scan" && activeTab === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => (t.id === "scan" ? changeStep("scan") : setActiveTab(t.id))}
                            className="flex-1 flex justify-center py-2"
                          >
                            {/* The border lives on this inline-content span, not the
                                flex-1 button, so the indicator hugs the icon+label
                                instead of the button's full equal-width tap target. */}
                            <span
                              className={`flex flex-col items-center gap-1 pb-1.5 border-b-2 transition-colors ${
                                active ? "border-accent text-white" : "border-transparent text-muted"
                              }`}
                            >
                              <t.icon className="w-4 h-4" strokeWidth={2} />
                              <span className="text-[10px] font-medium">{t.label}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* pb-4, not pb-2 — there's no longer an in-sheet search
                        footer sitting right below this to lean on for
                        breathing room; the last row needs its own.
                        onTouchStart blurs the search input (or Quick
                        Add/Describe's own field) the moment a touch lands
                        here — traced 2026-08-03: with the keyboard open and
                        this list short enough to have nothing to natively
                        scroll (e.g. an empty query with only a couple of
                        Recent items), Android Chrome was interpreting the
                        drag as a visual-viewport *pan* instead of a content
                        scroll — `visualViewport.offsetTop` climbing every
                        touchmove even though `window.scrollY` and this
                        modal's own body-scroll lock never moved. This
                        modal's outer wrapper deliberately tracks that same
                        offsetTop (needed for real iOS keyboard transitions),
                        so it was faithfully following the pan and jittering
                        up and down in lockstep. Dismissing the keyboard
                        before the drag can be reinterpreted that way is what
                        actually stops it — same "scroll list closes
                        keyboard" behavior most apps already have, not just a
                        workaround. */}
                    <div
                      className="flex-1 overflow-y-auto pb-4"
                      onTouchStart={() => {
                        const active = document.activeElement;
                        if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
                          active.blur();
                        }
                      }}
                    >
                      {activeTab === "search" && (
                        <div>
                          {!!favorites.data?.length && (
                            <div className="pt-2">
                              <div className="px-4 pb-1.5">
                                <p className="text-[11px] tracking-widest uppercase text-muted">Favourites</p>
                              </div>
                              <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-3">
                                {favorites.data.map((food) => (
                                  <button
                                    key={food.id}
                                    onClick={() => openFoodDetail(food)}
                                    className="shrink-0 w-14 flex flex-col items-center gap-1 active:opacity-70"
                                  >
                                    <FoodIconAvatar name={food.name} icon={food.icon} />
                                    <span className="w-full text-[10px] text-muted text-center leading-tight line-clamp-2">
                                      {food.name}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-3">
                            <p className="text-[11px] tracking-widest uppercase text-muted">{suggestionsLabel}</p>
                            {query.trim() && search.isFetchingRemote && (
                              <span className="flex items-center gap-1 text-[10px] text-muted">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Searching online
                              </span>
                            )}
                          </div>
                          {query.trim().length === 1 && (
                            <p className="px-4 py-3 text-sm text-muted">Type at least 2 characters to search.</p>
                          )}
                          {query.trim().length >= 2 && search.isLocalError && (
                            <div className="mx-4 my-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] px-3 py-3 flex items-center justify-between gap-3">
                              <p className="text-sm text-white/80">Local foods couldn&apos;t be loaded.</p>
                              <button
                                type="button"
                                onClick={() => void search.retryLocal()}
                                className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white active:bg-white/10"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                          {suggestions?.length === 0 && !search.isFetchingRemote && !search.isLocalError && (
                            <p className="px-4 py-3 text-sm text-muted">No foods found.</p>
                          )}
                          {suggestions?.map((food) => (
                            <FoodRow key={food.id} food={food} onOpen={openFoodDetail} onQuickAdd={pickFood} />
                          ))}
                        </div>
                      )}

                      {activeTab === "quickAdd" && <QuickAddTab createFood={createFood} onCreated={addToPlate} />}

                      {activeTab === "describe" && <DescribeTab onAdded={addToPlate} onActionChange={setDescribeAction} />}

                      {activeTab === "library" && (
                        <LibraryTab
                          view={libraryView}
                          setView={setLibraryView}
                          recipes={recipes.data}
                          customFoods={customFoods.data}
                          favorites={favorites.data}
                          onOpen={openFoodDetail}
                          onQuickAdd={pickFood}
                          onCreateFood={() => changeStep("create")}
                          onCreateRecipe={() => changeStep("recipeChoice")}
                          onRequestDelete={setPendingLibraryDelete}
                        />
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
                  // This whole peek row is the main thing on screen while
                  // collapsed, so it doubles as a big drag-to-expand surface too
                  // (same commit-threshold sharing as the expanded tab row above) —
                  // a plain tap on one of the icons still re-expands/switches tabs
                  // as normal.
                  <div {...dragHandlers} className="shrink-0 flex items-center px-2 py-1.5 touch-none">
                    {BASE_TAB_BAR_ITEMS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (t.id === "scan") {
                            changeStep("scan");
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

              {/* Floating commit button — replaces the pinned ActionBar
                  (search pill + commit button) while the sheet is collapsed
                  and nothing's being quantity-edited, so the collapsed Plate
                  View isn't permanently sharing its bottom edge with a search
                  box that has nothing to search against right now (the
                  sheet's own tab row is what re-opens search). Positioned
                  against SHEET_COLLAPSED_PEEK_PX directly (not a measured
                  ref) since the collapsed sheet's own height is that same
                  constant, not something that needs runtime measurement. */}
              {!sheetExpanded && !editingPlateKey && stagedPlate.length > 0 && (
                <button
                  onClick={confirmPlate}
                  disabled={commitDisabled}
                  className="absolute right-4 z-10 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black shadow-[0_4px_16px_rgba(0,0,0,0.35)] disabled:opacity-50"
                  style={{ bottom: SHEET_COLLAPSED_PEEK_PX + 12 }}
                >
                  {stagedPlate.length > 0 ? `${commitLabel} (${stagedPlate.length})` : commitLabel}
                </button>
              )}
            </div>

            {/* Unified pinned action bar — search pill + Log Foods, always in
                the same place together regardless of which tab is active. A
                normal flex sibling (not absolutely/fixed-positioned over
                Layer 1/Layer 2), so it can't drift out of sync with — or
                overlap — the collapsed sheet's own peek row the way two
                independently bottom-pinned elements could.
                While a plate item's quantity is being edited (Layer 1's
                "358 g" pill swapped for a live input — see StagedPlateSection),
                this same pinned slot shows quick-pick serving chips instead —
                reusing the spot ActionBar already keeps pinned just above the
                on-screen keyboard rather than teaching a second element that
                same visual-viewport-tracked positioning.
                The ActionBar branch is visually collapsed (grid-template-rows
                0fr/1fr, not a conditional unmount) whenever the sheet is
                collapsed — see the floating button above, which takes over
                its job in that state. The collapse is purely visual — the
                `actionBarHeight` measurement effect below ignores a 0px
                reading (see its own comment) specifically so this doesn't
                feed a stale 0 into contentHeight/sheetPanelHeightPx (which
                size the *expanded* sheet) for the one tick between the sheet
                re-expanding and ActionBar's real height being remeasured;
                unmounting it here instead of just visually collapsing it
                would have made that gap real, not just a stale reading. */}
            <div ref={actionBarRef}>
              {editingPlateKey && stagedPlate.some((i) => i.key === editingPlateKey) ? (
                <QuantityPresetBar
                  item={stagedPlate.find((i) => i.key === editingPlateKey)!}
                  onSelect={(quantityGrams) => {
                    updatePlateItemQuantity(editingPlateKey, quantityGrams);
                    setEditingPlateKey(null);
                  }}
                />
              ) : (
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: sheetExpanded ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <ActionBar
                      activeTab={activeTab}
                      query={query}
                      setQuery={setQuery}
                      searchInputRef={searchInputRef}
                      stagedPlate={stagedPlate}
                      commitDisabled={commitDisabled}
                      onLogFoods={confirmPlate}
                      commitLabel={commitLabel}
                      describeAction={describeAction}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {step === "detail" && selectedFood && (
          <FoodDetailScreen
            food={selectedFood}
            totals={editingEntry && totals ? subtractNutrition(totals, editingEntry.nutrition) : totals}
            plateTotals={plateTotals}
            targets={targets}
            stagedCount={stagedPlate.length}
            initialQuantityGrams={editingEntry?.quantityGrams}
            backLabel={editingEntry ? "Close" : "Back to search results"}
            onBack={() => (editingEntry ? closeSheet() : changeStep("browse"))}
            onAdd={(food, quantityGrams, unit) => {
              if (!editingEntry && activeTab === "search") recordFoodSearchSelection(query, food);
              // Quick-log mode (QuickActionFlow's recipe picker): "Add"
              // commits immediately and closes, same as "Log Foods" — this
              // entry point's old single-button screen always logged
              // immediately, and staging here instead would risk silently
              // losing the pick if the sheet gets closed before a second,
              // separate "Log Foods" tap (see quickAddPlate.tsx).
              if (quickLogInitialFood) {
                confirmPlateWithExtra(food, quantityGrams, unit);
                return;
              }
              // Recipe-picker mode: Food Detail's "Add" commits straight to
              // the recipe rather than onto this sheet's own local staging
              // plate — unlike the row's quick-"+" (still staged, reviewable
              // via the header icon row, undoable by swiping away), setting
              // an exact quantity here and tapping Add is a deliberate,
              // considered action, so it lands for real immediately. The
              // sheet still stays open afterward (changeStep("browse"), not
              // onClose) so more ingredients can be picked in a row.
              if (onPickItems) {
                onPickItems([{ food, quantityGrams }]);
              } else {
                addToPlate(food, quantityGrams, unit);
              }
              changeStep("browse");
            }}
            onLogFoods={(food, quantityGrams, unit) => {
              if (!editingEntry && activeTab === "search") recordFoodSearchSelection(query, food);
              confirmPlateWithExtra(food, quantityGrams, unit);
            }}
            hideTargetsUi={!!onPickItems}
            onSaveAsCustom={openCreateFromFood}
            isFavorite={favoriteFoodIds.has(selectedFood.id)}
            onToggleFavorite={toggleFavorite}
            initialUnitType={editingEntry?.unitType ?? undefined}
            initialUnitMeasureName={editingEntry?.unitMeasureName ?? undefined}
            editing={editingEntry ? { onSave: saveEditedQuantity, onDelete: () => setShowDeleteConfirm(true) } : undefined}
            // Not shown while editing an already-logged entry: Edit/Duplicate
            // land on the "recipe" step and Explode lands on "browse", and
            // editingEntry mode has no path back to either — it opens
            // straight into "detail" with no browse state behind it (see
            // onBack just above) and its own Delete/Save footer already
            // covers the "change what's logged" case some other way.
            recipeActions={
              !editingEntry && selectedFood.source === "recipe" && recipeIdForFood(selectedFood.id)
                ? {
                    onEdit: () => requestRecipeAction(selectedFood, "edit"),
                    onExplode: () => requestRecipeAction(selectedFood, "explode"),
                    onDuplicate: () => requestRecipeAction(selectedFood, "duplicate"),
                  }
                : undefined
            }
            onDeleteFood={
              !editingEntry
                ? selectedFood.source === "custom" || selectedFood.source === "ai_estimate" || selectedFood.source === "afcd"
                  ? () => deleteFood.mutate(selectedFood.id, { onSuccess: () => changeStep("browse") })
                  : selectedFood.source === "recipe" && recipeIdForFood(selectedFood.id)
                    ? () => deleteRecipe.mutate(recipeIdForFood(selectedFood.id)!, { onSuccess: () => changeStep("browse") })
                    : undefined
                : undefined
            }
            timeLabel={editingEntry ? undefined : formatLogTime(loggedAtOverride)}
            onTimeClick={editingEntry ? undefined : () => setShowTimePicker(true)}
            commitLabel={commitLabel}
          />
        )}

        {step === "create" && (
          <CreateFoodForm
            initialName={query.trim()}
            barcode={createPrefillFood ? undefined : scannedBarcode}
            prefillFood={createPrefillFood ?? undefined}
            onCancel={() => {
              setCreatePrefillFood(null);
              changeStep("browse");
            }}
            onCreated={(food) => {
              createFood.mutate(food, {
                onSuccess: (created) => pickFood(created),
              });
              setCreatePrefillFood(null);
            }}
          />
        )}

        {step === "recipeChoice" && (
          <div className="flex-1 flex flex-col min-h-0 step-enter">
            <div className="px-2.5 pt-1 pb-1 flex items-center gap-1 shrink-0">
              <button
                onClick={() => changeStep("browse")}
                aria-label="Back"
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-white active:bg-white/10"
              >
                <ChevronLeft size={18} strokeWidth={2} />
              </button>
              <span className="text-sm font-medium text-white">New recipe</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
              <button
                onClick={() => {
                  setEditingRecipeId(null);
                  // Edit/Duplicate/Import all leave a prefilled draft in
                  // recipeImportInitial (see the pendingRecipeAction effect
                  // and submitRecipeImport above) that only ever gets
                  // cleared on the sheet's own open transition — without
                  // this, starting a genuinely blank recipe right after
                  // duplicating/editing a different one in the same sheet
                  // session inherited that other recipe's servings (and
                  // ingredients) as if they were defaults.
                  setRecipeImportInitial(null);
                  changeStep("recipe");
                }}
                className="w-full flex items-center gap-3 rounded-2xl bg-surface p-4 text-left active:bg-surface-raised"
              >
                <span className="h-11 w-11 rounded-full bg-dashboardChip flex items-center justify-center shrink-0">
                  <ChefHat size={20} strokeWidth={2} className="text-white" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-white">From scratch</span>
                  <span className="block text-xs text-muted mt-0.5">Add ingredients and build it up yourself.</span>
                </span>
                <ChevronRight size={16} strokeWidth={2} className="text-muted shrink-0" />
              </button>
              <button
                onClick={() => changeStep("recipeImportUrl")}
                className="w-full flex items-center gap-3 rounded-2xl bg-surface p-4 text-left active:bg-surface-raised"
              >
                <span className="h-11 w-11 rounded-full bg-dashboardChip flex items-center justify-center shrink-0">
                  <Link2 size={20} strokeWidth={2} className="text-white" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-white">Import from a link</span>
                  <span className="block text-xs text-muted mt-0.5">Paste a recipe URL and we'll fill it in for you to review.</span>
                </span>
                <ChevronRight size={16} strokeWidth={2} className="text-muted shrink-0" />
              </button>
              <button
                onClick={() => changeStep("recipeImportPhoto")}
                className="w-full flex items-center gap-3 rounded-2xl bg-surface p-4 text-left active:bg-surface-raised"
              >
                <span className="h-11 w-11 rounded-full bg-dashboardChip flex items-center justify-center shrink-0">
                  <Camera size={20} strokeWidth={2} className="text-white" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-white">From a photo</span>
                  <span className="block text-xs text-muted mt-0.5">Snap a photo of a handwritten or printed ingredient list.</span>
                </span>
                <ChevronRight size={16} strokeWidth={2} className="text-muted shrink-0" />
              </button>
            </div>
          </div>
        )}

        {step === "recipeImportUrl" && (
          <div className="flex-1 flex flex-col min-h-0 step-enter">
            <div className="px-2.5 pt-1 pb-1 flex items-center gap-1 shrink-0">
              <button
                onClick={() => changeStep("recipeChoice")}
                aria-label="Back"
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-white active:bg-white/10"
              >
                <ChevronLeft size={18} strokeWidth={2} />
              </button>
              <span className="text-sm font-medium text-white">Import from a link</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <p className="text-xs text-muted mb-3">
                Paste a link to a recipe page — we'll read it and fill in the name, ingredients, and amounts for
                you to review before saving.
              </p>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                autoFocus
                value={recipeImportUrlInput}
                onChange={(e) => setRecipeImportUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitRecipeImport(); }}
                placeholder="https://example.com/recipe"
                disabled={importRecipeUrl.isPending}
                className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent disabled:opacity-60"
              />
              {recipeImportError && <p className="text-xs text-red-400 mt-2">{recipeImportError}</p>}
            </div>
            <div className="p-4 shrink-0">
              <button
                onClick={submitRecipeImport}
                disabled={!recipeImportUrlInput.trim() || importRecipeUrl.isPending}
                className="w-full py-3.5 rounded-xl bg-accent text-base disabled:opacity-40 font-semibold flex items-center justify-center gap-2"
                style={{ color: "#0B1210" }}
              >
                {importRecipeUrl.isPending && <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />}
                {importRecipeUrl.isPending ? "Importing…" : "Import Recipe"}
              </button>
            </div>
          </div>
        )}

        {step === "recipeImportPhoto" && (
          <div className="flex-1 flex flex-col min-h-0 step-enter">
            <div className="px-2.5 pt-1 pb-1 flex items-center gap-1 shrink-0">
              <button
                onClick={() => changeStep("recipeChoice")}
                aria-label="Back"
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-white active:bg-white/10"
              >
                <ChevronLeft size={18} strokeWidth={2} />
              </button>
              <span className="text-sm font-medium text-white">From a photo</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <p className="text-xs text-muted mb-3">
                Take or choose a photo of a handwritten or printed ingredient list — we'll read it and fill in
                the name, ingredients, and amounts for you to review before saving.
              </p>
              {/* Hidden inputs + PhotoSourceSheet, same pattern as
                  CreateFoodForm's label-scan photo capture — a bare
                  accept="image/*" input doesn't reliably offer "Camera or
                  Gallery?" on Android/Chrome. */}
              <input
                ref={recipePhotoCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) {
                    setRecipePhotoFile(file);
                    setRecipePhotoPreviewUrl(URL.createObjectURL(file));
                  }
                }}
              />
              <input
                ref={recipePhotoLibraryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) {
                    setRecipePhotoFile(file);
                    setRecipePhotoPreviewUrl(URL.createObjectURL(file));
                  }
                }}
              />
              
              {recipePhotoPreviewUrl ? (
                <div className="mb-4">
                  <img src={recipePhotoPreviewUrl} alt="Recipe" className="w-full rounded-2xl object-cover h-48 mb-3" />
                  <input
                    type="text"
                    placeholder="Optional description (e.g. 'all ingredients are raw')"
                    value={recipePhotoDescription}
                    onChange={(e) => setRecipePhotoDescription(e.target.value)}
                    className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-3.5 text-sm font-medium text-primary placeholder-tertiary focus:border-accent focus:outline-none mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRecipePhotoFile(null);
                        setRecipePhotoPreviewUrl(null);
                        setRecipePhotoDescription("");
                      }}
                      className="flex-1 py-3.5 rounded-xl bg-surface text-primary border border-line text-sm font-medium active:bg-line"
                    >
                      Retake
                    </button>
                    <button
                      type="button"
                      onClick={() => submitRecipeImportPhoto(recipePhotoFile!)}
                      disabled={importRecipePhoto.isPending}
                      className="flex-1 py-3.5 rounded-xl bg-accent text-base disabled:opacity-40 font-semibold flex items-center justify-center gap-2"
                      style={{ color: "#0B1210" }}
                    >
                      {importRecipePhoto.isPending && <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />}
                      {importRecipePhoto.isPending ? "Reading…" : "Submit to AI"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRecipePhotoSourcePickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-3.5 text-sm font-medium text-accent active:bg-white/5"
                >
                  <Camera size={16} strokeWidth={2} />
                  Add a photo
                </button>
              )}
              {recipeImportPhotoError && <p className="text-xs text-red-400 mt-2">{recipeImportPhotoError}</p>}
            </div>
          </div>
        )}

        {step === "recipe" && (
          // step-enter (see FoodDetailScreen's own identical wrapper) — a
          // plain conditional swap between sibling steps otherwise has no
          // transition of its own. RecipeForm itself returns a bare
          // Fragment (its header/body/footer need to be direct flex
          // children of *some* flex-col container, not nested one level
          // deeper — see FoodDetailScreen's own comment on this), so this
          // wrapper both provides that container and carries the animation,
          // rather than baking step-enter into RecipeForm itself — it's
          // also reused inside a BottomSheet (RecipeEditSheet,
          // CreateRecipeFromGroupSheet), which already animates its own
          // entrance and shouldn't get a second, different one layered on.
          <div className="flex-1 flex flex-col min-h-0 step-enter">
            <RecipeForm
              initialName={query.trim()}
              // Set for a successful URL import, Food Detail's recipe Edit,
              // or its Duplicate (recipeChoice's "From scratch" option
              // leaves this null) — same "prefilled but not yet persisted"
              // contract as CreateRecipeFromGroupSheet's own `initial` usage.
              initial={recipeImportInitial ?? undefined}
              // Only Edit is a real existing recipe — URL import/Duplicate
              // are prefilled but still new, same as CreateRecipeFromGroupSheet.
              editingExisting={!!editingRecipeId}
              // Cancelling an in-place Edit returns to the recipe's own
              // detail view (still the current selectedFood throughout) —
              // every other path here has no such screen to go back to.
              onCancel={() => changeStep(editingRecipeId ? "detail" : "browse")}
              onCreated={(input) => {
                if (editingRecipeId) {
                  updateRecipe.mutate(
                    {
                      name: input.name,
                      icon: input.icon,
                      servings: input.servings,
                      totalWeightGrams: input.totalWeightGrams,
                      ingredients: input.ingredients.map((i) => ({
                        foodId: i.food.id,
                        quantityGrams: i.quantityGrams,
                      })),
                    },
                    { onSuccess: onClose }
                  );
                  return;
                }
                createRecipe.mutate(
                  {
                    name: input.name,
                    icon: input.icon,
                    servings: input.servings,
                    totalWeightGrams: input.totalWeightGrams,
                    ingredients: input.ingredients.map((i) => ({
                      foodId: i.food.id,
                      quantityGrams: i.quantityGrams,
                    })),
                  },
                  {
                    onSuccess: () => {
                      // Saving a recipe only adds it to the library. It is
                      // not the same action as choosing a recipe to log, so
                      // return to the recipe list without staging it.
                      setActiveTab("library");
                      setLibraryView("recipes");
                      changeStep("browse");
                    },
                  }
                );
              }}
            />
          </div>
        )}
    </div>

      {step === "scan" && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
          <BarcodeScanner onScan={handleScan} onClose={() => changeStep("browse")} />
        </Suspense>
      )}

      {closeWarningSource && (
        <DiscardWarningSheet
          title={
            onPickItems
              ? `${stagedPlate.length} ingredient${stagedPlate.length === 1 ? "" : "s"} not yet added`
              : `${stagedPlate.length} unlogged item${stagedPlate.length === 1 ? "" : "s"} on your plate`
          }
          message={
            onPickItems
              ? `${stagedPlate.length === 1 ? "It won't" : "They won't"} be added to this recipe unless you go back and tap ${commitLabel}.`
              : `${stagedPlate.length === 1 ? "It hasn't" : "They haven't"} been logged yet. ${stagedPlate.length === 1 ? "It'll" : "They'll"} still be here if you come back, but will be lost if you refresh or fully close the app.`
          }
          manageBackHistory={closeWarningSource === "ui"}
          onCancel={() => setCloseWarningSource(null)}
          onConfirm={() => {
            const source = closeWarningSource;
            setCloseWarningSource(null);
            if (source === "gesture") proceedBlockedClose();
            else closeSheet();
          }}
        />
      )}

      {pendingLibraryDelete && (
        <ConfirmDeleteSheet
          title="Delete Food"
          message={`Delete "${pendingLibraryDelete.name}"? Any logs that used it stay in your history.`}
          confirmLabel="Delete Food"
          onConfirm={() => {
            deleteLibraryFood(pendingLibraryDelete);
            setPendingLibraryDelete(null);
          }}
          onClose={() => setPendingLibraryDelete(null)}
          isPending={deleteFood.isPending || deleteRecipe.isPending}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDeleteSheet
          title="Delete Food"
          message="Remove this entry from your log? This can't be undone."
          confirmLabel="Delete Food"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            removeEntry();
          }}
          onClose={() => setShowDeleteConfirm(false)}
          isPending={deleteLog.isPending}
        />
      )}

      {showTimePicker && (
        <DateTimePickerSheet
          mode="time"
          title="Log time"
          confirmLabel="Set"
          initialDate={date}
          initialTime={loggedAtTimeString(loggedAtOverride)}
          onConfirm={(_date, time) => {
            setLoggedAtOverride(buildLoggedAt(date, time));
            setShowTimePicker(false);
          }}
          onClose={() => setShowTimePicker(false)}
        />
      )}

      {recipePhotoSourcePickerOpen && (
        <PhotoSourceSheet
          onChooseCamera={() => recipePhotoCameraInputRef.current?.click()}
          onChooseLibrary={() => recipePhotoLibraryInputRef.current?.click()}
          onClose={() => setRecipePhotoSourcePickerOpen(false)}
        />
      )}
    </>,
    document.body
  );
}

// One food row — avatar, name, macros, calories, tap-to-inspect vs. tap-"+"
// to instant-stage (see openFoodDetail/pickFood above for why both exist).
// Shared by Search results and every Library sub-view (Recipes/Foods/
// Favourites are all just `Food` rows under the hood — a recipe is its own
// materialized `foods` row) so the three don't each duplicate this block.
function FoodRow({
  food,
  onOpen,
  onQuickAdd,
  onDelete,
}: {
  food: Food;
  onOpen: (food: Food) => void;
  onQuickAdd: (food: Food) => void;
  // Only passed for Library's own Recipes/Foods views (not Favourites or
  // Search results, which this same row also renders) — see LibraryTab's
  // own wiring for why. Swipe reveals Delete same as the Plate/Recipe
  // ingredient lists (SwipeToDeleteRow), but this fires a confirm sheet
  // instead of deleting immediately: those two are removing a draft/staged
  // item, this permanently deletes a library entry.
  onDelete?: (food: Food) => void;
}) {
  const refGrams = food.servingSizeGrams ?? 100;
  const n = scaleNutrition(food, refGrams);
  const { unit: energyUnit } = useEnergyUnit();
  const originLabel = food.brand?.trim()
    || (food.source === "afcd" ? "Generic" : food.source === "recipe" ? "Recipe" : food.source === "custom" ? "Custom food" : null);
  const rowClassName = "w-full flex items-center gap-3 px-4 py-2.5 bg-dashboardBg border-b border-dashboardDivider/60";
  const content = (
    <>
      <button onClick={() => onOpen(food)} className="flex-1 flex items-center gap-3 min-w-0 text-left active:bg-white/5">
        <FoodIconAvatar name={food.name} icon={food.icon} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-white truncate">{food.name}</span>
          <span className="block text-[11px] text-muted truncate mt-1 tabular">
            {originLabel && <>{originLabel} · </>}
            {fmt(n.protein)}P {fmt(n.fat)}F {fmt(n.carbs)}C · {fmt(refGrams)}g
          </span>
        </span>
        <span className="tabular text-sm text-white shrink-0 ml-2">{fmt(kcalToUnit(n.calories, energyUnit))}</span>
      </button>
      <button
        onClick={() => onQuickAdd(food)}
        aria-label={`Quick add ${food.name}`}
        className="shrink-0 w-7 h-7 rounded-full bg-dashboardChip flex items-center justify-center text-white active:bg-white/20"
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
      </button>
    </>
  );
  if (!onDelete) return <div className={rowClassName}>{content}</div>;
  return (
    <SwipeToDeleteRow onDelete={() => onDelete(food)} deleteLabel={`Delete ${food.name}`} rowClassName={rowClassName}>
      {content}
    </SwipeToDeleteRow>
  );
}

// The Library tab — inspired by MacroFactor's own Library pane (a rounded
// segmented control for Recipes/Foods/Favourites plus a "+" shortcut into
// whichever create-flow matches the active view, a plain list of rows
// below). Recipes and Foods are both just `foods` rows under the hood
// (source: 'recipe' / 'custom' respectively — see schema.ts), and Favourites
// already existed as a per-user list, so all three reuse the same FoodRow
// and none of this needed a new backend concept beyond the `source` filter
// on GET /api/foods that Foods relies on.
function LibraryTab({
  view,
  setView,
  recipes,
  customFoods,
  favorites,
  onOpen,
  onQuickAdd,
  onCreateFood,
  onCreateRecipe,
  onRequestDelete,
}: {
  view: LibraryView;
  setView: (v: LibraryView) => void;
  recipes: RecipeSummary[] | undefined;
  customFoods: Food[] | undefined;
  favorites: Food[] | undefined;
  onOpen: (food: Food) => void;
  onQuickAdd: (food: Food) => void;
  onCreateFood: () => void;
  onCreateRecipe: () => void;
  // Recipes/Foods only — see FoodRow's own comment on why Favourites/Search
  // don't get this. Opens a confirm sheet, doesn't delete straight away.
  onRequestDelete: (food: Food) => void;
}) {
  const [libraryQuery, setLibraryQuery] = useState("");
  const items = view === "recipes" ? recipes?.map((r) => r.food) : view === "foods" ? customFoods : favorites;
  // Filters whichever list `view` is currently showing — not a query against
  // the wider food database the Search tab hits (OFF included), just a
  // plain client-side name filter over the small, already-fetched list this
  // household actually owns. Switching Recipes/Foods/Favourites re-scopes
  // what the same typed text filters instead of clearing it, since there's
  // no reason a search for "protein" shouldn't still apply after flipping
  // views.
  const trimmedQuery = libraryQuery.trim().toLowerCase();
  const filteredItems = trimmedQuery ? items?.filter((f) => f.name.toLowerCase().includes(trimmedQuery)) : items;
  const emptyMessage =
    view === "recipes"
      ? "No recipes yet — the + button starts one."
      : view === "foods"
        ? "No custom foods yet — the + button creates one."
        : "No favourites yet — tap the heart on any food's detail view.";

  return (
    <div>
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-1 rounded-full bg-dashboardChip p-1 min-w-0">
          {(
            [
              { id: "recipes" as const, label: "Recipes" },
              { id: "foods" as const, label: "Foods" },
              { id: "favorites" as const, label: "Favourites" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${
                view === t.id ? "bg-white text-black" : "text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {view !== "favorites" && (
          <button
            onClick={view === "recipes" ? onCreateRecipe : onCreateFood}
            aria-label={view === "recipes" ? "Create recipe" : "Create custom food"}
            className="shrink-0 w-8 h-8 rounded-full bg-dashboardChip flex items-center justify-center text-white active:bg-white/20"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 rounded-full bg-dashboardChip px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-muted shrink-0" strokeWidth={2} />
          <input
            type="search"
            autoComplete="off"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            placeholder={view === "recipes" ? "Search recipes" : view === "foods" ? "Search custom foods" : "Search favourites"}
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
          />
        </div>
      </div>

      {items?.length === 0 && <p className="px-4 py-6 text-sm text-muted text-center">{emptyMessage}</p>}
      {items && items.length > 0 && filteredItems?.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted text-center">No matches for "{libraryQuery.trim()}".</p>
      )}
      {filteredItems?.map((food) => (
        <FoodRow
          key={food.id}
          food={food}
          onOpen={onOpen}
          onQuickAdd={onQuickAdd}
          onDelete={view === "recipes" || view === "foods" ? onRequestDelete : undefined}
        />
      ))}
    </div>
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
  timeLabel,
  onTimeClick,
  pickedFoods,
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
  timeLabel: string;
  onTimeClick: () => void;
  // Recipe-picker mode only (see AddFoodSheet's onPickItems) — when set,
  // this replaces the whole time-pill + macro-bars row below with a plain
  // icon row of the staged plate instead (same items as stagedPlate, just
  // rendered as a flat scrollable row rather than the small overlapping
  // stack): a time-of-day pill and "N left" budget bars don't mean anything
  // for a recipe, which has no log time and no daily target. Matches
  // MacroFactor's own Create Recipe picker header.
  pickedFoods?: Food[];
}) {
  const visibleAvatars = stagedPlate.slice(0, 3);
  const overflowCount = stagedPlate.length - visibleAvatars.length;

  if (pickedFoods) {
    return (
      <div className="flex items-center gap-3 px-4 pb-3 shrink-0" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
        <button onClick={onClose} aria-label="Close" className="shrink-0 h-5 flex items-center text-white/70 active:text-white">
          <X className="w-5 h-5" strokeWidth={2} />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {pickedFoods.map((food, i) => (
            <FoodIconAvatar key={i} name={food.name} icon={food.icon} className="w-9 h-9 shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  return (
    // Top row is the corner controls plus the time pill, all in one row now
    // — X at the top-left, the time pill genuinely centered (grid-cols-3
    // with equal-width outer columns, not flex justify-between, so the pill
    // stays centered whether or not the avatar stack is present), the
    // staged-avatar stack at the top-right when anything's staged. The pill
    // used to sit stacked on its own row directly above NutrientStatusBar's
    // "Remaining Today" label, which read as cramped with the two rows right
    // on top of each other — sharing this row with the corner controls
    // instead gives that label normal breathing room below. FoodDetailScreen
    // mirrors this same shape (its own top-left corner control — the back
    // button — sharing a row with the same time pill) so the bars land at
    // the same vertical offset in both places despite each screen having
    // different top-row controls.
    //
    // The expand/collapse chevron that used to sit next to the avatar stack
    // was removed — DraggableSnapSheet's own drag gesture (the grabber, or a
    // drag anywhere on the tab bar/collapsed icon row) already toggles
    // between expanded and collapsed, so the button was a redundant second
    // control for something already reachable by the sheet's own swipe
    // affordance.
    // pt accounts for the status bar/notch now that this sits at the very
    // top of a genuinely full-screen modal, not a few percent down inside a
    // rounded sheet. The 2px gap below the controls is deliberately tighter
    // than ordinary section spacing: together with this row's 20px height it
    // puts NutrientStatusBar's macro tracks at the same viewport Y position
    // as MacroSummaryBar on the Food Log. FoodDetailScreen uses the same 2px
    // value so all three headers stay aligned.
    <ModalMacroHeader
      className="pb-3"
      left={
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 h-5 flex items-center text-white/70 active:text-white"
        >
          <X className="w-5 h-5" strokeWidth={2} />
        </button>
      }
      center={<LogTimePill timeLabel={timeLabel} onTimeClick={onTimeClick} />}
      right={
        stagedPlate.length > 0 ? (
          <div className="shrink-0 h-5 flex items-center -space-x-1.5">
            {visibleAvatars.map((item) => (
              <FoodIconAvatar
                key={item.key}
                name={item.food.name}
                icon={item.food.icon}
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
        ) : undefined
      }
      statusClassName="px-4"
      status={
        <NutrientStatusBar totals={totals} plateTotals={plateTotals} targets={targets} />
      }
    />
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
  query,
  setQuery,
  searchInputRef,
  stagedPlate,
  commitDisabled,
  onLogFoods,
  commitLabel = "Log Foods",
  describeAction,
}: {
  activeTab: Tab;
  query: string;
  setQuery: (q: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  stagedPlate: PlateItem[];
  commitDisabled: boolean;
  onLogFoods: () => void;
  commitLabel?: string;
  describeAction: DescribeAction | null;
}) {
  // The search pill only ever makes sense on the Search tab itself — it used
  // to render everywhere as a "tap to switch to Search" button, but that tap
  // never actually focused the input it looked like (no keyboard opened),
  // and every other tab already has its own dedicated input for adding a
  // food (Quick Add's Name field, Describe's textarea, Library's own
  // per-view search below) or doesn't need one at all. Log Foods itself
  // stays pinned here regardless of tab — it's the one control that commits
  // the whole staged plate. Describe's separate item-level "Add to Plate"
  // action joins it in this same row so neither can scroll underneath the
  // other when the keyboard reduces the available content height.
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-dashboardBg border-t border-white/10">
      {activeTab === "search" && (
        <div className="flex-1 min-w-0 flex items-center gap-2 rounded-full bg-dashboardChip px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-muted shrink-0" strokeWidth={2} />
          <input
            ref={searchInputRef}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a food"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
          />
        </div>
      )}
      {activeTab === "describe" && (
        <button
          type="button"
          onClick={describeAction?.submit}
          disabled={!describeAction?.canSubmit || describeAction.pending}
          className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-full bg-accent px-3 py-2.5 text-sm font-bold disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          {describeAction?.pending ? (
            <>
              <Loader2 size={16} className="animate-spin shrink-0" />
              <span>Thinking…</span>
            </>
          ) : (
            "Add to Plate"
          )}
        </button>
      )}
      <button
        onClick={onLogFoods}
        disabled={commitDisabled}
        className={`rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50 ${
          activeTab === "search" ? "shrink-0" : "flex-1 min-w-0"
        }`}
      >
        {stagedPlate.length > 0 ? `${commitLabel} (${stagedPlate.length})` : commitLabel}
      </button>
    </div>
  );
}

// Quick-pick serving chips shown in ActionBar's own pinned slot while a
// staged plate item's quantity is being edited (1 serving, 50/100/150g),
// surfaced here too since typing an exact gram figure by hand isn't always
// the fastest correction.
// Reusing ActionBar's slot (rather than inventing a second pinned element)
// is what puts this right above the on-screen keyboard for free — that
// position already tracks real visual-viewport metrics for ActionBar's own
// sake (see AddFoodSheet's actionBarRef), so a second element doing the same
// tracking independently would just be duplicated plumbing.
function QuantityPresetBar({ item, onSelect }: { item: PlateItem; onSelect: (quantityGrams: number) => void }) {
  const chips = [
    ...foodMeasures(item.food).map((measure) => ({ label: `1 ${measure.name} (${measure.grams}g)`, value: measure.grams })),
    { label: "50 g", value: 50 },
    { label: "100 g", value: 100 },
    { label: "150 g", value: 150 },
  ].filter(Boolean) as { label: string; value: number }[];

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-3 bg-dashboardBg border-t border-white/10 overflow-x-auto no-scrollbar">
      {chips.map((chip) => (
        <button
          key={chip.label}
          // Suppresses the pointer's own default focus-shift so the still-
          // focused quantity input never blurs from this tap — a blur there
          // independently commits whatever's currently *typed* (see
          // StagedPlateSection's onBlur below), which would otherwise race
          // this handler's own commit of the chip's value instead.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onSelect(chip.value)}
          className={`shrink-0 px-3.5 py-2 rounded-full border text-xs font-medium transition-colors ${
            item.quantityGrams === chip.value ? "border-accent text-accent" : "border-white/15 text-white active:bg-white/5"
          }`}
        >
          {chip.label}
        </button>
      ))}
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
  const { unit: energyUnit } = useEnergyUnit();
  return (
    <div>
      <h2 className="px-4 pt-4 pb-2 text-base font-bold text-white">Your Plate</h2>
      {stagedPlate.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">
          Your plate is empty. Search for foods to add them.
        </p>
      ) : (
        stagedPlate.map((item) => {
          const n = scaleNutrition(item.food, item.quantityGrams);
          const isEditingQty = editingPlateKey === item.key;
          return (
            <SwipeToDeleteRow
              key={item.key}
              onDelete={() => removeFromPlate(item.key)}
              deleteLabel={`Remove ${item.food.name}`}
              rowClassName="w-full flex items-center gap-3 px-4 py-2.5 border-b border-dashboardDivider/60 bg-dashboardBg"
            >
              <FoodIconAvatar name={item.food.name} icon={item.food.icon} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-white truncate">{item.food.name}</span>
                <span className="block text-[11px] text-muted truncate mt-1 tabular">
                  {fmt(n.protein)}P {fmt(n.fat)}F {fmt(n.carbs)}C · {formatEnergy(n.calories, energyUnit)}
                </span>
              </span>
              {isEditingQty ? (
                <DecimalInput
                  label={`${item.food.name} quantity`}
                  value={String(item.quantityGrams)}
                  onChange={(value) => updatePlateItemQuantity(item.key, Math.max(0, Number(value) || 0))}
                  allowDecimal={false}
                  onDone={() => setEditingPlateKey(null)}
                  autoOpen
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
            </SwipeToDeleteRow>
          );
        })
      )}

      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <p className="text-[11px] tracking-widest uppercase text-muted">Nutrition</p>
        {/* One button spanning both labels, not two adjacent ones — with only
            two states, "tap the one you want" and "tap anywhere to flip to
            the other" are the same action, but the old two-button version
            only responded to a precise tap on the small Plate/Day text
            itself, not the pill around it. */}
        <button
          onClick={() => setNutritionView(nutritionView === "plate" ? "day" : "plate")}
          className="flex rounded-full bg-dashboardChip p-0.5 text-[11px]"
        >
          <span
            className={`px-3 py-1 rounded-full transition-colors ${
              nutritionView === "plate" ? "bg-white text-black font-medium" : "text-muted"
            }`}
          >
            Plate
          </span>
          <span
            className={`px-3 py-1 rounded-full transition-colors ${
              nutritionView === "day" ? "bg-white text-black font-medium" : "text-muted"
            }`}
          >
            Day
          </span>
        </button>
      </div>

      {/* Matches MacroSummaryBar's own row exactly (icon/letter + number,
          thin bar below) rather than a separate, heavier tile format — the
          old version (spelled-out label, big number, "143g protein in
          plate" subtext, h-2 bar) was the same information shown two
          different ways depending on which screen you were on. The
          "in plate"/"today" distinction the subtext used to spell out is
          still available via the Plate/Day pill above; it's just implicit
          now instead of repeated on every tile. */}
      <div className="px-4 pb-4 grid grid-cols-4 gap-3">
        {NUTRITION_METRICS.map((m) => {
          const plateVal = plateTotals[m.key];
          const shownVal = nutritionView === "plate" ? plateVal : (totals?.[m.key] ?? 0) + plateVal;
          const target = targetFor(targets, m.key);
          // Grams are unit-invariant; calories converts to the global
          // preference. The progress bar keeps using the raw kcal-scale
          // shownVal/target — the same conversion factor on both sides of a
          // ratio cancels out, so there's nothing to convert there.
          const displayVal = m.key === "calories" ? kcalToUnit(shownVal, energyUnit) : shownVal;
          const displayTarget = m.key === "calories" ? kcalToUnit(target, energyUnit) : target;
          return (
            <div key={m.key} className="min-w-0 flex flex-col items-center text-center" aria-label={m.label}>
              <p className="tabular flex items-center justify-center gap-1 truncate" aria-hidden="true">
                {m.key === "calories" ? (
                  <Flame className="w-3 h-3 shrink-0" strokeWidth={2.4} style={{ color: m.color }} />
                ) : (
                  <span className="text-[11px] font-bold shrink-0" style={{ color: m.color }}>
                    {m.letter}
                  </span>
                )}
                <span className="text-[11px] font-medium text-white">{fmt(displayVal)}</span>
                {/* Only meaningful against a real daily target — RecipeForm's
                    ingredient picker opens this same sheet with no totals/
                    targets prop at all (a recipe has no "day"), so target is
                    always 0 there. */}
                {target > 0 && <span className="text-[9px] text-muted">/{fmt(displayTarget)}</span>}
              </p>
              {target > 0 && (
                <span className="block h-1 w-full rounded-full bg-dashboardTrack overflow-hidden mt-1.5">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${pct(shownVal, target)}%`, backgroundColor: m.color }}
                  />
                </span>
              )}
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
  // Local, not the global preference — see QuickAddSheet's identical comment.
  const { unit: globalEnergyUnit } = useEnergyUnit();
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>(globalEnergyUnit);

  useEffect(() => {
    if (!protein.trim() && !carbs.trim() && !fat.trim()) return;
    const p = Number(protein) || 0;
    const c = Number(carbs) || 0;
    const f = Number(fat) || 0;
    setCalories(String(Math.round(kcalToUnit(p * 4 + c * 4 + f * 9, energyUnit))));
  }, [protein, carbs, fat, energyUnit]);

  const canSave = name.trim() !== "" && calories.trim() !== "";

  function toggleEnergyUnit() {
    const next = energyUnit === "kcal" ? "kj" : "kcal";
    if (calories.trim() !== "" && !isNaN(Number(calories))) {
      const kcal = unitToKcal(Number(calories), energyUnit);
      setCalories(String(Math.round(kcalToUnit(kcal, next))));
    }
    setEnergyUnit(next);
  }

  function submit() {
    if (!canSave) return;
    createFood.mutate(
      {
        name: name.trim(),
        servingSizeGrams: 100,
        caloriesPer100g: unitToKcal(Number(calories) || 0, energyUnit),
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

  // Enter submits via a plain onKeyDown on each field, not a wrapping
  // <form> — a real <form> element turned out to be exactly what triggers
  // Chrome's full autofill accessory strip (passwords/payment/addresses
  // icons) on Android, regardless of autocomplete="off" or a distinct name
  // attribute on the fields inside it; every other screen in the app that
  // wants Enter-to-submit (LogWeightInline, the weight-history inline edit,
  // GoalWizardScreen's RateStatTile) already used this same onKeyDown
  // approach and never showed that strip, which is what confirmed the
  // <form> element itself was the trigger, not anything about this specific
  // field.
  function submitOnEnter(e: React.KeyboardEvent) {
    if (e.key === "Enter") submit();
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Name</span>
          {/* Deliberately not autoFocus — the Search tab's own input never
              auto-focuses on tab switch either (see AddFoodSheet's
              pendingSearchFocus, gated to only the dedicated "Search"
              shortcut). Switching tabs *to* Quick Add while the keyboard was
              already open on Search (its input just unmounted/blurred) used
              to immediately autoFocus this field, forcing the keyboard to
              close and reopen back-to-back — two abrupt visualViewport
              resizes in a row instead of the one real one, which is what
              read as the layout "jumping" on every tab switch. */}
          <input
            type="search"
            // The Search tab's own input, Library's search box, and Recipe's
            // ingredient search all use type="search" and never showed
            // Chrome's autofill accessory strip (passwords/payment/addresses
            // icons); this field was the one bare (implicit type="text")
            // input among them, and the one that did show it. Chromium's
            // Android autofill integration appears to treat a `search`
            // input as out-of-scope for that suggestion strip regardless of
            // autocomplete/name, in a way plain text fields aren't — a much
            // more reliable signal than autocomplete="off" turned out to be.
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={submitOnEnter}
            autoComplete="off"
            placeholder="e.g. Restaurant lunch"
            className="w-full rounded-md bg-dashboardCard border border-dashboardDivider px-3 py-2.5 text-sm text-white placeholder:text-muted focus:outline-none focus:border-white/40"
          />
        </label>
        <p className="text-[11px] text-white/60 pt-1">
          Macros — fill in what you know, calories fill themselves in
        </p>
        <div className="grid grid-cols-2 gap-3">
          <QuickAddField label="Protein" value={protein} onChange={setProtein} suffix="g" />
          <QuickAddField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" />
          <QuickAddField label="Fat" value={fat} onChange={setFat} suffix="g" />
          <QuickAddField
            label="Calories"
            value={calories}
            onChange={setCalories}
            suffix={
              <button type="button" onClick={toggleEnergyUnit} className="text-xs text-muted font-medium active:text-white">
                {energyUnitLabel(energyUnit)}
              </button>
            }
          />
        </div>
      </div>
      <div className="p-4 shrink-0">
        {/* Accent (not white) so it reads as a distinct "stage this one item"
            action from the pinned white "Log Foods" bar below, which commits
            the whole plate — same accent-CTA convention as every other
            primary confirm button in the app (see e.g. RecipeForm's save
            button). disabled:opacity-40 matches that same convention too,
            rather than the old bg-white/disabled:opacity-50 combo, which read
            as a flat muddy grey block on this dark theme instead of visibly
            receding. */}
        <button
          onClick={submit}
          disabled={!canSave || createFood.isPending}
          className="w-full py-3 rounded-full bg-accent text-sm font-bold disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          Add to Plate
        </button>
      </div>
    </>
  );
}

// Describes a whole meal in one shot: Sonnet 5 breaks the text into items,
// matches each against the household's own library where confident and
// falls back to its own per-100g estimate otherwise (see
// engine/describeMeal.ts) — every returned item is already a real,
// persisted food by the time it gets here, so staging it is identical to
// staging a search result (onAdded = addToPlate). Doesn't clear the plate or
// close the sheet, same as Quick Add — a few descriptions in a row can all
// land on one plate before a single "Log Foods" commit.
function DescribeTab({
  onAdded,
  onActionChange,
}: {
  onAdded: (food: Food, quantityGrams?: number) => void;
  onActionChange: (action: DescribeAction | null) => void;
}) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [addedSummary, setAddedSummary] = useState<string | null>(null);
  const describeMeal = useDescribeMeal();
  // Two separate inputs, not one bare accept="image/*" — same reasoning as
  // PhotosScreen's cameraInputRef/libraryInputRef (see that file's comment):
  // a bare file input doesn't reliably prompt "Camera or Gallery?" on
  // Android/Chrome, so PhotoSourceSheet asks explicitly and routes to
  // whichever of these two matches.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

  function attachPhoto(file: File) {
    setPhoto(file);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  // Revokes on unmount too (not just on replace/remove) — closing the sheet
  // mid-attach shouldn't leak the object URL for the rest of the session.
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Takes the string to submit explicitly rather than always reading `text`
  // — the onChange handler below needs to submit the just-typed value
  // *before* the state update that removes its trailing newline has
  // actually committed, so it can't just call submit() and rely on closure
  // state without submitting one character behind. Either text or a photo
  // alone is enough to submit — a photo-only guess and a text-only
  // description are both valid, not just the combination.
  function submit(value?: string) {
    const toSubmit = (value ?? text).trim();
    if ((!toSubmit && !photo) || describeMeal.isPending) return;
    setAddedSummary(null);
    describeMeal.mutate(
      { text: toSubmit || undefined, photo: photo ?? undefined },
      {
        onSuccess: (items) => {
          for (const item of items) onAdded(item.food, item.quantityGrams);
          setAddedSummary(
            `Added ${items.length} item${items.length === 1 ? "" : "s"} — check quantities before logging: ` +
              items.map((i) => i.servingDescription ? `${i.food.name} (${i.servingDescription})` : i.food.name).join(", ")
          );
          setText("");
          removePhoto();
        },
      }
    );
  }

  // Describe's item-level action is rendered beside the plate-level commit
  // action in AddFoodSheet's one pinned footer. A ref keeps the registered
  // callback stable while still invoking submit with the latest text/photo
  // state from this render.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const invokeSubmitRef = useRef(() => submitRef.current());
  const canSubmit = Boolean(text.trim() || photo);
  useLayoutEffect(() => {
    onActionChange({ canSubmit, pending: describeMeal.isPending, submit: invokeSubmitRef.current });
  }, [canSubmit, describeMeal.isPending, onActionChange]);
  useEffect(() => () => onActionChange(null), [onActionChange]);

  return (
    <>
      <div className="px-4 pt-3 pb-4 space-y-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">What did you eat?</span>
          <textarea
            value={text}
            onChange={(e) => {
              const value = e.target.value;
              // Many Android on-screen keyboards (Gboard, Samsung Keyboard)
              // never fire a real keydown for Enter inside a textarea — the
              // IME inserts the newline directly via this input event
              // instead, so onKeyDown below alone misses it there entirely.
              // Detecting a trailing "\n" here catches Enter regardless of
              // which path the platform actually took.
              if (value.endsWith("\n")) {
                const trimmed = value.slice(0, -1);
                setText(trimmed);
                submit(trimmed);
                return;
              }
              setText(value);
            }}
            onKeyDown={(e) => {
              // Covers browsers/keyboards that *do* fire a proper keydown
              // (desktop, iOS) — Enter submits, Shift+Enter still inserts a
              // real newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            autoComplete="off"
            placeholder="e.g. a chicken caesar salad and a diet coke — or just attach a photo below"
            rows={4}
            className="w-full resize-none rounded-md bg-dashboardCard border border-dashboardDivider px-3 py-2.5 text-sm text-white placeholder:text-muted focus:outline-none focus:border-white/40"
          />
        </label>

        {/* Hidden inputs have no visible chrome of their own, same
            hidden-input + visible-button pattern as CreateFoodForm's "Scan
            nutrition label" — except two of them here (camera + library, see
            cameraInputRef/libraryInputRef above), routed to by
            PhotoSourceSheet below rather than a single input clicked
            directly. A photo is never persisted — it's discarded client-side
            (removePhoto, on both manual removal and a successful submit) the
            same way the typed text always was; only the foods it resolves to
            survive. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) attachPhoto(file);
          }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) attachPhoto(file);
          }}
        />
        {photoPreviewUrl ? (
          <div className="flex items-center gap-3 rounded-2xl bg-dashboardCard border border-dashboardDivider px-3 py-2.5">
            <img src={photoPreviewUrl} alt="" className="h-14 w-14 rounded-lg object-cover shrink-0" />
            <span className="flex-1 min-w-0 text-xs text-muted">
              Photo attached{text.trim() ? " — your note above will be used too" : ""}.
            </span>
            <button
              type="button"
              onClick={removePhoto}
              aria-label="Remove photo"
              className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full text-muted active:bg-white/10 active:text-white"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSourcePickerOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-dashboardDivider py-3 text-sm font-medium text-accent active:bg-white/5"
          >
            <Camera size={16} strokeWidth={2} />
            Attach a photo of your plate
          </button>
        )}

        {describeMeal.isError && (
          <p className="text-xs text-red-400">
            {describeMeal.error instanceof Error ? describeMeal.error.message : "Couldn't make sense of that meal"}
          </p>
        )}
        {addedSummary && <p className="text-xs text-accent">{addedSummary}</p>}
      </div>
      {sourcePickerOpen && (
        <PhotoSourceSheet
          onChooseCamera={() => cameraInputRef.current?.click()}
          onChooseLibrary={() => libraryInputRef.current?.click()}
          onClose={() => setSourcePickerOpen(false)}
        />
      )}
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
  suffix?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1">{label}</span>
      <div className="flex items-center rounded-md bg-dashboardCard border border-dashboardDivider px-3 focus-within:border-white/40">
        <DecimalInput
          label={label}
          value={value}
          onChange={onChange}
          className="tabular w-full bg-transparent py-2.5 text-sm text-white text-left focus:outline-none"
        />
        {suffix && <span className="shrink-0 flex items-center leading-none text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}
