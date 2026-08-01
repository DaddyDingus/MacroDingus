import sharp from "sharp";

// Shared by every route that hands a freshly-uploaded photo to Claude for
// vision (nutrition-label scan, plate-photo describe) — normalizes to a
// known, size-capped JPEG buffer before it ever reaches the model, regardless
// of what the client actually sent (HEIC, huge dimensions, wrong EXIF
// rotation). Each call site picks its own maxDimension/quality (a label's
// small print needs more detail than a plate photo does), same tradeoff
// photos.ts's progress-photo pipeline makes independently for its own
// on-disk copies.
export async function toBoundedJpeg(
  raw: Buffer,
  { maxDimension = 2000, quality = 90 }: { maxDimension?: number; quality?: number } = {}
): Promise<Buffer> {
  return sharp(raw)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}
