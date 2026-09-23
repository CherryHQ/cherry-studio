import type { ParamValues } from '@cherrystudio/provider-registry'
import type { ImageGenerationMode, ImageGenerationSupport } from '@shared/data/types/model'

import { ImageConfigError } from './ImageConfigError'

export function normalizeImageRatio(value: string): string {
  return value.replace(/^ASPECT_/, '').replace(/^(\d+)_(\d+)$/, '$1:$2')
}

export function calculateImageSize(
  ratio: string,
  rule: { longEdge: number; maxPixels?: number; multiple?: number }
): string {
  const parts = normalizeImageRatio(ratio).split(':').map(Number)
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0))
    throw new ImageConfigError('invalid_ratio', 'Invalid aspect ratio')
  const r = Math.max(...parts) / Math.min(...parts)
  const edge = Math.min(rule.longEdge, rule.maxPixels ? Math.sqrt(rule.maxPixels * r) : Infinity)
  const multiple = rule.multiple ?? 16
  const long = Math.floor(edge / multiple) * multiple
  const short = Math.floor(edge / r / multiple) * multiple
  if (short <= 0 || !Number.isSafeInteger(long))
    throw new ImageConfigError('invalid_dimensions', 'Invalid image dimensions')
  return parts[0] >= parts[1] ? `${long}x${short}` : `${short}x${long}`
}

export function resolveImageCanvasParams(
  support: ImageGenerationSupport | null | undefined,
  mode: ImageGenerationMode,
  params: ParamValues
): ParamValues {
  const definition = support?.modes[mode]
  const canvases = definition?.canvases
  if (!definition || (!canvases?.length && !definition.sizeRules)) return params
  const next = { ...params }
  if (params.outputFormat === 'png' || params.outputFormat === undefined) delete next.outputCompression
  if (params.background === 'transparent' && params.outputFormat === 'jpeg')
    throw new ImageConfigError('transparent_format', 'Transparent backgrounds require PNG or WebP')
  if (params.size !== undefined) {
    if (params.imageResolution !== undefined || params.aspectRatio !== undefined)
      throw new ImageConfigError('conflicting_size', 'Choose size or resolution/aspect ratio, not both')
    if (
      params.size !== 'auto' &&
      (!/^[1-9]\d*x[1-9]\d*$/.test(params.size) ||
        (!definition.userConfigured && !canvases?.some((c) => c.size === params.size)))
    )
      throw new ImageConfigError('unsupported_size', 'Unsupported image size')
    return next
  }
  const resolutionSpec = definition.supports.imageResolution
  const ratioSpec = definition.supports.aspectRatio
  const resolution = params.imageResolution ?? (resolutionSpec?.type === 'enum' ? resolutionSpec.default : undefined)
  const ratio = params.aspectRatio ?? (ratioSpec?.type === 'enum' ? ratioSpec.default : undefined)
  if (resolution === 'auto' || ratio === 'auto') {
    next.size = 'auto'
  } else {
    const rule = resolution ? definition.sizeRules?.[resolution] : undefined
    const canvas = canvases?.find((c) => c.resolution === resolution && c.aspectRatio === ratio)
    const custom = definition.customCanvases?.find((c) => c.resolution === resolution && c.aspectRatio === ratio)
    if (custom) next.size = custom.size
    else if (rule && ratio) next.size = calculateImageSize(ratio, rule)
    else if (canvas) next.size = canvas.size
    else if (!definition.userConfigured && params.aspectRatio === undefined)
      next.size = canvases?.find((c) => c.resolution === resolution)?.size
    if (!next.size)
      throw new ImageConfigError(
        'missing_dimensions',
        'Configure pixel dimensions or a longest-edge rule for this resolution and ratio'
      )
  }
  delete next.imageResolution
  delete next.aspectRatio
  return next
}

export function imageSizeSelection(
  support: ImageGenerationSupport | null | undefined,
  mode: ImageGenerationMode,
  params: ParamValues
) {
  const definition = support?.modes[mode]
  const fallback = (key: 'imageResolution' | 'resolution' | 'aspectRatio') => {
    const spec = definition?.supports[key]
    return spec && 'default' in spec ? String(spec.default ?? '') : ''
  }
  const tier = params.imageResolution ?? params.resolution ?? (fallback('imageResolution') || fallback('resolution'))
  const ratio = normalizeImageRatio(params.aspectRatio ?? fallback('aspectRatio'))
  let pixels: string | undefined
  try {
    if (definition?.canvases?.length || definition?.sizeRules)
      pixels = resolveImageCanvasParams(support, mode, params).size
    else
      pixels =
        params.size ??
        definition?.expectedSizes?.find((c) => c.resolution === tier && normalizeImageRatio(c.aspectRatio) === ratio)
          ?.size
  } catch {
    /* An incomplete custom mapping has no precise preview. */
  }
  return { tier, ratio, pixels: pixels === 'auto' ? undefined : pixels }
}
