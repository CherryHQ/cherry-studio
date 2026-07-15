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
  // Only the first frame of an animated GIF is used — fine for a 128² entity image.
  const { default: sharp } = await import('sharp')
  return sharp(bytes, { limitInputPixels: MAX_ENTITY_INPUT_PIXELS })
    .resize(ENTITY_IMAGE_DIMENSION, ENTITY_IMAGE_DIMENSION, { fit: 'cover' })
    .webp()
    .toBuffer()
}
