import UPNG from '@pdf-lib/upng'
import { fileTypeFromBuffer } from 'file-type'

/** Target square dimension for normalized entity images (avatar / logo). */
const ENTITY_IMAGE_DIMENSION = 128
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
 * Shrink an image so neither edge exceeds the model-bound cap, preserving its format. Only the
 * header is read to decide, so in-bounds input is never decoded or re-encoded.
 * @returns resized bytes, or `null` when the image already fits. Throws on undecodable input.
 */
export async function clampImageForModel(
  bytes: Uint8Array,
  maxEdge: number = MODEL_IMAGE_MAX_EDGE
): Promise<Uint8Array | null> {
  const sharp = (await import('sharp')).default
  const probe = sharp(bytes, { failOn: 'none' })
  const { width, height } = await probe.metadata()
  if (!width || !height) throw new Error('could not read image dimensions')
  if (width <= maxEdge && height <= maxEdge) return null
  if (isApng(bytes)) return clampApng(bytes, width, height, maxEdge)
  return sharp(bytes, { failOn: 'none', animated: true })
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .toBuffer()
}

function isApng(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    )
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    offset += length + 12
  }
  return false
}

async function clampApng(bytes: Uint8Array, width: number, height: number, maxEdge: number): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const decoded = UPNG.decode(source)
  const frames = UPNG.toRGBA8(decoded)
  const scale = maxEdge / Math.max(width, height)
  const resizedWidth = Math.max(1, Math.round(width * scale))
  const resizedHeight = Math.max(1, Math.round(height * scale))
  const resized = await Promise.all(
    frames.map(async (frame) => {
      const output = await sharp(Buffer.from(frame), { raw: { width, height, channels: 4 } })
        .resize(resizedWidth, resizedHeight)
        .raw()
        .toBuffer()
      return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength)
    })
  )
  const encode: (
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
    tabs?: { loop?: number }
  ) => ArrayBuffer = UPNG.encode
  return Buffer.from(
    encode(
      resized,
      resizedWidth,
      resizedHeight,
      0,
      decoded.frames.map((frame) => frame.delay),
      {
        loop: decoded.tabs.acTL?.num_plays ?? 0
      }
    )
  )
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
