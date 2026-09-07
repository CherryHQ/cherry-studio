/** HTML number/range steps are min-relative; `min + n * step` drifts in IEEE remainder. */
function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0
  const text = String(value)
  const exponential = text.toLowerCase().indexOf('e')
  if (exponential !== -1) {
    const exponent = Number(text.slice(exponential + 1))
    const mantissa = text.slice(0, exponential)
    const mantissaDecimals = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0
    return Math.max(0, mantissaDecimals - exponent)
  }
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

function roundToDecimalPlaces(value: number, precision: number): number {
  return precision <= 100 ? Number(value.toFixed(precision)) : value
}

/** Clamp `value` to `[min, max]`, then snap onto `min + n * step` without overshooting `max`. */
export function alignRangeValue(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value))
  if (!(step > 0) || min === max) return clamped
  const precision = Math.max(decimalPlaces(min), decimalPlaces(step))
  const rawStepsFromMin = (clamped - min) / step
  const nearestHalfStep = Math.round(rawStepsFromMin * 2) / 2
  const halfStepTolerance = Number.EPSILON * Math.max(1, Math.abs(rawStepsFromMin)) * 4
  const stepsFromMin = Math.round(
    Math.abs(rawStepsFromMin - nearestHalfStep) <= halfStepTolerance ? nearestHalfStep : rawStepsFromMin
  )
  let aligned = roundToDecimalPlaces(min + stepsFromMin * step, precision)
  if (aligned > max) {
    aligned = roundToDecimalPlaces(min + (stepsFromMin - 1) * step, precision)
  }
  if (aligned < min) return min
  if (aligned > max) return max
  return aligned
}
