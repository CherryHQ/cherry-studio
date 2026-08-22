/** Match the submit schema's blank handling and numeric-string coercion. */
function finiteNumber(value: unknown): number | null {
  if (value === '' || value == null) return null

  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(numeric) ? numeric : null
}

/** Checked reads at the dynamic painting-params boundary. */
export function finiteNumberOr(value: unknown, fallback: number): number {
  return finiteNumber(value) ?? fallback
}

export function optionalFiniteNumber(value: unknown): number | null {
  return finiteNumber(value)
}

export function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function controlValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`
  return ''
}
