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

// focusMode/focusDistance are non-standard MediaTrackConstraints/Capabilities
// extensions not in TS's lib.dom types yet. Support is inconsistent enough
// (confirmed on a Galaxy S24+ in Chrome: focusMode capability only lists
// "manual", even though "continuous" shows as the live setting Chrome won't
// let a page actually request) that continuous AF can't be assumed — manual
// focusDistance with a slider is the only thing that reliably works.
interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step: number };
}
type ExtendedConstraints = MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> };

const MAX_USEFUL_FOCUS_METERS = 1; // capability "max" is often a meaningless huge sentinel value

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

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <span className="text-sm font-medium text-ink">Scan barcode</span>
        <button onClick={onClose} className="text-muted text-xl leading-none px-1">
          ×
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-40 border-2 border-accent/70 rounded-md" />
        </div>
      </div>

      <div className="px-4 py-4 text-center shrink-0">
        {error ? (
          <p className="text-sm text-protein">{error}</p>
        ) : (
          <p className="text-sm text-muted mb-2">Hold steady, close to the barcode</p>
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
      </div>
    </div>
  );
}
