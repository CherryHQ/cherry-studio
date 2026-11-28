const PIXEL_SIZE_RE = /^\s*(\d+)\s*[xX×*]\s*(\d+)\s*$/

/**
 * Parse and canonicalize a pixel dimension string (`1536×1024`, `1536*1024`,
 * `1536X1024`, optional whitespace) to `${width}x${height}`. Returns `undefined`
 * for non-pixel strings (such as `'auto'` or `'1K'`) and zero/unsafe dimensions.
 */
export function normalizePixelSize(value: string | undefined): `${number}x${number}` | undefined {
  if (!value) return undefined
  const match = PIXEL_SIZE_RE.exec(value)
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return undefined
  }
  return `${width}x${height}`
}

/**
 * Canonicalize pixel dimension strings to `WxH` while preserving non-pixel
 * size values (`'auto'`, `'1K'`, `'2K'`, `'4K'`). Drops blank/whitespace values.
 */
export function normalizeImageSize(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return normalizePixelSize(trimmed) ?? trimmed
}
