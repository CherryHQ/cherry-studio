import { loggerService } from '@logger'
import { getImageBlobFromSource } from '@renderer/components/ImageViewer'
import { encode } from 'blurhash'

const logger = loggerService.withContext('paintings/computeImageBlurhash')

const MAX_BLURHASH_IMAGE_SIZE = 32
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
