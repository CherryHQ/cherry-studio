import { normalizeImageParamNumber, parseImageParamValue } from '@cherrystudio/provider-registry'

/** Match the submit schema's strict numeric-input normalization. */
function finiteNumber(value: unknown): number | null {
  const numeric = normalizeImageParamNumber(value)
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null
}

/** Checked reads at the dynamic painting-params boundary. */
export function finiteNumberOr(value: unknown, fallback: number): number {
  return finiteNumber(value) ?? fallback
}

export function optionalFiniteNumber(value: unknown): number | null {
  return finiteNumber(value)
}

export function finiteParamNumberOr(key: string, value: unknown, fallback: number): number {
  const parsed = parseImageParamValue(key, value)
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

export function optionalParamNumber(key: string, value: unknown): number | null {
  const parsed = parseImageParamValue(key, value)
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

export function catalogValueOr(key: string, value: unknown, fallback: unknown): unknown {
  return parseImageParamValue(key, value) ?? fallback
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
