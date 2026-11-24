export const SEEDREAM_5X_TARGET_IDS: ReadonlySet<string> = new Set(['doubao-seedream-5-5'])

export function isSeedream5xTargetModel(modelId: string): boolean {
  return SEEDREAM_5X_TARGET_IDS.has(modelId)
}

export type SeedreamParamIssue = 'size' | 'background-format'

const present = (value: unknown) => value !== undefined && value !== null && value !== ''

function dimensions(width: unknown, height: unknown): boolean {
  const w = typeof width === 'string' && /^\d+$/.test(width) ? Number(width) : width
  const h = typeof height === 'string' && /^\d+$/.test(height) ? Number(height) : height
  return (
    typeof w === 'number' &&
    typeof h === 'number' &&
    Number.isSafeInteger(w) &&
    Number.isSafeInteger(h) &&
    w > 0 &&
    h > 0 &&
    w * h >= 921600 &&
    w * h <= 4624220 &&
    w <= 16 * h &&
    h <= 16 * w
  )
}

export function validateSeedreamImageParams(params: Readonly<Record<string, unknown>>): SeedreamParamIssue | undefined {
  const { imageResolution, size, customSize_width: width, customSize_height: height } = params
  const hasCompanions = present(width) || present(height)
  const hasSize = present(size) && size !== 'custom'
  const hasTier = present(imageResolution) && imageResolution !== 'custom'
  if ((hasTier && (hasSize || hasCompanions)) || (hasSize && hasCompanions)) return 'size'
  if (hasTier && !['1K', '1.5K', '2K'].includes(imageResolution as string)) return 'size'
  if (hasCompanions || imageResolution === 'custom' || size === 'custom') {
    if (!dimensions(width, height)) return 'size'
  } else if (hasSize) {
    const match = typeof size === 'string' ? /^(\d+)x(\d+)$/.exec(size) : null
    if (!match || !dimensions(match[1], match[2])) return 'size'
  }
  if (params.background === 'transparent' && params.outputFormat !== 'png') {
    return 'background-format'
  }
  return undefined
}

export function sanitizeSeedreamImageParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...params }
  for (const key of ['numImages', 'sequentialImageGeneration', 'maxImages', 'webSearch', 'stream', 'tools'])
    delete result[key]
  if (validateSeedreamImageParams(result) === 'size') return result
  const { customSize_width: width, customSize_height: height } = result
  if (dimensions(width, height)) {
    result.size = `${width}x${height}`
    delete result.imageResolution
  } else if (present(result.size) && result.size !== 'custom') {
    delete result.imageResolution
  } else {
    delete result.size
    if (!present(result.imageResolution) || result.imageResolution === 'custom') result.imageResolution = '1K'
  }
  delete result.customSize_width
  delete result.customSize_height
  if (!present(result.outputFormat)) result.outputFormat = 'jpeg'
  if (!present(result.background)) result.background = 'auto'
  if (!present(result.addWatermark)) result.addWatermark = true
  return result
}
