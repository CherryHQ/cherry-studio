import { fileTypeFromBuffer } from 'file-type'

/** Target square dimension for normalized entity images (avatar / logo). */
const ENTITY_IMAGE_DIMENSION = 128
/** Decode-work bound: a small file can still declare huge dimensions (bomb). */
const MAX_ENTITY_INPUT_PIXELS = 100_000_000

/**
 * Normalize arbitrary image bytes to a 128×128 cover-cropped WebP buffer — the
 * canonical on-disk form for entity images (user avatar, provider / mini-app
 * logo). Shared by the live set-image IpcApi commands and the v1→v2 migration so
 * both paths produce an identical format. Throws on undecodable input (caller
 * decides how to react).
 */
export async function transcodeToEntityWebp(bytes: Uint8Array): Promise<Buffer> {
  // Delayed loading: a static import would map sharp's multi-MB libvips native library at boot.
  const sharp = (await import('sharp')).default
  // Only the first frame of an animated GIF is used — fine for a 128² entity image.
  // `failOn: 'none'` keeps slightly-malformed user images (truncated chunk, bad CRC) decodable;
  // sharp's default rejects them on a libvips warning, which varies by platform.
  return sharp(bytes, { limitInputPixels: MAX_ENTITY_INPUT_PIXELS, failOn: 'none' })
    .resize(ENTITY_IMAGE_DIMENSION, ENTITY_IMAGE_DIMENSION, { fit: 'cover' })
    .webp()
    .toBuffer()
}

/**
 * Re-encode image bytes to PNG, passing them through untouched when they already are one — for
 * consumers that only decode PNG. Throws on input sharp cannot decode (BMP, or non-image bytes).
 */
export async function transcodeToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if ((await fileTypeFromBuffer(bytes))?.mime === 'image/png') {
    return bytes
  }

  const sharp = (await import('sharp')).default
  return sharp(bytes).png().toBuffer()
}

/**
 * Crop a region out of PNG bytes, in the source image's own pixel space.
 * Used to hand the OCR engine just the selected region instead of a full display.
 * Rejects a region reaching past the image rather than silently shrinking it, so a
 * caller's coordinate bug surfaces instead of producing a quietly wrong crop.
 */
export async function cropPng(
  bytes: Uint8Array,
  region: { x: number; y: number; width: number; height: number }
): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  return sharp(bytes)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .png()
    .toBuffer()
}
