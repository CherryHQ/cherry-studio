import { fileTypeFromBuffer } from 'file-type'
import type {
  MainModule,
  heif_image as HeifImage,
  heif_image_handle as HeifImageHandle
} from 'libheif-js/libheif-wasm/libheif.js'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

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
export async function clampImageForModel(bytes: Uint8Array): Promise<Uint8Array | null> {
  const sharp = (await import('sharp')).default
  const image = sharp(bytes, { failOn: 'none' })
  const { width, height } = await image.metadata()
  if (!width || !height) throw new Error('could not read image dimensions')
  if (width <= MODEL_IMAGE_MAX_EDGE && height <= MODEL_IMAGE_MAX_EDGE) return null
  return image
    .resize(MODEL_IMAGE_MAX_EDGE, MODEL_IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .toBuffer()
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

export interface HeifPng {
  content: Uint8Array
  mediaType: 'image/png'
  width: number
  height: number
}

export const HEIF_MAX_BYTES = 64 * 1024 * 1024

export function validateHeifDimensions(width: number, height: number): void {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 16384)) {
    throw new IpcError(fileErrorCodes.HEIF_TOO_LARGE, 'HEIF dimensions exceed the limit', { limit: 'dimensions' })
  }
  if (width * height > 50_000_000) {
    throw new IpcError(fileErrorCodes.HEIF_TOO_LARGE, 'HEIF pixel count exceeds the limit', { limit: 'pixels' })
  }
}

/** Decode only the primary image; libheif's display decode applies container transforms. */
export async function transcodeHeifToPng(content: Uint8Array, signal?: AbortSignal): Promise<HeifPng> {
  signal?.throwIfAborted()
  if (content.byteLength > HEIF_MAX_BYTES) {
    throw new IpcError(fileErrorCodes.HEIF_TOO_LARGE, 'HEIF input exceeds the limit', { limit: 'input_bytes' })
  }
  const type = await fileTypeFromBuffer(content).catch(() => undefined)
  if (!type || !['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].includes(type.mime)) {
    throw new IpcError(fileErrorCodes.HEIF_INVALID)
  }
  let heif: MainModule
  try {
    const { default: factory } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs')
    heif = await factory()
  } catch {
    throw new IpcError(fileErrorCodes.HEIF_UNAVAILABLE)
  }
  const context = heif.heif_context_alloc()
  let handle: HeifImageHandle | undefined
  let image: HeifImage | undefined
  try {
    signal?.throwIfAborted()
    if (heif.heif_context_read_from_memory(context, content).code.value !== 0) {
      throw new IpcError(fileErrorCodes.HEIF_INVALID)
    }
    const primary = heif.heif_context_get_primary_image_handle(context)
    if (
      primary?.code &&
      primary.subcode?.value !== heif.heif_suberror_code.heif_suberror_No_or_invalid_primary_item.value
    ) {
      throw new IpcError(fileErrorCodes.HEIF_INVALID)
    }
    handle = primary
    if (!handle || 'code' in handle) {
      const ids = heif.heif_context_get_list_of_top_level_image_IDs(context)
      handle = ids?.length ? heif.heif_context_get_image_handle(context, ids[0]) : undefined
    }
    if (!handle || 'code' in handle) throw new IpcError(fileErrorCodes.HEIF_INVALID)
    validateHeifDimensions(heif.heif_image_handle_get_width(handle), heif.heif_image_handle_get_height(handle))
    const decoded = heif.heif_js_decode_image2(
      handle,
      heif.heif_colorspace.heif_colorspace_RGB,
      heif.heif_chroma.heif_chroma_interleaved_RGBA
    )
    image = decoded?.image
    signal?.throwIfAborted()
    if (!image || decoded.code) throw new IpcError(fileErrorCodes.HEIF_INVALID)
    const channel = decoded.channels.find((c: { id: unknown }) => c.id === heif.heif_channel.heif_channel_interleaved)
    if (!channel) throw new IpcError(fileErrorCodes.HEIF_INVALID)
    const { width, height, stride } = channel
    validateHeifDimensions(width, height)
    if (stride < width * 4 || channel.data.byteLength < stride * height) throw new IpcError(fileErrorCodes.HEIF_INVALID)
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) rgba.set(channel.data.subarray(y * stride, y * stride + width * 4), y * width * 4)
    const sharp = (await import('sharp')).default
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
    signal?.throwIfAborted()
    if (png.byteLength > HEIF_MAX_BYTES) {
      throw new IpcError(fileErrorCodes.HEIF_TOO_LARGE, 'HEIF output exceeds the limit', { limit: 'output_bytes' })
    }
    return { content: png, mediaType: 'image/png', width, height }
  } catch (error) {
    if (signal?.aborted || error instanceof IpcError) throw error
    throw new IpcError(fileErrorCodes.HEIF_INVALID)
  } finally {
    if (image) heif.heif_image_release(image)
    if (handle && !('code' in handle)) heif.heif_image_handle_release(handle)
    heif.heif_context_free(context)
  }
}
