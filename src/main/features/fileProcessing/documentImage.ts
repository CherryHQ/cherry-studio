import { createHash } from 'node:crypto'

import type { ExtractionOmission, NormalizedDocumentImage } from './types'

const MAX_SOURCE_BYTES = 16_000_000
const INPUT_OPTIONS = { limitInputPixels: 100_000_000, animated: false, pages: 1 }

export async function inspectDocumentImage(bytes: Uint8Array): Promise<{
  sha256?: string
  width?: number
  height?: number
  omission?: ExtractionOmission
}> {
  if (bytes.byteLength > MAX_SOURCE_BYTES) return { omission: 'image-byte-limit' }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const { default: sharp } = await import('sharp')
  try {
    const metadata = await sharp(bytes, INPUT_OPTIONS).metadata()
    if (!['png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'heif'].includes(metadata.format ?? ''))
      return { sha256, omission: 'unsupported-image' }
    const { width, height } = metadata
    if (!width || !height) return { sha256, omission: 'unreadable-image' }
    if (width * height > INPUT_OPTIONS.limitInputPixels) return { sha256, omission: 'image-byte-limit' }
    return { sha256, width, height, ...(Math.min(width, height) < 128 ? { omission: 'too-small' as const } : {}) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return {
      sha256,
      omission: message.includes('pixel limit')
        ? 'image-byte-limit'
        : message.includes('unsupported image format')
          ? 'unsupported-image'
          : 'unreadable-image'
    }
  }
}

export async function normalizeDocumentImage(bytes: Uint8Array): Promise<NormalizedDocumentImage> {
  const inspected = await inspectDocumentImage(bytes)
  if (inspected.omission) return { kind: 'omitted', reason: inspected.omission }
  const { default: sharp } = await import('sharp')
  try {
    const pipeline = sharp(bytes, INPUT_OPTIONS)
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .png()
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of pipeline) {
      size += chunk.length
      if (size > 4_000_000) {
        pipeline.destroy()
        return { kind: 'omitted', reason: 'image-byte-limit' }
      }
      chunks.push(chunk)
    }
    const output = Buffer.concat(chunks)
    const metadata = await sharp(output, INPUT_OPTIONS).metadata()
    return { kind: 'image', bytes: output, mediaType: 'image/png', width: metadata.width, height: metadata.height }
  } catch {
    return { kind: 'omitted', reason: 'unreadable-image' }
  }
}
