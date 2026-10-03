export const DEFAULT_IMAGE_SCALE = 1
export const MIN_IMAGE_SCALE = 0.25
export const MAX_IMAGE_SCALE = 4
export const IMAGE_SCALE_STEP = 0.25

/**
 * Next artboard image scale for a wheel delta. Wheel up (negative deltaY) zooms
 * in; wheel down zooms out. Clamped to the same 0.25x–4x range as the toolbar.
 */
export function nextImageScaleFromWheel(
  currentScale: number,
  deltaY: number,
  step: number = IMAGE_SCALE_STEP,
  min: number = MIN_IMAGE_SCALE,
  max: number = MAX_IMAGE_SCALE
): number {
  if (deltaY === 0 || !Number.isFinite(deltaY) || !Number.isFinite(currentScale)) {
    return Math.min(max, Math.max(min, currentScale))
  }
  const direction = deltaY < 0 ? 1 : -1
  const next = currentScale + direction * step
  return Math.min(max, Math.max(min, next))
}
