/**
 * Normalize arbitrary image bytes to a small, uniform avatar/logo image.
 *
 * Everything (PNG / JPEG / animated-GIF first frame / SVG / WebP) is rasterized
 * to a **static 128×128 WebP** via `sharp`, square-cropped (`fit: 'cover'`). At
 * this size the output lands well under 4 KB, so avatar / provider / mini-app
 * logos can be stored on disk as tiny files instead of base64 in the DB.
 */

/** Output dimension (square px). Avatars/logos render at ≤80px; 128 stays crisp on HiDPI. */
const TARGET_DIMENSION = 128

/** WebP quality — at 128×128 this lands well under 4 KB. */
// ponytail: fixed quality; add a quality-stepdown loop only if 4 KB is regularly exceeded.
const WEBP_QUALITY = 80

export async function normalizeToWebp(bytes: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  const out = await sharp(Buffer.from(bytes), { animated: false })
    .resize(TARGET_DIMENSION, TARGET_DIMENSION, { fit: 'cover', position: 'center' })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()
  return new Uint8Array(out)
}
