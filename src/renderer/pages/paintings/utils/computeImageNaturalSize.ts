import { loggerService } from '@logger'
import { getImageBlobFromSource } from '@renderer/utils/image'

const logger = loggerService.withContext('paintings/computeImageNaturalSize')

export interface ImageNaturalSize {
  naturalWidth: number
  naturalHeight: number
}

/**
 * Decode the generated image's intrinsic pixel size via `createImageBitmap`, so the
 * reveal skeleton can relock its box to the exact size the real `<img>` will render
 * at instead of the declared-ratio estimate (avoiding a size jump on reveal). Returns
 * null (logged) when the source can't be decoded — the artboard then skips the animated
 * reveal and shows the finished image directly.
 */
export async function computeImageNaturalSize(src: string): Promise<ImageNaturalSize | null> {
  let bitmap: ImageBitmap | null = null

  try {
    const blob = await getImageBlobFromSource(src)
    bitmap = await createImageBitmap(blob)
    return { naturalWidth: bitmap.width, naturalHeight: bitmap.height }
  } catch (error) {
    logger.warn('Failed to compute natural size for painting image', { error })
    return null
  } finally {
    bitmap?.close()
  }
}
