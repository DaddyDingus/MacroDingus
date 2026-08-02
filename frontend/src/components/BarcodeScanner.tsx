import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

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
// extensions not in TS's lib.dom types yet, and neither reliably reaches the
// physical lens — confirmed on a Galaxy S24+ in Chrome: both manual focusDistance
// and pointsOfInterest (tap-to-focus) resolve applyConstraints successfully, with
// the browser echoing back the exact values requested, but produce no visible
// focus change. That's a driver-level gap between what Chrome's camera shim
// reports and what the Samsung camera stack actually does underneath it — not
// something fixable from here. Both controls are kept anyway since they're
// harmless and may genuinely work on other hardware/driver combinations; native
// camera access (e.g. wrapping with Capacitor) is the real fix if reliable focus
// control ever becomes a priority.
interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step: number };
  zoom?: { min: number; max: number; step: number };
}
type ExtendedConstraints = MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> };

const MAX_USEFUL_FOCUS_METERS = 1; // capability "max" is often a meaningless huge sentinel value

const LENS_STORAGE_KEY = "macrotrack.barcodeCameraDeviceId";

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
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);
  const [focusRange, setFocusRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [focusDistance, setFocusDistance] = useState(0.1);
  const [tapMarker, setTapMarker] = useState<{ x: number; y: number } | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(() => localStorage.getItem(LENS_STORAGE_KEY));
  const [lensOptions, setLensOptions] = useState<MediaDeviceInfo[]>([]);

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

    // A saved deviceId (from a manual lens switch) pins the exact physical camera.
    // Otherwise leave lens choice to the browser/OS — on multi-lens phones this
    // frequently lands on the ultra-wide, which the zoom heuristic below tries to
    // correct for on this first, undirected attempt only.
    const videoConstraints: ExtendedConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: "environment" };

    reader
      .decodeFromConstraints({ video: videoConstraints }, videoRef.current!, (result) => {
        if (result && !stopped) {
          stopped = true;
          controls?.stop();
          onScanRef.current(result.getText());
        }
      })
      .then(async (c) => {
        controls = c;
        if (cancelled) {
          controls.stop();
          return;
        }

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
          setLensOptions(backish.length > 1 ? backish : videoInputs);
        } catch {
          // enumerateDevices failing just means no manual switch button — non-fatal.
        }
      })
      .catch(() => {
        setError("Couldn't access the camera. Check camera permission for this site.");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [deviceId]);

  function handleSwitchLens() {
    if (lensOptions.length < 2) return;
    const currentId = trackRef.current?.getSettings().deviceId ?? deviceId;
    const idx = lensOptions.findIndex((d) => d.deviceId === currentId);
    const next = lensOptions[(idx + 1) % lensOptions.length];
    localStorage.setItem(LENS_STORAGE_KEY, next.deviceId);
    setDeviceId(next.deviceId);
  }

  function handleFocusChange(value: number) {
    setFocusDistance(value);
    const track = trackRef.current;
    if (!track) return;
    const constraints: ExtendedConstraints = { advanced: [{ focusMode: "manual", focusDistance: value }] };
    track.applyConstraints(constraints as MediaTrackConstraints).catch(() => {});
  }

  // Best-effort: not confirmed to actually move the lens on every device (see
  // the file-level comment), but harmless to leave in — no downside if it's a
  // no-op, and it may well work on hardware/driver combos other than the one
  // this was tested against.
  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    const video = videoRef.current;
    const track = trackRef.current;
    if (!video || !track) return;

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
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <span className="text-sm font-medium text-ink">Scan barcode</span>
        <div className="flex items-center gap-4">
          {lensOptions.length > 1 && (
            <button onClick={handleSwitchLens} className="text-muted text-sm leading-none px-1">
              Switch lens
            </button>
          )}
          <button onClick={onClose} className="text-muted text-xl leading-none px-1">
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden" onClick={handleTap}>
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-40 border-2 border-accent/70 rounded-md" />
        </div>
        {tapMarker && (
          <div
            className="absolute h-14 w-14 -ml-7 -mt-7 rounded-full border-2 border-accent pointer-events-none"
            style={{ left: tapMarker.x, top: tapMarker.y }}
          />
        )}
      </div>

      <div className="px-4 py-4 text-center shrink-0">
        {error ? (
          <p className="text-sm text-protein">{error}</p>
        ) : (
          <p className="text-sm text-muted mb-2">Tap the barcode to focus on it</p>
        )}
        {focusRange && (
          // data-no-rubber-band: a horizontal thumb-drag always carries a
          // little vertical wobble, which is enough to arm
          // useRubberBandScroll's pull gesture (and its preventDefault) on
          // top of the drag — same fix as the Compare screen's slider and
          // the Goal wizard's sliders.
          <div data-no-rubber-band className="pt-1">
            <input
              type="range"
              min={focusRange.min}
              max={focusRange.max}
              step={focusRange.step}
              value={focusDistance}
              onChange={(e) => handleFocusChange(Number(e.target.value))}
              className="w-full accent-accent"
              aria-label="Focus distance"
            />
            <div className="flex justify-between text-[11px] text-muted">
              <span>Close</span>
              <span>Focus</span>
              <span>Far</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
