import sharp from 'sharp'

/** Prepare upload copies without changing stored originals or remote image URLs. */
export async function normalizeImageEditInputs(images: readonly string[], signal?: AbortSignal): Promise<string[]> {
  const normalized: string[] = []
  // Process sequentially so several full-resolution photos do not decode at once.
  for (const image of images) {
    signal?.throwIfAborted()
    const match = /^data:[^,]*;base64,/i.exec(image)
    if (!match) {
      normalized.push(image)
      continue
    }

    const bytes = Buffer.from(image.slice(match[0].length), 'base64')
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      normalized.push(image)
      continue
    }

    const pipeline = sharp(bytes)
    const metadata = await pipeline.metadata()
    signal?.throwIfAborted()
    if (!metadata.gainMap) {
      normalized.push(image)
      continue
    }

    // Default sharp output discards the gain map and converts the SDR base to sRGB.
    const output = await pipeline.autoOrient().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer()
    signal?.throwIfAborted()
    normalized.push(`data:image/jpeg;base64,${output.toString('base64')}`)
  }
  return normalized
}
