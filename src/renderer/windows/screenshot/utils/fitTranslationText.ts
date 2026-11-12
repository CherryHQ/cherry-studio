import type { PhysicalBox } from '../types'

export interface TranslationTextMetrics {
  width: number
  left: number
  right: number
  ascent: number
  descent: number
}

export function fitTranslationText(
  text: string,
  box: PhysicalBox,
  scaleFactor: number,
  measure: (text: string, fontSizePx: number) => TranslationTextMetrics
): { fontSizePx: number; baselineX: number; baselineY: number } | null {
  const line = text.replace(/\s+/gu, ' ').trim()
  const floor = 6 * scaleFactor
  const initial = 0.85 * box.height
  if (!line || !Number.isFinite(floor) || floor <= 0 || !Number.isFinite(initial) || initial < floor || box.width <= 0)
    return null
  const fit = (size: number) => {
    const m = measure(line, size)
    const left = Math.max(0, m.left)
    const right = Math.max(m.width, m.right)
    if (
      ![left, right, m.ascent, m.descent].every(Number.isFinite) ||
      m.ascent < 0 ||
      m.descent < 0 ||
      left + right > box.width ||
      m.ascent + m.descent > box.height
    )
      return null
    return { fontSizePx: size, baselineX: box.x + left, baselineY: box.y + m.ascent }
  }
  const atInitial = fit(initial)
  if (atInitial) return atInitial
  let best = fit(floor)
  if (!best) return null
  let low = floor
  let high = initial
  while (high - low > 0.25) {
    const mid = (low + high) / 2
    const candidate = fit(mid)
    if (candidate) {
      low = mid
      best = candidate
    } else high = mid
  }
  return fit(best.fontSizePx)
}
