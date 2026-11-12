import type { TranslationTextMetrics } from './fitTranslationText'

export function measureTranslationText(
  context: CanvasRenderingContext2D,
  text: string,
  size: number
): TranslationTextMetrics {
  const m = context.measureText(text)
  return {
    width: m.width,
    left: Math.max(0, m.actualBoundingBoxLeft),
    right: m.actualBoundingBoxRight,
    ascent: Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : 0.8 * size,
    descent: Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : 0.2 * size
  }
}
