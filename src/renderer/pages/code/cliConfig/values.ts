import type { ApiKeyEntry } from '@shared/data/types/provider'

export function firstApiKey(keys: ApiKeyEntry[] | undefined): string {
  return keys?.find((k) => k.isEnabled)?.key ?? ''
}

export function getConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  return configBlob && typeof configBlob === 'object' ? (configBlob as Record<string, any>) : {}
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

export function sanitizeProviderName(name: string, fallback: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_\s.-]/g, '').replace(/\s+/g, '-')
  return sanitized || fallback
}
