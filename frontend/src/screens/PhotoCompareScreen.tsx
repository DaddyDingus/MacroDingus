import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReactCompareSlider, ReactCompareSliderImage, ReactCompareSliderHandle } from "react-compare-slider";
import { ChevronLeft, Columns2, Download, ImageOff, Loader2, Rows3, Sparkles } from "lucide-react";
import {
  PHOTO_POSES,
  PHOTO_POSE_LABEL,
  usePhotos,
  useComparePhotos,
  type Photo,
  type PhotoPose,
} from "../api/photos";
import { useWeightTrend } from "../api/weights";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import { formatDayLabel } from "../lib/date";
import BottomSheet from "../components/BottomSheet";
import PhotoDatePickerSheet from "../components/PhotoDatePickerSheet";

function weightLabel(kg: number | null, unit: "kg" | "lb"): string {
  return kg !== null ? `${kgToUnit(kg, unit).toFixed(1)} ${unit}` : `— ${unit}`;
}

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not generate image"))), "image/png");
  });
}

// object-fit: cover equivalent — fills the box edge-to-edge with no
// letterboxing, cropping whatever overflows. The export is just the two
// photos themselves, so there's no card/label chrome to size around.
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  if (!image) return;
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PhotoCompareScreen() {
  const navigate = useNavigate();
  const photos = usePhotos();
  // Trend, not raw scale — same reasoning as Photos' history list: a single
  // day's scale reading is noisy and doesn't correlate well with what the
  // photo next to it actually shows, while trend is the smoothed number the
  // rest of the app already treats as "your real weight."
  const weightTrend = useWeightTrend(3650);
  const { unit } = useWeightUnit();

  const [activePose, setActivePose] = useState<PhotoPose>("front");
  const [leftDate, setLeftDate] = useState("");
  const [rightDate, setRightDate] = useState("");
  const [sheetTarget, setSheetTarget] = useState<"left" | "right" | null>(null);
  const [viewMode, setViewMode] = useState<"slider" | "stacked">("slider");
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const all = photos.data ?? [];
  const autoSelected = useRef<Set<PhotoPose>>(new Set());

  // Smart default: oldest/newest photo for whichever pose is active, applied
  // once per pose so a user's manual date pick isn't clobbered by an
  // unrelated background refetch of the photo list.
  useEffect(() => {
    if (!photos.data || autoSelected.current.has(activePose)) return;
    const forPose = photos.data.filter((p) => p.pose === activePose).sort((a, b) => a.date.localeCompare(b.date));
    if (forPose.length === 0) return;
    autoSelected.current.add(activePose);
    if (forPose.length === 1) {
      setRightDate(forPose[0].date);
    } else {
      setLeftDate(forPose[0].date);
      setRightDate(forPose[forPose.length - 1].date);
    }
  }, [activePose, photos.data]);

  const datesForPose = useMemo(
    () => [...new Set(all.filter((p) => p.pose === activePose).map((p) => p.date))].sort((a, b) => b.localeCompare(a)),
    [all, activePose]
  );

  const leftPhoto = all.find((p) => p.pose === activePose && p.date === leftDate) ?? null;
  const rightPhoto = all.find((p) => p.pose === activePose && p.date === rightDate) ?? null;
  const leftTrendKg = weightTrend.data?.find((t) => t.date === leftDate)?.trendKg ?? null;
  const rightTrendKg = weightTrend.data?.find((t) => t.date === rightDate)?.trendKg ?? null;

  const comparePhotos = useComparePhotos();
  // Stale result would otherwise sit on screen describing a different photo
  // pair than what's currently selected — clear it the moment either side
  // changes rather than only when a fresh compare finishes.
  useEffect(() => {
    comparePhotos.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftPhoto?.id, rightPhoto?.id]);

  function selectDate(date: string) {
    // Doesn't also close the sheet here — PhotoDatePickerSheet's own row tap
    // calls its animated `close()` right after this, so the dismissal is
    // driven by the sheet itself (giving it a chance to slide down) rather
    // than an instant unmount racing ahead of that animation.
    if (sheetTarget === "left") setLeftDate(date);
    else if (sheetTarget === "right") setRightDate(date);
  }

  async function handleExport(layout: "vertical" | "horizontal") {
    if (isExporting) return;
    setIsExporting(true);
    setExportError("");
    try {
      const [leftImage, rightImage] = await Promise.all([
        loadImage(leftPhoto ? `/api/photos/${leftPhoto.id}/file` : null),
        loadImage(rightPhoto ? `/api/photos/${rightPhoto.id}/file` : null),
      ]);

      const bgVar = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
      const bg = bgVar ? `rgb(${bgVar.split(/\s+/).join(",")})` : "#000000";

      // Just the two photos, edge-to-edge — no branding, labels, dates,
      // weights, or delta pill. A thin gap in the page background is the
      // only thing separating "before" from "after".
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const photoW = 1080;
      const photoH = Math.round(photoW * (4 / 3));
      const gap = 6;

      if (layout === "vertical") {
        canvas.width = photoW;
        canvas.height = photoH * 2 + gap;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawCover(ctx, leftImage, 0, 0, photoW, photoH);
        drawCover(ctx, rightImage, 0, photoH + gap, photoW, photoH);
      } else {
        canvas.width = photoW * 2 + gap;
        canvas.height = photoH;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawCover(ctx, leftImage, 0, 0, photoW, photoH);
        drawCover(ctx, rightImage, photoW + gap, 0, photoW, photoH);
      }

      const blob = await canvasToBlob(canvas);
      downloadBlob(blob, `macrodaddy-${activePose}-progress.png`);
    } catch (err) {
      console.error("Progress collage export failed:", err);
      setExportError("Could not export progress collage.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="min-h-dvh" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
      <header className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="p-1 -ml-1">
          <ChevronLeft className="w-5 h-5" strokeWidth={2} />
        </button>
        <h1 className="text-base font-medium flex-1">Compare</h1>
        <button
          onClick={() => setViewMode((v) => (v === "slider" ? "stacked" : "slider"))}
          aria-label={`Switch to ${viewMode === "slider" ? "stacked" : "slider"} view`}
          className="p-1.5 rounded-md border border-line text-muted"
        >
          {viewMode === "slider" ? <Rows3 size={16} strokeWidth={2} /> : <Columns2 size={16} strokeWidth={2} />}
        </button>
        <button
          onClick={() => setShowLayoutPicker(true)}
          disabled={isExporting}
          aria-label="Save progress collage"
          className="p-1.5 rounded-md border border-line text-muted disabled:opacity-40"
        >
          {isExporting ? (
            <span className="block h-4 w-4 rounded-full border-2 border-muted/40 border-t-accent animate-spin" />
          ) : (
            <Download size={16} strokeWidth={2} />
          )}
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2 px-4 pb-3">
        {PHOTO_POSES.map((pose) => (
          <button
            key={pose}
            onClick={() => setActivePose(pose)}
            className={`min-h-9 px-2 text-xs leading-tight rounded-full border ${
              activePose === pose ? "border-accent text-accent" : "border-line text-muted"
            }`}
          >
            {PHOTO_POSE_LABEL[pose]}
          </button>
        ))}
      </div>

      <main className="px-4 max-w-md mx-auto space-y-3">
        <div className="flex gap-2">
          <button onClick={() => setSheetTarget("left")} className="flex-1 border border-line rounded-md px-3 py-2 text-left active:bg-surface-raised">
            <span className="block text-[10px] uppercase tracking-widest text-muted">Before</span>
            <span className="block text-sm text-ink mt-0.5 truncate">{leftDate ? formatDayLabel(leftDate) : "Select date"}</span>
            <span className="block text-[11px] text-weight tabular mt-0.5">{weightLabel(leftTrendKg, unit)}</span>
          </button>
          <button onClick={() => setSheetTarget("right")} className="flex-1 border border-line rounded-md px-3 py-2 text-left active:bg-surface-raised">
            <span className="block text-[10px] uppercase tracking-widest text-muted">After</span>
            <span className="block text-sm text-ink mt-0.5 truncate">{rightDate ? formatDayLabel(rightDate) : "Select date"}</span>
            <span className="block text-[11px] text-weight tabular mt-0.5">{weightLabel(rightTrendKg, unit)}</span>
          </button>
        </div>

        {exportError && <p className="text-xs text-protein">{exportError}</p>}

        {viewMode === "slider" ? (
          <div data-no-rubber-band className="relative aspect-[3/4] w-full rounded-md overflow-hidden bg-dashboardCard border border-line">
            <ReactCompareSlider
              className="w-full h-full"
              handle={
                <ReactCompareSliderHandle
                  buttonStyle={{
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    background: "rgba(255,255,255,0.15)",
                    border: "1.5px solid rgba(255,255,255,0.35)",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                    width: 36,
                    height: 36,
                  }}
                  linesStyle={{ color: "rgba(255,255,255,0.35)", width: 2 }}
                />
              }
              itemOne={
                leftPhoto ? (
                  <ReactCompareSliderImage src={`/api/photos/${leftPhoto.id}/file`} alt={`Before ${PHOTO_POSE_LABEL[activePose]} photo`} style={{ objectFit: "contain", background: "transparent" }} />
                ) : (
                  <NoPhotoSlot />
                )
              }
              itemTwo={
                rightPhoto ? (
                  <ReactCompareSliderImage src={`/api/photos/${rightPhoto.id}/file`} alt={`After ${PHOTO_POSE_LABEL[activePose]} photo`} style={{ objectFit: "contain", background: "transparent" }} />
                ) : (
                  <NoPhotoSlot />
                )
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            <PhotoCard label="Before" date={leftDate} photo={leftPhoto} weightLabel={weightLabel(leftTrendKg, unit)} onChange={() => setSheetTarget("left")} />
            <PhotoCard label="After" date={rightDate} photo={rightPhoto} weightLabel={weightLabel(rightTrendKg, unit)} onChange={() => setSheetTarget("right")} />
          </div>
        )}

        <PhotoCompareAiCard
          leftPhoto={leftPhoto}
          rightPhoto={rightPhoto}
          compare={comparePhotos}
        />
      </main>

      {sheetTarget && (
        <PhotoDatePickerSheet
          title={`Select ${sheetTarget === "left" ? "before" : "after"} date`}
          dates={datesForPose}
          selectedDate={sheetTarget === "left" ? leftDate : rightDate}
          onSelect={selectDate}
          onClose={() => setSheetTarget(null)}
        />
      )}

      {showLayoutPicker && (
        <ExportLayoutSheet
          isExporting={isExporting}
          onPick={(layout) => handleExport(layout)}
          onClose={() => setShowLayoutPicker(false)}
        />
      )}
    </div>
  );
}

function NoPhotoSlot() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted">
      <ImageOff size={22} strokeWidth={1.8} />
      <span className="text-xs">No photo</span>
    </div>
  );
}

function PhotoCard({
  label,
  date,
  photo,
  weightLabel: weightText,
  onChange,
}: {
  label: string;
  date: string;
  photo: Photo | null;
  weightLabel: string;
  onChange: () => void;
}) {
  return (
    <div className="border border-line bg-surface rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="block text-[10px] uppercase tracking-widest text-muted">{label}</span>
          <span className="block text-sm text-ink">{date ? formatDayLabel(date) : "Select date"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-weight tabular">{weightText}</span>
          <button onClick={onChange} className="text-xs px-2 py-1 rounded-md border border-line text-muted">
            Change
          </button>
        </div>
      </div>
      <div className="aspect-[3/4] w-full rounded-md overflow-hidden bg-dashboardCard">
        {photo ? (
          <img src={`/api/photos/${photo.id}/file`} alt={`${label} photo`} className="w-full h-full object-cover" />
        ) : (
          <NoPhotoSlot />
        )}
      </div>
    </div>
  );
}

// Three states, one card: an "Ask AI" prompt, a loading state, or the result
// (either a flat list of observations or an explicit "no visible change" —
// see engine/photoCompare.ts for why the latter is a normal, valid outcome
// this deliberately doesn't dress up as anything else). Disabled until both
// sides of the comparison actually have a photo.
function PhotoCompareAiCard({
  leftPhoto,
  rightPhoto,
  compare,
}: {
  leftPhoto: Photo | null;
  rightPhoto: Photo | null;
  compare: ReturnType<typeof useComparePhotos>;
}) {
  function run() {
    if (!leftPhoto || !rightPhoto || compare.isPending) return;
    compare.mutate({ photoIdA: leftPhoto.id, photoIdB: rightPhoto.id });
  }

  return (
    <div className="border border-line bg-surface rounded-2xl p-3">
      {compare.data ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
              <Sparkles size={13} strokeWidth={2} />
              AI comparison
            </span>
            <button onClick={run} className="text-xs text-muted">
              Redo
            </button>
          </div>
          {compare.data.hasVisibleChange ? (
            <ul className="space-y-1 list-disc list-inside">
              {compare.data.observations.map((o, i) => (
                <li key={i} className="text-sm text-ink">{o}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No clearly visible change between these two photos.</p>
          )}
        </div>
      ) : compare.isError ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-protein">
            {compare.error instanceof Error ? compare.error.message : "Couldn't compare those photos"}
          </p>
          <button onClick={run} className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-line text-muted">
            Retry
          </button>
        </div>
      ) : (
        <button
          onClick={run}
          disabled={!leftPhoto || !rightPhoto || compare.isPending}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-accent disabled:opacity-40"
        >
          {compare.isPending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Comparing…
            </>
          ) : (
            <>
              <Sparkles size={15} strokeWidth={2} />
              Ask AI to compare
            </>
          )}
        </button>
      )}
    </div>
  );
}

function ExportLayoutSheet({
  isExporting,
  onPick,
  onClose,
}: {
  isExporting: boolean;
  onPick: (layout: "vertical" | "horizontal") => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/60"
      panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-white">Export options</span>
          </div>
          <div className="px-4 pb-4 space-y-2">
            <button
              disabled={isExporting}
              onClick={() => {
                onPick("vertical");
                close();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-md bg-dashboardCard text-left active:bg-surface-raised disabled:opacity-50"
            >
              <span className="text-sm text-white flex-1">Vertical collage</span>
              <span className="text-xs text-muted">Stacked, tall export</span>
            </button>
            <button
              disabled={isExporting}
              onClick={() => {
                onPick("horizontal");
                close();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-md bg-dashboardCard text-left active:bg-surface-raised disabled:opacity-50"
            >
              <span className="text-sm text-white flex-1">Horizontal collage</span>
              <span className="text-xs text-muted">Side-by-side, wide export</span>
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
