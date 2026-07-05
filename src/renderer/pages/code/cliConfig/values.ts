import type { ApiKeyEntry } from '@shared/data/types/provider'

export { sanitizeProviderName } from '@shared/utils/provider'

export function firstApiKey(keys: ApiKeyEntry[] | undefined): string {
  return keys?.find((k) => k.isEnabled)?.key ?? ''
}

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

/** Drop every key in `record` whose name starts with `prefix`. */
export function omitKeysByPrefix<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)))
}

/** Delete `target.features.goals`, dropping the whole `features` object if it becomes empty. */
export function dropFeatureGoalsIfEmpty(target: Record<string, any>): void {
  if (!target.features || typeof target.features !== 'object') return
  const features = { ...(target.features as Record<string, any>) }
  delete features.goals
  if (Object.keys(features).length === 0) delete target.features
  else target.features = features
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeUrl(value: string | undefined): string {
  return value ? value.trim().replace(/\/+$/, '') : ''
}
