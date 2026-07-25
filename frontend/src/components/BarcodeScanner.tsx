import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";

export default function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);

  // Deps intentionally empty: this starts the camera exactly once on mount and
  // tears it down on unmount. Reading onScan through a ref avoids restarting
  // the camera stream every time the parent re-renders with a new callback.
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null;
    let cancelled = false;
    let stopped = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current!,
        (result) => {
          if (result && !stopped) {
            stopped = true;
            controls?.stop();
            onScanRef.current(result.getText());
          }
        }
      )
      .then((c) => {
        controls = c;
        if (cancelled) controls.stop();
      })
      .catch(() => {
        setError("Couldn't access the camera. Check camera permission for this site.");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

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

      <div className="px-4 py-6 text-center shrink-0">
        {error ? (
          <p className="text-sm text-protein">{error}</p>
        ) : (
          <p className="text-sm text-muted">Point the camera at a barcode</p>
        )}
      </div>
    </div>
  );
}
