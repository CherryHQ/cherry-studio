export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const abs = Math.abs(value)

  if (abs < 1000) {
    return String(Math.round(value))
  }

  const units = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1000, suffix: 'K' }
  ] as const

  const unit = units.find((item) => abs >= item.threshold)
  if (!unit) {
    return String(Math.round(value))
  }

  const scaled = value / unit.threshold
  const fractionDigits = Math.abs(scaled) < 10 ? 1 : 0
  const formatted = scaled.toFixed(fractionDigits).replace(/\.0$/, '')

  return `${formatted}${unit.suffix}`
}
