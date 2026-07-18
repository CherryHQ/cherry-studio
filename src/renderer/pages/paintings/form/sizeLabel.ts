/**
 * Pure size parsing/formatting helpers, kept free of any UI or React so the
 * hooks and pure logic that derive size labels (`paintingSize.ts`,
 * `usePaintingSizeInfo`) can consume them without an upward dependency on the
 * `SizeChipsField` component, which now references these downward too.
 */

export type Dim = { w: number; h: number }

export function parseRatio(value: string): Dim | null {
  const dims = value.match(/^(\d+)[x×](\d+)$/)
  if (dims) return { w: Number(dims[1]), h: Number(dims[2]) }

  const aspect = value.match(/^(?:ASPECT_)?(\d+)[_:](\d+)$/i)
  if (aspect) return { w: Number(aspect[1]), h: Number(aspect[2]) }

  return null
}

function parseDims(s: string): Dim | null {
  const m = s.match(/^(\d+)\s*[x×]\s*(\d+)$/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

function formatDims({ w, h }: Dim): string {
  return `${w}×${h}`
}

function splitParens(label: string): { head: string; inner: string } {
  const m = label.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/)
  return m ? { head: m[1].trim(), inner: m[2].trim() } : { head: label.trim(), inner: '' }
}

/**
 * Choose a single concise label for a chip. The visual `RatioThumb`
 * already conveys the shape, so chips never need both ratio AND pixel
 * dims at once. Selection logic:
 *
 *  - Pure aspect-ratio enum (`ASPECT_X_Y` from `supports.aspectRatio`,
 *    or bare `X:Y` / `X_Y`) → `X:Y`. Prevents the raw enum from
 *    leaking into the UI ("ASPECT_1_1") and keeps the chip width
 *    bounded so the grid follows the parent container.
 *  - Label with parenthesized pixel dims like `"1:1 (1024×1024)"` →
 *    use the head (`"1:1"`).
 *  - Pixel-size value `WxH` → `W×H` (formatted with U+00D7).
 *  - Anything else (`"auto"` → `"自动"`, `"1K"`, etc.) → the label
 *    verbatim.
 */
export function deriveChipLabel(label: string, value: string): string {
  const aspectMatch = value.match(/^(?:ASPECT_)?(\d+)[_:](\d+)$/i)
  if (aspectMatch) {
    return `${Number(aspectMatch[1])}:${Number(aspectMatch[2])}`
  }

  const { head, inner } = splitParens(label)
  if (parseDims(inner)) {
    return head
  }

  const dims = parseDims(value)
  if (dims) {
    return formatDims(dims)
  }

  return label
}
