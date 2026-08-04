import { useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { X, Grid3x3, FlipHorizontal, Wand2, Loader2 } from "lucide-react";
import { PHOTO_POSE_LABEL, type PhotoPose } from "../api/photos";
import { useHideBottomNav } from "../lib/navVisibility";

// A side pose only shows one shoulder/hip clearly, which doesn't give
// lib/poseAlign.ts's shoulder/hip-based method anything usable to match —
// the "Match Pose" button below is only offered for poses where it can
// actually work.
const POSE_MATCH_SUPPORTED: Record<PhotoPose, boolean> = {
  front: true,
  side: false,
  back: true,
  front_flexed: true,
  side_flexed: false,
  back_flexed: true,
};

const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 1600;

export function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = src;
  });
}

function getRadianAngle(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// react-easy-crop's own recipe for combining rotation with its
// onCropComplete pixel crop: whenever rotation is nonzero, croppedAreaPixels
// is expressed relative to the source image's *rotated bounding box*, not
// the raw unrotated image — cropImageToBlob used to skip this step entirely
// and draw pixelCrop straight off the unrotated image, which happened to
// work at rotation 0 (identity) but read completely the wrong region the
// moment a user actually dialed in a rotation to fix a tilted shot. That
// silent mismatch between what the on-screen preview showed (rotated,
// correctly aligned) and what got saved (never rotated) is what made a
// carefully-aligned photo come out looking off once actually compared later.
function rotatedBoundingBox(width: number, height: number, rotationDeg: number): { width: number; height: number } {
  const rotRad = getRadianAngle(rotationDeg);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

async function cropImageToBlob(imageSrc: string, pixelCrop: Area, rotation: number, flipped: boolean): Promise<Blob> {
  const image = await createImage(imageSrc);

  // Pass 1: draw the source into its full rotated bounding box — the same
  // coordinate space pixelCrop is already expressed in.
  const { width: boxWidth, height: boxHeight } = rotatedBoundingBox(image.width, image.height, rotation);
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = boxWidth;
  rotatedCanvas.height = boxHeight;
  const rotatedCtx = rotatedCanvas.getContext("2d")!;
  rotatedCtx.translate(boxWidth / 2, boxHeight / 2);
  rotatedCtx.rotate(getRadianAngle(rotation));
  rotatedCtx.scale(flipped ? -1 : 1, 1);
  rotatedCtx.translate(-image.width / 2, -image.height / 2);
  rotatedCtx.drawImage(image, 0, 0);

  // Pass 2: crop into one fixed 3:4 output. Besides eliminating the tiny
  // per-photo aspect drift caused by react-easy-crop's pixel rounding, this
  // makes every newly-saved photo large enough for the 1080x1440 comparison
  // export without retaining phone-camera-sized files.
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    rotatedCanvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT
  );

  // Keep the browser-to-server handoff lossless. The server performs the
  // one final JPEG encode after validating, orienting and stripping metadata.
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not crop image"))), "image/png");
  });
}

// Full-screen crop/align step between picking a file and it actually
// uploading — mirrors the same aligner in the companion progress app (react-easy-crop +
// a semi-transparent "ghost" of the last photo for this pose so the new
// shot can be lined up against it before it's saved). `ghostUrl` is
// resolved by the caller from the already-fetched photo list (macrotrack
// has no client-side photo store to query directly, unlike the companion app's
// IndexedDB-backed one).
export default function PhotoAlignerModal({
  pose,
  file,
  ghostUrl,
  onConfirm,
  onCancel,
}: {
  pose: PhotoPose;
  file: File;
  ghostUrl: string | null;
  onConfirm: (blob: Blob) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [imageUrl] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [ghostOpacity, setGhostOpacity] = useState(0.4);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  // react-easy-crop's own internally-computed rendered sizes — not exposed
  // via its main props, only via these two lesser-known callback props.
  // Needed to convert a detected pose's natural-pixel torso length into the
  // zoom/crop values the Cropper's own props expect (see lib/poseAlign.ts's
  // computeAlignment for the full derivation). Null until the Cropper's
  // first layout pass.
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null);
  const [cropSize, setCropSize] = useState<{ width: number; height: number } | null>(null);
  const [isMatchingPose, setIsMatchingPose] = useState(false);

  useHideBottomNav(true);

  useEffect(() => {
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  // Without this, the sliders below could be tapped (a single point, no
  // movement) but not dragged: this modal is its own fixed full-screen div,
  // not built on BottomSheet, so it never got BottomSheet's own body-scroll
  // lock for free. useRubberBandScroll's window-level touchmove listener
  // only bails out when document.body.style.overflow === "hidden" (see its
  // own onTouchStart guard) — without that, any downward drag starting on a
  // slider (anywhere on screen, since the page underneath can't actually
  // scroll while this covers it, so scrollY is always 0 and instantly "at
  // the top edge") gets armed as a pull-to-refresh gesture and preventDefault
  // is called on every subsequent touchmove, which stops the browser's own
  // range-thumb-follow dead after the first point. Same fix AddFoodSheet's
  // own full-screen modal needed for the same reason.
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // Pre-fills zoom/rotation/crop from a detected pose match — an assist,
  // never a final answer. The user still sees the result land on the
  // sliders and can fine-tune (or ignore it and adjust everything by hand)
  // before tapping Confirm exactly as today. Dynamic import, not a
  // module-level one — @mediapipe/tasks-vision only needs to be downloaded
  // if this button is actually tapped, not on every photo alignment.
  async function handleMatchPose() {
    if (!ghostUrl || !mediaSize || !cropSize || isMatchingPose) return;
    setIsMatchingPose(true);
    setError("");
    try {
      const { matchPose } = await import("../lib/poseAlign");
      const [currentImage, ghostImage] = await Promise.all([createImage(imageUrl), createImage(ghostUrl)]);
      const result = await matchPose({ currentImage, ghostImage, media: mediaSize, cropSize });
      setRotation(result.rotation);
      setZoom(result.zoom);
      setCrop(result.crop);
    } catch (err) {
      console.error("Pose match failed:", err);
      setError(err instanceof Error ? err.message : "Couldn't match pose — try aligning manually");
    } finally {
      setIsMatchingPose(false);
    }
  }

  async function handleConfirm() {
    if (!croppedPixels || isProcessing) return;
    setIsProcessing(true);
    setError("");
    try {
      const croppedBlob = await cropImageToBlob(imageUrl, croppedPixels, rotation, isFlipped);
      await onConfirm(croppedBlob);
    } catch (err) {
      console.error("Photo alignment failed:", err);
      setError("Could not confirm alignment.");
      setIsProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="h-9 w-9 -ml-1 shrink-0 flex items-center justify-center rounded-full text-ink active:bg-white/10"
        >
          <X size={20} strokeWidth={2.2} />
        </button>
        <div>
          <p className="text-[11px] tracking-widest uppercase text-muted">{PHOTO_POSE_LABEL[pose]}</p>
          <h2 className="text-sm font-medium text-ink">Align photo</h2>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* restrictPosition={false}: react-easy-crop's default behavior
            re-clamps the crop box's position every time zoom changes (even
            with no panning), purely to guarantee it can never reveal blank
            space past the photo's edge. That's the right default for a
            crop tool used at any zoom level, but it means dialing the zoom
            slider can nudge the box a few px on its own, right after the
            last adjustment and easy to miss before tapping Confirm —
            exactly the kind of "the box moved a little on its own" report
            that led here. Since a progress-photo alignment always frames
            the whole photo well within the crop with room to spare (never
            zoomed out to where the image's edge is actually at risk of
            showing), that safety net isn't needed here, and turning it off
            makes the box's position the user's own input alone, not
            something zoom can silently perturb. */}
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={3 / 4}
          objectFit="contain"
          showGrid={showGrid}
          restrictPosition={false}
          transform={`translate(${crop.x}px, ${crop.y}px) rotate(${rotation}deg) scale(${zoom}) scaleX(${isFlipped ? -1 : 1})`}
          style={{ containerStyle: { background: "transparent" } }}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          // Native two-finger pinch-rotate, alongside pinch-zoom and
          // drag-to-pan — re-enabled at the user's request after briefly
          // being removed. The crop box's own on-screen size legitimately
          // does shift with rotation (see cropImageToBlob's
          // rotatedBoundingBox above), more noticeably the further a
          // photo's aspect ratio is from the 3:4 target — that's expected
          // library behavior, not a bug, and the user prefers keeping the
          // gesture over pinning rotation to the slider alone.
          onRotationChange={setRotation}
          onCropComplete={(_, pixels) => setCroppedPixels(pixels)}
          setMediaSize={setMediaSize}
          setCropSize={setCropSize}
        />
        {/* Sized to cropSize (react-easy-crop's own crop-box dimensions, via
            setCropSize above), NOT the full viewport — the ghost used to be
            `absolute inset-0`, filling the entire modal regardless of how
            big the actual crop box was. Since the crop box is usually
            smaller than the full viewport (whenever the photo being aligned
            isn't itself exactly 3:4), that meant the ghost was displayed at
            a *different scale* than what actually gets saved: matching your
            shoulder against that oversized ghost still left the two photos
            at different relative scale once actually compared, because you
            were aligning against a reference that wasn't shown at 1:1 with
            the real crop box. The ghost is already a previously-saved 3:4
            crop itself, so at cropSize's exact dimensions it fills edge to
            edge with no letterboxing of its own — a true like-for-like
            reference. */}
        {ghostUrl && cropSize && (
          <div
            className="absolute flex items-center justify-center pointer-events-none overflow-hidden"
            style={{
              left: "50%",
              top: "50%",
              width: cropSize.width,
              height: cropSize.height,
              transform: "translate(-50%, -50%)",
            }}
          >
            <img
              src={ghostUrl}
              alt={`${PHOTO_POSE_LABEL[pose]} ghost reference`}
              decoding="async"
              className="w-full h-full object-cover"
              style={{ opacity: ghostOpacity }}
            />
          </div>
        )}
      </div>

      <div
        className="px-4 pt-3 shrink-0 space-y-3"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            <span>Rotation</span>
            <input
              type="range"
              min={-45}
              max={45}
              step={0.5}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </label>
          <label className={`flex flex-col gap-1 text-[11px] text-muted ${!ghostUrl ? "opacity-30 pointer-events-none" : ""}`}>
            <span>Ghost opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={ghostOpacity}
              onChange={(e) => setGhostOpacity(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </label>
        </div>

        {ghostUrl && POSE_MATCH_SUPPORTED[pose] && (
          <button
            type="button"
            onClick={handleMatchPose}
            disabled={isMatchingPose || !mediaSize || !cropSize}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md border border-line text-sm text-accent disabled:opacity-40"
          >
            {isMatchingPose ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Matching pose…
              </>
            ) : (
              <>
                <Wand2 size={16} strokeWidth={2} />
                Match Pose
              </>
            )}
          </button>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border text-xs ${
              showGrid ? "border-accent text-accent" : "border-line text-muted"
            }`}
          >
            <Grid3x3 size={16} strokeWidth={2} />
            Grid
          </button>
          <button
            type="button"
            onClick={() => setIsFlipped((v) => !v)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border text-xs ${
              isFlipped ? "border-accent text-accent" : "border-line text-muted"
            }`}
          >
            <FlipHorizontal size={16} strokeWidth={2} />
            Flip
          </button>
        </div>

        {error && <p className="text-xs text-protein">{error}</p>}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={isProcessing || !croppedPixels}
          className="w-full py-3 rounded-md bg-accent font-medium text-sm disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          {isProcessing ? "Processing…" : "Confirm alignment"}
        </button>
      </div>
    </div>
  );
}
