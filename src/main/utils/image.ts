import { fileTypeFromBuffer } from 'file-type'

/** Target square dimension for normalized entity images (avatar / logo). */
const ENTITY_IMAGE_DIMENSION = 128

/**
 * Whether the bytes decode as a raster image providers accept. Uses strict libvips
 * decode (not header-only checks): truncated PNGs can expose a plausible IHDR yet
 * fail on IDAT. Entity transcoding keeps `failOn: 'none'` for slightly malformed
 * user uploads; model-bound paths must not pass undecodable bytes upstream.
 */
export async function isDecodableImage(bytes: Uint8Array): Promise<boolean> {
  if (bytes.byteLength === 0) return false
  try {
    const sharp = (await import('sharp')).default
    await sharp(bytes).stats()
    return true
  } catch {
    return false
  }
}
/** Decode-work bound: a small file can still declare huge dimensions (bomb). */
const MAX_ENTITY_INPUT_PIXELS = 100_000_000
/** Longest edge for model-bound images. Every vision provider downscales below this on its own
 *  (Anthropic 1568, DeepSeek ~1300-equivalent), but an 8192+ edge is a hard provider reject.
 *  ponytail: one constant for all providers; make it a `Model` field if one ever needs more. */
const MODEL_IMAGE_MAX_EDGE = 2000

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
 * Shrink an image so neither edge exceeds the model-bound cap, preserving its format. Reads
 * dimensions from the header; in-bounds input is verified with a single decode pass and not
 * re-encoded. Oversized input is resized in one pipeline (decode included).
 * @returns resized bytes, or `null` when the image already fits. Throws on undecodable input.
 */
export async function clampImageForModel(bytes: Uint8Array): Promise<Uint8Array | null> {
  const sharp = (await import('sharp')).default
  const image = sharp(bytes, { failOn: 'none' })
  const { width, height } = await image.metadata()
  if (!width || !height) throw new Error('could not read image dimensions')
  if (width <= MODEL_IMAGE_MAX_EDGE && height <= MODEL_IMAGE_MAX_EDGE) {
    try {
      await image.stats()
    } catch {
      throw new Error('could not decode image')
    }
    return null
  }
  try {
    return await image
      .resize(MODEL_IMAGE_MAX_EDGE, MODEL_IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .toBuffer()
  } catch {
    throw new Error('could not decode image')
  }
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
