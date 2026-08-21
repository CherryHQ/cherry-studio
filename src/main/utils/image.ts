import sharp from 'sharp'

/** Target square dimension for normalized icon images (avatar / logo). */
const ICON_IMAGE_DIMENSION = 128
/** Decode-work bound: a small file can still declare huge dimensions (bomb). */
const MAX_ICON_INPUT_PIXELS = 100_000_000

/**
 * Normalize arbitrary image bytes to a 128×128 cover-cropped WebP buffer — the
 * canonical on-disk form for icon images (user avatar, provider / mini-app
 * logo). Shared by the live set-image IpcApi commands and the v1→v2 migration so
 * both paths produce an identical format. Throws on undecodable input (caller
 * decides how to react).
 */
export async function transcodeToIconWebp(bytes: Uint8Array): Promise<Buffer> {
  // Only the first frame of an animated GIF is used — fine for a 128² icon image.
  return sharp(bytes, { limitInputPixels: MAX_ICON_INPUT_PIXELS })
    .resize(ICON_IMAGE_DIMENSION, ICON_IMAGE_DIMENSION, { fit: 'cover' })
    .webp()
    .toBuffer()
}
