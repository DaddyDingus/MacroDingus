import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Flashlight, SwitchCamera, X } from "lucide-react";

// Retail product barcodes are 1D formats — restricting to these (rather than
// the full set including QR/PDF417/etc.) makes each decode attempt faster and
// less prone to false reads.
const PRODUCT_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
];

// focusMode/focusDistance/pointsOfInterest are non-standard MediaTrackConstraints
// extensions not in TS's lib.dom types yet. Their behavior is lens-dependent:
// tap-to-focus works on the Galaxy S24+'s regular rear lens, while the wide lens
// and manual focusDistance can still accept constraints without visibly moving
// focus. Keep both as best-effort controls rather than treating a resolved
// applyConstraints call as proof that the physical lens moved.
interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step: number };
  zoom?: { min: number; max: number; step: number };
}
type ExtendedConstraints = MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> };

const MAX_USEFUL_FOCUS_METERS = 1; // capability "max" is often a meaningless huge sentinel value

const LENS_STORAGE_KEY = "macrotrack.barcodeCameraDeviceId";

// The saved lens carries its label as well as its deviceId, because a deviceId
// alone does not survive an app restart: Chromium salts media device ids per
// browsing session, and the Android WebView shell re-salts on every launch. The
// label ("camera2 0, facing back") is stable hardware identity, so it's what
// actually restores the preference — see the recovery step in the start effect.
type LensPref = { id: string; label: string };

function readLensPref(): LensPref | null {
  const raw = localStorage.getItem(LENS_STORAGE_KEY);
  if (!raw) return null;
  // Values written before labels were stored are a bare deviceId string.
  if (!raw.startsWith("{")) return { id: raw, label: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<LensPref>;
    return parsed?.id ? { id: parsed.id, label: parsed.label ?? "" } : null;
  } catch {
    return null;
  }
}

function writeLensPref(pref: LensPref) {
  localStorage.setItem(LENS_STORAGE_KEY, JSON.stringify(pref));
}

// Maps a tap's on-screen (client) coordinates to a normalized [0,1] point in the
// video *frame's* own coordinate space, accounting for object-fit: cover cropping
// (the displayed video is scaled up and cropped to fill its container, so a naive
// "tap position / container size" would be wrong whenever the aspect ratios differ).
function mapTapToVideoCoords(video: HTMLVideoElement, clientX: number, clientY: number) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || rect.width === 0 || rect.height === 0) return null;

  const containerAspect = rect.width / rect.height;
  const videoAspect = vw / vh;

  const renderedWidth = videoAspect > containerAspect ? rect.height * videoAspect : rect.width;
  const renderedHeight = videoAspect > containerAspect ? rect.height : rect.width / videoAspect;
  const offsetX = (renderedWidth - rect.width) / 2;
  const offsetY = (renderedHeight - rect.height) / 2;

  const x = (clientX - rect.left + offsetX) / renderedWidth;
  const y = (clientY - rect.top + offsetY) / renderedHeight;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export default function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);
  const [focusRange, setFocusRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [focusDistance, setFocusDistance] = useState(0.1);
  const [tapMarker, setTapMarker] = useState<{ x: number; y: number } | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(() => readLensPref()?.id ?? null);
  const lensLabelRef = useRef(readLensPref()?.label ?? "");
  const lensRecoveryDoneRef = useRef(false);
  const [lensOptions, setLensOptions] = useState<MediaDeviceInfo[]>([]);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);
  const [torchError, setTorchError] = useState<string | null>(null);
  const [showFocusHint, setShowFocusHint] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setShowFocusHint(false), 2400);
    return () => window.clearTimeout(id);
  }, []);

  // Deps: [deviceId]. Re-runs (tearing down and restarting the stream) when the
  // user cycles lenses via handleSwitchLens. Reading onScan through a ref avoids
  // restarting the camera stream every time the parent re-renders with a new callback.
  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, PRODUCT_BARCODE_FORMATS);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

    let controls: IScannerControls | null = null;
    let cancelled = false;
    let stopped = false;

    setFocusRange(null);
    trackRef.current = null;
    scannerControlsRef.current = null;
    setError(null);
    setTorchAvailable(false);
    setTorchOn(false);
    setTorchBusy(false);
    setTorchError(null);

    // A saved deviceId (from a manual lens switch) pins the exact physical camera.
    // Otherwise leave lens choice to the browser/OS — on multi-lens phones this
    // frequently lands on the ultra-wide, which the zoom heuristic below tries to
    // correct for on this first, undirected attempt only.
    // facingMode is wrapped in `ideal` rather than passed as a bare value: some
    // WebView/Chromium builds resolve a bare ConstrainDOMString as an exact
    // requirement, and throw OverconstrainedError when the device's camera(s)
    // don't report facingMode metadata at all (confirmed on a Galaxy S24+ inside
    // the Android WebView shell, where this reliably worked in Chrome itself).
    const videoConstraints: ExtendedConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: "environment" } };

    async function start(constraints: ExtendedConstraints | true, isFallback: boolean) {
      let c: IScannerControls;
      try {
        c = await reader.decodeFromConstraints({ video: constraints }, videoRef.current!, (result) => {
          if (result && !stopped) {
            stopped = true;
            controls?.stop();
            onScanRef.current(result.getText());
          }
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        // A pinned deviceId this session can't open. Drop the pin and let the
        // effect re-run (deps: [deviceId]) own the retry — returning here is
        // load-bearing. Starting the fallback inline *as well* left two
        // getUserMedia calls racing for the same camera, and Android fails
        // whichever loses with NotReadableError ("Could not start video
        // source"), on top of both readers sharing one <video> element. That
        // was the reliable error on the session's first scan, because a lens
        // saved in a previous app launch is always rejected (see below).
        // The saved preference is deliberately NOT cleared here: the label
        // recovery further down is what re-pins it to this session's id.
        if (!isFallback && deviceId && (name === "OverconstrainedError" || name === "NotFoundError" || name === "NotReadableError")) {
          setDeviceId(null);
          return;
        }
        if (!isFallback && !deviceId && name === "OverconstrainedError") {
          // No pin to drop — loosen to "any camera" rather than leaving the
          // scanner permanently broken.
          if (!cancelled) start(true, true);
          return;
        }
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        setError(`Couldn't access the camera. Check camera permission for this site. (${detail})`);
        return;
      }

      controls = c;
      if (cancelled) {
        controls.stop();
        return;
      }
      scannerControlsRef.current = c;
      setTorchAvailable(typeof c.switchTorch === "function");

      const stream = videoRef.current?.srcObject as MediaStream | undefined;
      const track = stream?.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== "function") return;
      trackRef.current = track;

      let caps: ExtendedCapabilities;
      try {
        caps = track.getCapabilities() as ExtendedCapabilities;
      } catch {
        caps = {} as ExtendedCapabilities;
      }

      const advanced: Array<Record<string, unknown>> = [];

      if (caps.focusMode?.includes("continuous")) {
        advanced.push({ focusMode: "continuous" });
      } else if (caps.focusMode?.includes("manual") && caps.focusDistance) {
        const range = {
          min: caps.focusDistance.min,
          max: Math.min(caps.focusDistance.max, MAX_USEFUL_FOCUS_METERS),
          step: caps.focusDistance.step || 0.01,
        };
        const initial = Math.min(Math.max(0.1, range.min), range.max);
        setFocusRange(range);
        setFocusDistance(initial);
        advanced.push({ focusMode: "manual", focusDistance: initial });
      }

      // Samsung's fused multi-camera "environment" stream reports a zoom
      // capability starting below 1x when the ultra-wide is in the blend
      // (only meaningful pre-fix, i.e. no deviceId pin yet). Nudging zoom up
      // to 1x tends to hand the stream to the main lens instead, which has
      // real autofocus for close-range barcode reading.
      if (!deviceId && caps.zoom && caps.zoom.min < 1) {
        const zoomTarget = Math.min(Math.max(1, caps.zoom.min), caps.zoom.max);
        advanced.push({ zoom: zoomTarget });
      }

      if (advanced.length > 0) {
        track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => {});
      }

      if (cancelled) return;
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = all.filter((d) => d.kind === "videoinput");
        const backish = videoInputs.filter((d) => /back|rear/i.test(d.label));
        const options = backish.length > 1 ? backish : videoInputs;
        setLensOptions(options);

        // Restore a saved lens whose deviceId this session re-salted away. It
        // can only happen here: labels are blank until camera access has been
        // granted, so the ids are unmatchable before a stream exists. The ref
        // guard keeps this to one attempt per mount — re-pinning restarts the
        // stream, and a label that never matches must not loop.
        const wantedLabel = lensLabelRef.current;
        if (!deviceId && wantedLabel && !lensRecoveryDoneRef.current) {
          lensRecoveryDoneRef.current = true;
          const match = options.find((d) => d.label === wantedLabel);
          if (!match) {
            localStorage.removeItem(LENS_STORAGE_KEY);
            lensLabelRef.current = "";
          } else {
            writeLensPref({ id: match.deviceId, label: match.label });
            if (!cancelled && match.deviceId !== trackRef.current?.getSettings().deviceId) {
              setDeviceId(match.deviceId);
            }
          }
        }
      } catch {
        // enumerateDevices failing just means no manual switch button — non-fatal.
      }
    }

    start(videoConstraints, false);

    return () => {
      cancelled = true;
      if (scannerControlsRef.current === controls) scannerControlsRef.current = null;
      controls?.stop();
    };
  }, [deviceId]);

  function handleSwitchLens() {
    if (lensOptions.length < 2) return;
    const currentId = trackRef.current?.getSettings().deviceId ?? deviceId;
    const idx = lensOptions.findIndex((d) => d.deviceId === currentId);
    const next = lensOptions[(idx + 1) % lensOptions.length];
    writeLensPref({ id: next.deviceId, label: next.label });
    lensLabelRef.current = next.label;
    // An explicit choice supersedes any pending label recovery for this mount.
    lensRecoveryDoneRef.current = true;
    setDeviceId(next.deviceId);
  }

  function handleFocusChange(value: number) {
    setFocusDistance(value);
    const track = trackRef.current;
    if (!track) return;
    const constraints: ExtendedConstraints = { advanced: [{ focusMode: "manual", focusDistance: value }] };
    track.applyConstraints(constraints as MediaTrackConstraints).catch(() => {});
  }

  async function handleToggleTorch() {
    const controls = scannerControlsRef.current;
    if (!controls?.switchTorch || torchBusy) return;
    const next = !torchOn;
    setTorchBusy(true);
    setTorchError(null);
    try {
      await controls.switchTorch(next);
      if (scannerControlsRef.current === controls) setTorchOn(next);
    } catch {
      if (scannerControlsRef.current === controls) {
        setTorchOn(false);
        setTorchError("Torch isn't available on this lens.");
      }
    } finally {
      if (scannerControlsRef.current === controls) setTorchBusy(false);
    }
  }

  // Best-effort: not confirmed to actually move the lens on every device (see
  // the file-level comment), but harmless to leave in — no downside if it's a
  // no-op, and it may well work on hardware/driver combos other than the one
  // this was tested against.
  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    const video = videoRef.current;
    const track = trackRef.current;
    if (!video || !track) return;
    setShowFocusHint(false);

    const rect = video.getBoundingClientRect();
    setTapMarker({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTimeout(() => setTapMarker(null), 600);

    const coords = mapTapToVideoCoords(video, e.clientX, e.clientY);
    if (!coords) return;

    const constraints: ExtendedConstraints = {
      advanced: [{ pointsOfInterest: [{ x: coords.x, y: coords.y }] }],
    };
    track.applyConstraints(constraints as MediaTrackConstraints).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black overflow-hidden">
      <div className="absolute inset-0" onClick={handleTap}>
        {/* poster: Android WebView (unlike desktop Chrome) renders a large default
            media placeholder icon before the stream's first frame paints. A blank
            poster suppresses it instead of showing that scaled-up play glyph. */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          autoPlay
          poster="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
        />

        {/* The surrounding shadow quiets the preview outside the useful scan
            region without putting an opaque panel over the live camera. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center -translate-y-2">
            <div className="relative w-[82vw] max-w-[420px] aspect-[2.35/1] rounded-2xl overflow-hidden shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]">
              <span className="absolute left-0 top-0 w-9 h-9 rounded-tl-2xl border-l-[3px] border-t-[3px] border-accent" />
              <span className="absolute right-0 top-0 w-9 h-9 rounded-tr-2xl border-r-[3px] border-t-[3px] border-accent" />
              <span className="absolute left-0 bottom-0 w-9 h-9 rounded-bl-2xl border-l-[3px] border-b-[3px] border-accent" />
              <span className="absolute right-0 bottom-0 w-9 h-9 rounded-br-2xl border-r-[3px] border-b-[3px] border-accent" />
              <span className="barcode-scan-line absolute left-6 right-6 h-px bg-accent text-accent shadow-[0_0_10px_currentColor]" />
            </div>
            <div className="mt-4 w-56 min-h-9 px-4 rounded-full border border-white/10 bg-black/45 backdrop-blur-md grid place-items-center text-sm font-medium text-white shadow-lg">
              <span className={`col-start-1 row-start-1 transition-opacity duration-300 motion-reduce:transition-none ${showFocusHint ? "opacity-100" : "opacity-0"}`}>
                Tap anywhere to focus
              </span>
              <span className={`col-start-1 row-start-1 transition-opacity duration-300 motion-reduce:transition-none ${showFocusHint ? "opacity-0" : "opacity-100"}`}>
                Centre barcode in frame
              </span>
            </div>
          </div>
        </div>

        {tapMarker && (
          <div
            className="absolute h-14 w-14 -ml-7 -mt-7 rounded-full border-2 border-accent pointer-events-none"
            style={{ left: tapMarker.x, top: tapMarker.y }}
          />
        )}
      </div>

      <div
        className="absolute inset-x-0 top-0 z-20 px-4 pb-14 bg-gradient-to-b from-black/80 via-black/35 to-transparent flex items-center justify-between"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <span className="text-base font-semibold text-white drop-shadow-sm">Scan barcode</span>
        <div className="flex items-center gap-2">
          {torchAvailable && (
            <button
              type="button"
              onClick={handleToggleTorch}
              disabled={torchBusy}
              aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
              aria-pressed={torchOn}
              className={`h-11 w-11 rounded-full flex items-center justify-center border backdrop-blur-md shadow-lg disabled:opacity-50 ${
                torchOn ? "bg-accent border-accent text-dashboardBg" : "bg-black/45 border-white/10 text-white"
              }`}
            >
              <Flashlight size={19} strokeWidth={2} />
            </button>
          )}
          {lensOptions.length > 1 && (
            <button
              type="button"
              onClick={handleSwitchLens}
              aria-label="Switch lens"
              className="h-11 w-11 rounded-full flex items-center justify-center border border-white/10 bg-black/45 backdrop-blur-md text-white shadow-lg active:bg-white/20"
            >
              <SwitchCamera size={20} strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="h-11 w-11 rounded-full flex items-center justify-center border border-white/10 bg-black/45 backdrop-blur-md text-white shadow-lg active:bg-white/20"
          >
            <X size={21} strokeWidth={2} />
          </button>
        </div>
      </div>

      {(error || torchError) && (
        <div className="absolute z-30 inset-x-4 top-24 flex justify-center pointer-events-none">
          <p className="rounded-full bg-black/70 border border-white/10 backdrop-blur-md px-4 py-2 text-sm text-protein shadow-lg">
            {error ?? torchError}
          </p>
        </div>
      )}

      {focusRange && (
        <div
          className="absolute z-20 inset-x-0 bottom-0 px-4 pt-16 bg-gradient-to-t from-black/80 via-black/35 to-transparent"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="rounded-2xl border border-white/10 bg-black/45 backdrop-blur-md px-4 py-3 shadow-lg">
            {/* data-no-rubber-band: a horizontal thumb-drag always carries a
                little vertical wobble, which is enough to arm
                useRubberBandScroll's pull gesture (and its preventDefault) on
                top of the drag — same fix as the Compare screen's slider and
                the Goal wizard's sliders. */}
            <div data-no-rubber-band>
              <input
                type="range"
                min={focusRange.min}
                max={focusRange.max}
                step={focusRange.step}
                value={focusDistance}
                onChange={(e) => handleFocusChange(Number(e.target.value))}
                className="w-full accent-accent block"
                aria-label="Focus distance"
              />
              <div className="flex justify-between text-[11px] text-white/60">
                <span>Close</span>
                <span>Focus</span>
                <span>Far</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
