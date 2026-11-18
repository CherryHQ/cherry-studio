import {
  type CanonicalParamKey,
  normalizeImageParamNumber,
  type ParamValue,
  parseImageParamValue
} from '@cherrystudio/provider-registry'

/** Match the submit schema's strict numeric-input normalization. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Dynamic painting draft dimensions are unvalidated until this reader normalizes numeric strings and rejects non-finite values.
function finiteNumber(value: unknown): number | null {
  const numeric = normalizeImageParamNumber(value)
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Dynamic painting draft dimensions are unvalidated until this reader normalizes numeric strings and rejects non-finite values.
export function optionalFiniteNumber(value: unknown): number | null {
  return finiteNumber(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Painting draft values are dynamic registry fields; this reader validates the key and value with parseImageParamValue before exposing a number.
export function finiteParamNumberOr(key: string, value: unknown, fallback: number): number {
  const parsed = parseImageParamValue(key, value)
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Painting draft values are dynamic registry fields; this reader validates the key and value with parseImageParamValue before exposing a number.
export function optionalParamNumber(key: string, value: unknown): number | null {
  const parsed = parseImageParamValue(key, value)
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

export function catalogValueOr<TFallback>(
  key: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Painting controls read raw draft values; parseImageParamValue validates them against the canonical registry catalog before returning a typed value.
  value: unknown,
  fallback: TFallback
): NonNullable<ParamValue<CanonicalParamKey>> | TFallback {
  return parseImageParamValue(key, value) ?? fallback
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw painting draft fields may contain another control type; this reader accepts only strings and supplies the configured fallback.
export function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw painting draft fields are not yet typed per control; this reader accepts actual booleans without truthiness coercion.
export function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This formatter receives raw painting draft values and displays only strings or finite numbers, dropping unsupported object values.
export function controlValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`
  return ''
}
