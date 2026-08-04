import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import imageCompression from "browser-image-compression";
import { Calendar, Camera, ChevronDown, ChevronLeft, Columns2, Trash2, X } from "lucide-react";
import {
  PHOTO_POSES,
  PHOTO_POSE_LABEL,
  usePhotos,
  useUploadPhoto,
  useDeletePhoto,
  type Photo,
  type PhotoPose,
} from "../api/photos";
import {
  BODY_PARTS,
  useMeasurements,
  useSaveMeasurements,
  useDeleteMeasurementsForDate,
  type Measurement,
} from "../api/measurements";
import { lengthUnitFor, cmToUnit, unitToCm } from "../lib/lengthUnit";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import { useWeightTrend } from "../api/weights";
import { localDateString, formatDayLabel, addDays } from "../lib/date";
import { useBackDismiss } from "../lib/useBackDismiss";
import { useHideBottomNav } from "../lib/navVisibility";
import PhotoAlignerModal from "../components/PhotoAlignerModal";
import CalendarJumpSheet from "../components/CalendarJumpSheet";
import ConfirmDeleteSheet from "../components/ConfirmDeleteSheet";
import PhotoSourceSheet from "../components/PhotoSourceSheet";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const suffix = y !== new Date().getFullYear() ? ` ${y}` : "";
  return `${d} ${MONTH_ABBR[m - 1]}${suffix}`;
}

function formatDateTaken(dateStr: string): string {
  const today = localDateString();
  const label = formatShortDate(dateStr);
  if (dateStr === today) return `Today, ${label}`;
  if (dateStr === addDays(today, -1)) return `Yesterday, ${label}`;
  return label;
}

// Latest photo for this pose strictly before `beforeDate` — the "ghost"
// reference the aligner lines the new shot up against. Deliberately not
// "before or equal": re-shooting the same date's pose shouldn't ghost
// against the photo it's about to replace.
function findGhostPhoto(photos: Photo[], pose: PhotoPose, beforeDate: string): Photo | null {
  const candidates = photos.filter((p) => p.pose === pose && p.date < beforeDate).sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] ?? null;
}

type DeleteTarget =
  | { kind: "photo"; photo: Photo }
  | { kind: "day"; date: string; photos: Photo[]; hasMeasurements: boolean };

export default function PhotosScreen() {
  const navigate = useNavigate();
  const photos = usePhotos();
  const upload = useUploadPhoto();
  const deletePhoto = useDeletePhoto();
  const measurementsQuery = useMeasurements();
  const saveMeasurements = useSaveMeasurements();
  const deleteMeasurementsForDate = useDeleteMeasurementsForDate();
  // Trend, not raw scale — a single day's scale reading is noisy (water,
  // sodium, food in transit) and doesn't correlate well with what a photo
  // actually shows next to it; trend is the smoothed number the rest of the
  // app already treats as "your real weight" (Dashboard, Weight tab).
  const weightTrend = useWeightTrend(3650);
  const { unit: weightUnit } = useWeightUnit();
  const lengthUnit = lengthUnitFor(weightUnit);

  // Two separate inputs rather than one — a bare accept="image/*" input
  // (no `capture`) doesn't reliably show a "Camera or Gallery?" chooser on
  // Android/Chrome, it can jump straight into the system photo picker
  // instead. Presenting our own two-option sheet (components/PhotoSourceSheet.tsx)
  // and routing to whichever input matches guarantees the choice is asked
  // every time. Same pattern reused by AddFoodSheet's Describe tab.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(localDateString);
  const [pickerPose, setPickerPose] = useState<PhotoPose | null>(null);
  const [sourcePickerPose, setSourcePickerPose] = useState<PhotoPose | null>(null);
  const [compressingPose, setCompressingPose] = useState<PhotoPose | null>(null);
  const [aligning, setAligning] = useState<{ pose: PhotoPose; file: File } | null>(null);
  const [zoneError, setZoneError] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [measurementsExpanded, setMeasurementsExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [measurementDrafts, setMeasurementDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(BODY_PARTS.map((part) => [part, ""]))
  );
  const [saveError, setSaveError] = useState("");

  const all = photos.data ?? [];
  const allMeasurements = measurementsQuery.data ?? [];

  function openPicker(pose: PhotoPose) {
    setSourcePickerPose(pose);
  }

  function chooseCamera() {
    const pose = sourcePickerPose;
    setSourcePickerPose(null);
    if (!pose) return;
    setPickerPose(pose);
    cameraInputRef.current?.click();
  }

  function chooseLibrary() {
    const pose = sourcePickerPose;
    setSourcePickerPose(null);
    if (!pose) return;
    setPickerPose(pose);
    libraryInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const pose = pickerPose;
    setPickerPose(null);
    if (!file || !pose) return;
    setZoneError("");
    setCompressingPose(pose);
    try {
      // Keep enough source detail for a zoomed-in crop to still reach the
      // aligner's fixed 1200x1600 output. This is a working-image bound for
      // predictable phone memory/performance, not the final storage target.
      const compressed = await imageCompression(file, { maxSizeMB: 4, maxWidthOrHeight: 2560, useWebWorker: true });
      setAligning({ pose, file: compressed as File });
    } catch (err) {
      console.error("Progress photo pre-processing failed:", err);
      setZoneError(`Could not process the ${PHOTO_POSE_LABEL[pose].toLowerCase()} photo.`);
    } finally {
      setCompressingPose(null);
    }
  }

  async function handleAlignerConfirm(blob: Blob) {
    if (!aligning) return;
    await upload.mutateAsync({ file: blob, date, pose: aligning.pose });
    setAligning(null);
  }

  const ghostUrl = aligning
    ? (() => {
        const ghost = findGhostPhoto(all, aligning.pose, date);
        return ghost ? `/api/photos/${ghost.id}/file` : null;
      })()
    : null;

  function updateMeasurementDraft(part: string, value: string) {
    if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;
    setMeasurementDrafts((cur) => ({ ...cur, [part]: value }));
    if (saveError) setSaveError("");
  }

  const hasDraftMeasurements = Object.values(measurementDrafts).some((v) => v.trim() !== "");

  async function handleSaveMeasurements() {
    const rows = BODY_PARTS.map((part) => ({ part, value: measurementDrafts[part].trim() }))
      .filter((r) => r.value !== "")
      .map((r) => ({ part: r.part, valueCm: unitToCm(Number(r.value), lengthUnit) }));
    if (rows.length === 0) return;
    setSaveError("");
    try {
      await saveMeasurements.mutateAsync({ date, measurements: rows });
      setMeasurementDrafts(Object.fromEntries(BODY_PARTS.map((part) => [part, ""])));
    } catch (err) {
      console.error("Saving measurements failed:", err);
      setSaveError("Could not save measurements.");
    }
  }

  const historyGroups = useMemo(() => {
    const byDate = new Map<string, { photos: Photo[]; measurements: Measurement[] }>();
    function bucket(d: string) {
      if (!byDate.has(d)) byDate.set(d, { photos: [], measurements: [] });
      return byDate.get(d)!;
    }
    for (const p of all) bucket(p.date).photos.push(p);
    for (const m of allMeasurements) bucket(m.date).measurements.push(m);
    const trendByDate = new Map((weightTrend.data ?? []).map((t) => [t.date, t.trendKg]));
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([groupDate, group]) => ({
        date: groupDate,
        posed: PHOTO_POSES.map((pose) => group.photos.find((p) => p.pose === pose)).filter((p): p is Photo => !!p),
        other: group.photos.filter((p) => !p.pose),
        measurements: group.measurements,
        trendWeightKg: trendByDate.get(groupDate) ?? null,
      }));
  }, [all, allMeasurements, weightTrend.data]);

  const markedDates = useMemo(() => {
    const s = new Set<string>();
    for (const p of all) s.add(p.date);
    for (const m of allMeasurements) s.add(m.date);
    return [...s];
  }, [all, allMeasurements]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.kind === "photo") {
        await deletePhoto.mutateAsync(deleteTarget.photo.id);
        if (viewingId === deleteTarget.photo.id) setViewingId(null);
      } else {
        await Promise.all([
          ...deleteTarget.photos.map((p) => deletePhoto.mutateAsync(p.id)),
          ...(deleteTarget.hasMeasurements ? [deleteMeasurementsForDate.mutateAsync(deleteTarget.date)] : []),
        ]);
      }
      setDeleteTarget(null);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setIsDeleting(false);
    }
  }

  const viewing = all.find((p) => p.id === viewingId) ?? null;
  // The lightbox is state within this always-mounted screen (not a
  // separately-mounted component), so `active` has to track `viewing`
  // directly rather than being hardcoded true — back closes just the
  // lightbox instead of leaving Photos via the tab bar's own screen.
  useBackDismiss(!!viewing, () => setViewingId(null));
  useHideBottomNav(!!viewing);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="h-9 w-9 -ml-1.5 shrink-0 flex items-center justify-center rounded-full text-ink active:bg-white/10"
          >
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
          <div>
            <p className="text-[11px] tracking-widest uppercase text-muted leading-none">Tracking</p>
            <h1 className="text-xl font-bold leading-tight mt-0.5">Physique Log</h1>
          </div>
        </div>
        <button
          onClick={() => navigate("/photos/compare")}
          className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-full bg-surface-raised border border-line text-ink font-medium active:bg-white/10"
        >
          <Columns2 size={14} strokeWidth={2} />
          Compare
        </button>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
        <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </header>

      <main className="px-4 max-w-md mx-auto space-y-4">
        <section className="rounded-2xl bg-surface border border-line p-4 space-y-4">
          <div>
            <p className="text-[11px] tracking-widest uppercase text-muted mb-1.5">Date taken</p>
            <button
              type="button"
              onClick={() => setCalendarOpen(true)}
              aria-label="Change date taken"
              className="w-full flex items-center justify-between active:opacity-70"
            >
              <span className="text-xl font-bold text-ink">{formatDateTaken(date)}</span>
              <Calendar size={19} strokeWidth={2} className="text-muted shrink-0" />
            </button>
          </div>

          <div>
            <p className="text-[11px] tracking-widest uppercase text-muted mb-2">Progress photos</p>
            <div className="grid grid-cols-3 gap-2">
              {PHOTO_POSES.map((pose) => {
                const existing = all.find((p) => p.pose === pose && p.date === date);
                const isCompressing = compressingPose === pose;
                return (
                  <div key={pose} className="relative">
                    <button
                      type="button"
                      onClick={() => openPicker(pose)}
                      className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-surface-raised flex flex-col items-center justify-center gap-1.5"
                    >
                      {existing ? (
                        <>
                          <img
                            src={`/api/photos/${existing.id}/file`}
                            alt={`${PHOTO_POSE_LABEL[pose]} progress photo for ${formatDayLabel(date)}`}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-black/60 text-ink">
                            {PHOTO_POSE_LABEL[pose]}
                          </span>
                        </>
                      ) : isCompressing ? (
                        <span className="h-5 w-5 rounded-full border-2 border-muted/40 border-t-accent animate-spin" />
                      ) : (
                        <>
                          <span className="h-9 w-9 rounded-full bg-dashboardBg/60 flex items-center justify-center">
                            <Camera size={17} strokeWidth={1.8} className="text-muted" />
                          </span>
                          <span className="px-1 text-center text-[10px] leading-tight font-semibold tracking-wide uppercase text-muted">
                            {PHOTO_POSE_LABEL[pose]}
                          </span>
                        </>
                      )}
                    </button>
                    {existing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ kind: "photo", photo: existing });
                        }}
                        aria-label={`Delete ${pose} photo`}
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center text-ink"
                      >
                        <X size={13} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {zoneError && <p className="text-xs text-protein mt-2">{zoneError}</p>}
          </div>
        </section>

        <section className="rounded-2xl bg-surface border border-line overflow-hidden">
          <button
            type="button"
            onClick={() => setMeasurementsExpanded((v) => !v)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <span className="text-[11px] tracking-widest uppercase text-muted">Measurements</span>
            <ChevronDown
              className={`w-4 h-4 text-muted transition-transform ${measurementsExpanded ? "rotate-180" : ""}`}
              strokeWidth={2}
            />
          </button>
          {/* Grid-rows animation (0fr -> 1fr), not a plain conditional render
              — an inner `overflow-hidden` wrapper clips the content while its
              outer row track animates, which fakes a smooth "auto height"
              transition without needing to measure the content's real height
              (BODY_PARTS' length isn't fixed/known ahead of time). Content
              still fully unmounts at 0fr's effective zero height, so a
              collapsed sheet doesn't leave inputs focusable/tab-reachable. */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{ gridTemplateRows: measurementsExpanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-4">
                <div className="divide-y divide-line">
                  {BODY_PARTS.map((part) => (
                    <label key={part} className="flex items-center justify-between py-3">
                      <span className="text-sm font-semibold text-ink">{part}</span>
                      <span className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          value={measurementDrafts[part]}
                          onChange={(e) => updateMeasurementDraft(part, e.target.value)}
                          className="w-16 bg-transparent text-right text-lg font-semibold tabular text-ink placeholder:text-muted/50 focus:outline-none"
                        />
                        <span className="text-xs text-muted w-5">{lengthUnit}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {saveError && <p className="text-xs text-protein mt-3">{saveError}</p>}
                <button
                  onClick={handleSaveMeasurements}
                  disabled={!hasDraftMeasurements || saveMeasurements.isPending}
                  className="w-full mt-4 py-3 rounded-full bg-accent font-semibold text-sm disabled:opacity-30"
                  style={{ color: "#0B1210" }}
                >
                  {saveMeasurements.isPending ? "Saving…" : "Save Physique Log"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-base font-semibold mb-2 px-1">History</h2>
          {historyGroups.length === 0 && (
            <p className="text-sm text-muted text-center py-10">
              No physique logs yet — add a photo or measurement above.
            </p>
          )}
          <div className="space-y-3">
            {historyGroups.map((group) => {
              const groupPhotos = [...group.posed, ...group.other];
              return (
                <article key={group.date} className="rounded-2xl bg-surface border border-line p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-lg font-bold text-ink">{formatShortDate(group.date)}</p>
                      {group.trendWeightKg !== null && (
                        <p className="text-xs text-weight tabular font-medium mt-0.5">
                          {kgToUnit(group.trendWeightKg, weightUnit).toFixed(1)} {weightUnit}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        setDeleteTarget({ kind: "day", date: group.date, photos: groupPhotos, hasMeasurements: group.measurements.length > 0 })
                      }
                      aria-label={`Delete log for ${formatShortDate(group.date)}`}
                      className="h-8 w-8 flex items-center justify-center rounded-full text-muted active:bg-white/10 active:text-protein"
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  </div>

                  {groupPhotos.length > 0 && (
                    <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
                      {groupPhotos.map((photo) => (
                        <div key={photo.id} className="relative shrink-0">
                          <button
                            onClick={() => setViewingId(photo.id)}
                            className="relative h-36 aspect-[4/5] rounded-xl overflow-hidden bg-dashboardCard"
                          >
                            <img
                              src={`/api/photos/${photo.id}/file`}
                              alt={photo.pose ? `${PHOTO_POSE_LABEL[photo.pose]} photo for ${formatDayLabel(group.date)}` : formatDayLabel(group.date)}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                            {photo.pose && (
                              <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-black/60 text-ink">
                                {PHOTO_POSE_LABEL[photo.pose]}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({ kind: "photo", photo });
                            }}
                            aria-label="Delete photo"
                            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center text-ink"
                          >
                            <X size={13} strokeWidth={2.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {group.measurements.length > 0 && (
                    <div className={`grid grid-cols-2 gap-x-4 gap-y-1.5 ${groupPhotos.length > 0 ? "pt-3 border-t border-line" : ""}`}>
                      {group.measurements.map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-xs">
                          <span className="text-muted">{m.part}</span>
                          <span className="tabular text-ink font-medium">
                            {cmToUnit(m.valueCm, lengthUnit).toFixed(1)} {lengthUnit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>

      {sourcePickerPose && (
        <PhotoSourceSheet
          onChooseCamera={chooseCamera}
          onChooseLibrary={chooseLibrary}
          onClose={() => setSourcePickerPose(null)}
        />
      )}

      {aligning && (
        <PhotoAlignerModal
          pose={aligning.pose}
          file={aligning.file}
          ghostUrl={ghostUrl}
          onConfirm={handleAlignerConfirm}
          onCancel={() => setAligning(null)}
        />
      )}

      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={markedDates}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteSheet
          title={deleteTarget.kind === "photo" ? "Delete Photo" : "Delete Physique Log"}
          message={
            deleteTarget.kind === "photo"
              ? `Delete this ${deleteTarget.photo.pose ? `${PHOTO_POSE_LABEL[deleteTarget.photo.pose]} ` : ""}photo from ${formatShortDate(deleteTarget.photo.date)}? This can't be undone.`
              : `Delete all photos and measurements logged for ${formatShortDate(deleteTarget.date)}? This can't be undone.`
          }
          confirmLabel={deleteTarget.kind === "photo" ? "Delete Photo" : "Delete Log"}
          isPending={isDeleting}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 shrink-0">
            <span className="text-sm text-ink">
              {formatDayLabel(viewing.date)}
              {viewing.pose && <span className="text-muted"> · {PHOTO_POSE_LABEL[viewing.pose]}</span>}
            </span>
            <button onClick={() => setViewingId(null)} className="text-muted text-xl leading-none px-1">
              ×
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={`/api/photos/${viewing.id}/file`}
              alt={formatDayLabel(viewing.date)}
              className="max-w-full max-h-full object-contain"
            />
          </div>
          <div className="p-4 shrink-0">
            <button
              onClick={() => setDeleteTarget({ kind: "photo", photo: viewing })}
              className="w-full py-3 rounded-md border border-line text-sm text-muted flex items-center justify-center gap-2"
            >
              <Trash2 size={15} strokeWidth={2} />
              Delete photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
