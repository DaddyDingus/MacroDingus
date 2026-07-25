import { useEffect, useRef, useState } from "react";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
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

// Chrome on Android supports continuous autofocus and torch as non-standard
// MediaTrackConstraints extensions that aren't in TS's lib.dom types yet.
type ExtendedConstraints = MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> };

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
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

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

    const videoConstraints: ExtendedConstraints = {
      facingMode: "environment",
      advanced: [{ focusMode: "continuous" }],
    };

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
        if (!track) return;
        trackRef.current = track;

        // Some devices only honor focusMode via applyConstraints after the
        // stream is live, not in the initial getUserMedia call — try both.
        const focusConstraints: ExtendedConstraints = { advanced: [{ focusMode: "continuous" }] };
        track.applyConstraints(focusConstraints as MediaTrackConstraints).catch(() => {});

        if (BrowserCodeReader.mediaStreamIsTorchCompatibleTrack(track)) {
          setTorchSupported(true);
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

  function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    BrowserCodeReader.mediaStreamSetTorch(track, next)
      .then(() => setTorchOn(next))
      .catch(() => {});
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
        {torchSupported && (
          <button
            onClick={toggleTorch}
            className={`absolute bottom-4 right-4 h-11 w-11 rounded-full border flex items-center justify-center text-lg ${
              torchOn ? "bg-accent border-accent" : "bg-black/40 border-line"
            }`}
            style={torchOn ? { color: "#0B1210" } : undefined}
            aria-label={torchOn ? "Turn off flashlight" : "Turn on flashlight"}
          >
            ⚡
          </button>
        )}
      </div>

      <div className="px-4 py-6 text-center shrink-0">
        {error ? (
          <p className="text-sm text-protein">{error}</p>
        ) : (
          <p className="text-sm text-muted">Hold steady, close to the barcode</p>
        )}
      </div>
    </div>
  );
}
