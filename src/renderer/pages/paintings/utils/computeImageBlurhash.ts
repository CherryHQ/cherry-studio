import { loggerService } from '@logger'
import { getImageBlobFromSource } from '@renderer/components/ImageViewer'
import { encode } from 'blurhash'

const logger = loggerService.withContext('paintings/computeImageBlurhash')

// Downscale cap (px, longest edge) before encoding. Blurhash averages colour over
// a handful of components, so a tiny thumbnail carries all the signal it needs —
// anything larger just spends more time in drawImage/getImageData for no gain.
const MAX_BLURHASH_IMAGE_SIZE = 32
// Blurhash detail: 4 horizontal × 3 vertical DCT components — enough to hint the
// image's colour regions for the skeleton tint without resolving fine structure.
const BLURHASH_COMPONENT_X = 4
const BLURHASH_COMPONENT_Y = 3

export interface ImageBlurhashResult {
  blurhash: string
  naturalWidth: number
  naturalHeight: number
}

export async function computeImageBlurhash(src: string): Promise<ImageBlurhashResult | null> {
  let bitmap: ImageBitmap | null = null

  try {
    const blob = await getImageBlobFromSource(src)
    bitmap = await createImageBitmap(blob)

    const scale = Math.min(1, MAX_BLURHASH_IMAGE_SIZE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      logger.warn('Failed to acquire 2d canvas context for painting blurhash')
      return null
    }

    context.drawImage(bitmap, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)
    const blurhash = encode(imageData.data, width, height, BLURHASH_COMPONENT_X, BLURHASH_COMPONENT_Y)
    return { blurhash, naturalWidth: bitmap.width, naturalHeight: bitmap.height }
  } catch (error) {
    logger.warn('Failed to compute blurhash for painting image', { error })
    return null
  } finally {
    bitmap?.close()
  }
}
