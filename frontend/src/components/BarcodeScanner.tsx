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
// extensions not in TS's lib.dom types yet, and support is inconsistent enough
// that nothing here can be assumed to work — confirmed on a Galaxy S24+ in Chrome:
// focusMode capability only lists "manual", and manually driving focusDistance
// resolves successfully (browser echoes back the exact value requested) with zero
// effect on the actual lens. pointsOfInterest isn't even listed as a capability on
// that device, so tap-to-focus below is a genuine "try it and see" rather than a
// confirmed-working fallback.
interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step: number };
}
type ExtendedConstraints = MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> };

const MAX_USEFUL_FOCUS_METERS = 1; // capability "max" is often a meaningless huge sentinel value

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
  const [tapDebug, setTapDebug] = useState<string | null>(null);

  // Deps intentionally empty: this starts the camera exactly once on mount and
  // tears it down on unmount. Reading onScan through a ref avoids restarting
  // the camera stream every time the parent re-renders with a new callback.
  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, PRODUCT_BARCODE_FORMATS);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

    let controls: IScannerControls | null = null;
    let cancelled = false;
    let stopped = false;

    const videoConstraints: ExtendedConstraints = { facingMode: "environment" };

    reader
      .decodeFromConstraints({ video: videoConstraints }, videoRef.current!, (result) => {
        if (result && !stopped) {
          stopped = true;
          controls?.stop();
          onScanRef.current(result.getText());
        }
      })
      .then((c) => {
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
          return;
        }

        if (caps.focusMode?.includes("continuous")) {
          const constraints: ExtendedConstraints = { advanced: [{ focusMode: "continuous" }] };
          track.applyConstraints(constraints as MediaTrackConstraints).catch(() => {});
        } else if (caps.focusMode?.includes("manual") && caps.focusDistance) {
          const range = {
            min: caps.focusDistance.min,
            max: Math.min(caps.focusDistance.max, MAX_USEFUL_FOCUS_METERS),
            step: caps.focusDistance.step || 0.01,
          };
          const initial = Math.min(Math.max(0.1, range.min), range.max);
          setFocusRange(range);
          setFocusDistance(initial);
          const constraints: ExtendedConstraints = {
            advanced: [{ focusMode: "manual", focusDistance: initial }],
          };
          track.applyConstraints(constraints as MediaTrackConstraints).catch(() => {});
        }
      })
      .catch(() => {
        setError("Couldn't access the camera. Check camera permission for this site.");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  function handleFocusChange(value: number) {
    setFocusDistance(value);
    const track = trackRef.current;
    if (!track) return;
    const constraints: ExtendedConstraints = { advanced: [{ focusMode: "manual", focusDistance: value }] };
    track.applyConstraints(constraints as MediaTrackConstraints).catch(() => {});
  }

  // Temporary diagnostic on the result text: remove once tap-to-focus is
  // confirmed working (or confirmed not to be, on this device).
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
    track
      .applyConstraints(constraints as MediaTrackConstraints)
      .then(() => setTapDebug(`pointsOfInterest (${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}) resolved OK`))
      .catch((err) => setTapDebug(`pointsOfInterest REJECTED: ${err?.name ?? ""} ${err?.message ?? String(err)}`));
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <span className="text-sm font-medium text-ink">Scan barcode</span>
        <button onClick={onClose} className="text-muted text-xl leading-none px-1">
          ×
        </button>
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
          <div className="pt-1">
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
        {tapDebug && (
          <pre className="text-left text-[10px] leading-snug text-muted whitespace-pre-wrap break-all bg-surface rounded-md p-2 mt-2">
            {tapDebug}
          </pre>
        )}
      </div>
    </div>
  );
}
