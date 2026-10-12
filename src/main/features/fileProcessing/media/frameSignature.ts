import { FRAME_SIGNATURE_EDGE } from './frameSelection'

const MAX_SIGNATURE_PIXELS = 8_000_000

/** 16×16 sRGB pixels, or null when the image cannot be decoded. Callers keep undecodable frames. */
export async function readFrameSignature(filePath: string): Promise<Uint8Array | null> {
  try {
    const sharp = (await import('sharp')).default
    const { data, info } = await sharp(filePath, { failOn: 'none', limitInputPixels: MAX_SIGNATURE_PIXELS })
      .resize(FRAME_SIGNATURE_EDGE, FRAME_SIGNATURE_EDGE, { fit: 'fill' })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return normalizeRgb(data, info.channels)
  } catch {
    return null
  }
}

function normalizeRgb(data: Buffer, channels: number): Uint8Array | null {
  const pixelCount = FRAME_SIGNATURE_EDGE * FRAME_SIGNATURE_EDGE
  if (channels === 3 && data.length === pixelCount * 3) return data
  if (channels !== 1 || data.length !== pixelCount) return null
  const rgb = new Uint8Array(pixelCount * 3)
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index]
    rgb[index * 3] = value
    rgb[index * 3 + 1] = value
    rgb[index * 3 + 2] = value
  }
  return rgb
}
