import { createPaintingGenerateError } from '../paintingGenerateError'

/**
 * Resolve Zhipu CogView's `imageSize` from a painting state, enforcing the
 * four custom-size rules vendor docs spell out:
 *
 *  1. `mode === 'custom'` requires both `customWidth` and `customHeight`
 *  2. Each dimension ∈ [512, 2048]
 *  3. Each dimension divisible by 16
 *  4. Total pixels ≤ 2,097,152 (2 megapixels)
 *
 * Returned string feeds straight into `aiSdkParams.imageSize`. Non-`custom`
 * sizes pass through unchanged (with a 1024×1024 fallback for missing
 * values). Throws `createPaintingGenerateError(...)` for rule violations so
 * the painting toast layer can localize the message.
 */
export function resolveCogviewSize(painting: {
  imageSize?: string
  customWidth?: number
  customHeight?: number
}): string {
  if (painting.imageSize !== 'custom') return painting.imageSize ?? '1024x1024'
  const { customWidth, customHeight } = painting
  if (!customWidth || !customHeight) throw createPaintingGenerateError('CUSTOM_SIZE_REQUIRED')
  if (customWidth < 512 || customWidth > 2048 || customHeight < 512 || customHeight > 2048) {
    throw createPaintingGenerateError('CUSTOM_SIZE_RANGE')
  }
  if (customWidth % 16 !== 0 || customHeight % 16 !== 0) {
    throw createPaintingGenerateError('CUSTOM_SIZE_DIVISIBLE')
  }
  if (customWidth * customHeight > 2_097_152) throw createPaintingGenerateError('CUSTOM_SIZE_PIXELS')
  return `${customWidth}x${customHeight}`
}
