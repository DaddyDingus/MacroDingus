import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

// Self-hosted (not Google's CDN) — vendored under frontend/public/mediapipe/
// so this feature doesn't depend on an external service being reachable,
// matching the homelab's general self-hosting posture. The wasm/ directory
// is copied verbatim from node_modules/@mediapipe/tasks-vision/wasm (all
// three variants — simd/nosimd/module — since FilesetResolver picks between
// them internally and none were confirmed safe to drop).
const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_ASSET_PATH = "/mediapipe/models/pose_landmarker_lite.task";

// Standard MediaPipe/BlazePose 33-point topology.
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

// Below this, a landmark is "detected" in name only — treat as absent
// rather than trust a low-confidence guess (e.g. a shoulder just out of
// frame or occluded).
const MIN_VISIBILITY = 0.5;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ROTATION_MIN = -45;
const ROTATION_MAX = 45;

export interface BodyMetrics {
  // Natural-pixel space of whichever source image this came from — never
  // mixed across images without going through naturalWidth/naturalHeight
  // first, since two photos are never the same resolution.
  centerPx: { x: number; y: number };
  // Torso-line angle vs. straight down (shoulders directly above hips = 0).
  angleDeg: number;
  torsoLengthPx: number;
}

export interface AlignmentResult {
  rotation: number;
  zoom: number;
  crop: { x: number; y: number };
}

interface NaturalSize {
  naturalWidth: number;
  naturalHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Cached across the whole Photos-screen session — model init (wasm boot +
// weight parse) only needs to happen once, not once per photo aligned.
let landmarkerPromise: Promise<PoseLandmarker> | null = null;

function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
      // CPU delegate, not GPU — this runs once per alignment on a static
      // image, not per video frame, so WASM's extra latency doesn't matter,
      // and it sidesteps any GPU-delegate/WebGL-context quirks on whichever
      // Android/Chrome combination happens to be in use.
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 1,
      });
    })().catch((err) => {
      landmarkerPromise = null; // don't cache a failed init — let a retry try again
      throw err;
    });
  }
  return landmarkerPromise;
}

// Null (not a throw) when no clear pose is found — the caller decides how
// to surface that, and a low-confidence guess must never silently drive a
// bad transform.
async function detectBodyMetrics(image: HTMLImageElement): Promise<BodyMetrics | null> {
  const landmarker = await getLandmarker();
  const result = landmarker.detect(image); // synchronous per its own type signature
  const landmarks = result.landmarks[0];
  if (!landmarks) return null;

  const points = [landmarks[LEFT_SHOULDER], landmarks[RIGHT_SHOULDER], landmarks[LEFT_HIP], landmarks[RIGHT_HIP]];
  if (points.some((p) => !p || p.visibility < MIN_VISIBILITY)) return null;
  const [leftShoulder, rightShoulder, leftHip, rightHip] = points;

  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const shoulderMid = { x: ((leftShoulder.x + rightShoulder.x) / 2) * w, y: ((leftShoulder.y + rightShoulder.y) / 2) * h };
  const hipMid = { x: ((leftHip.x + rightHip.x) / 2) * w, y: ((leftHip.y + rightHip.y) / 2) * h };

  const dx = hipMid.x - shoulderMid.x;
  const dy = hipMid.y - shoulderMid.y;
  const torsoLengthPx = Math.hypot(dx, dy);
  if (torsoLengthPx < 1) return null; // degenerate — avoid a divide-by-zero downstream

  return {
    centerPx: { x: (shoulderMid.x + hipMid.x) / 2, y: (shoulderMid.y + hipMid.y) / 2 },
    angleDeg: (Math.atan2(dx, dy) * 180) / Math.PI,
    torsoLengthPx,
  };
}

// Pure math, no MediaPipe/DOM calls — kept separate from detectBodyMetrics
// so the geometry itself stays easy to reason about (and adjust) on its own.
//
// `media` and `cropSize` are react-easy-crop's own internal computed sizes
// (rendered CSS px), captured via its setMediaSize/setCropSize callback
// props — not otherwise exposed to a parent component. ghostImage is
// already the final saved (cropped) output from a previous alignment, so
// its own natural dimensions directly represent "the crop box's real-world
// scale reference," which is what makes this solvable without needing to
// know anything about how the ghost itself was originally aligned.
export function computeAlignment(
  ghost: BodyMetrics,
  ghostImage: NaturalSize,
  current: BodyMetrics,
  currentImage: NaturalSize,
  media: { width: number; height: number },
  cropSize: { width: number; height: number }
): AlignmentResult {
  // CSS rotate(θ) on a vector (dx,dy) gives (dx·cosθ − dy·sinθ, dx·sinθ +
  // dy·cosθ). Substituting dx=r·sinφ, dy=r·cosφ (which is exactly how
  // angleDeg is defined above — atan2(dx,dy), "0 = straight down") reduces
  // that to a new angle of φ−θ, not φ+θ. So the rotation that carries the
  // current photo's angle to the ghost's angle is θ = current − ghost, the
  // reverse of the first, more "obviously right-looking" guess (ghost −
  // current) — that reversed version is what shipped initially and is
  // almost certainly why the very first Match Pose attempt landed nowhere
  // close: it was rotating the wrong direction.
  const rotationDeg = clamp(current.angleDeg - ghost.angleDeg, ROTATION_MIN, ROTATION_MAX);

  const desiredTorsoFraction = ghost.torsoLengthPx / ghostImage.naturalHeight;
  const renderScale = media.width / currentImage.naturalWidth;
  const zoom = clamp((desiredTorsoFraction * cropSize.height) / (current.torsoLengthPx * renderScale), ZOOM_MIN, ZOOM_MAX);

  // Where the current photo's body-center sits relative to its own
  // geometric center, in on-screen px at the target zoom — this is in the
  // image's local (pre-rotation) frame.
  const localOffsetX = (current.centerPx.x - currentImage.naturalWidth / 2) * renderScale * zoom;
  const localOffsetY = (current.centerPx.y - currentImage.naturalHeight / 2) * renderScale * zoom;

  // Where that body-center needs to land relative to the crop box's own
  // center, matching the ghost's body-center's relative position within
  // its own (already-cropped) frame.
  const targetOffsetX = (ghost.centerPx.x / ghostImage.naturalWidth - 0.5) * cropSize.width;
  const targetOffsetY = (ghost.centerPx.y / ghostImage.naturalHeight - 0.5) * cropSize.height;

  // react-easy-crop's own transform order is translate -> rotate -> scale
  // (applied to the image's local content in that order, around its own
  // center) — so the local offset has to be rotated by rotationDeg before
  // solving for the translate (crop.x/y) that lands it at the target.
  const rad = (rotationDeg * Math.PI) / 180;
  const rotatedOffsetX = localOffsetX * Math.cos(rad) - localOffsetY * Math.sin(rad);
  const rotatedOffsetY = localOffsetX * Math.sin(rad) + localOffsetY * Math.cos(rad);

  return {
    rotation: rotationDeg,
    zoom,
    crop: { x: targetOffsetX - rotatedOffsetX, y: targetOffsetY - rotatedOffsetY },
  };
}

export interface MatchPoseInput {
  currentImage: HTMLImageElement;
  ghostImage: HTMLImageElement;
  media: { width: number; height: number };
  cropSize: { width: number; height: number };
}

// Throws (rather than returning null) on "couldn't find a clear pose" —
// the caller already has an established inline-error pattern for a failed
// alignment attempt, matching cropImageToBlob's own error convention in
// PhotoAlignerModal.tsx.
export async function matchPose(input: MatchPoseInput): Promise<AlignmentResult> {
  const [current, ghost] = await Promise.all([detectBodyMetrics(input.currentImage), detectBodyMetrics(input.ghostImage)]);
  if (!current || !ghost) {
    throw new Error("Couldn't find a clear pose in one of these photos — try aligning manually");
  }
  return computeAlignment(ghost, input.ghostImage, current, input.currentImage, input.media, input.cropSize);
}
