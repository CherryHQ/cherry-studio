/**
 * MiniApp migration mappings and transform functions
 */

import type { InsertMiniAppRow, MiniAppRegion, MiniAppStatus } from '@data/db/schemas/miniapp'

function toNullable<T>(value: unknown): T | null {
  return (value ?? null) as T | null
}

function toNullableRegions(raw: unknown): MiniAppRegion[] | null {
  if (!Array.isArray(raw)) return null
  const validRegions = new Set<string>(['CN', 'Global'])
  const regions = raw.filter((r): r is MiniAppRegion => typeof r === 'string' && validRegions.has(r))
  return regions.length > 0 ? regions : null
}

function toRequired<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T
}

function normalizeType(raw: unknown): 'default' | 'custom' {
  const s = String(raw ?? 'Default').toLowerCase()
  if (s === 'custom') return 'custom'
  return 'default'
}

function parseAddTime(raw: unknown): number | undefined {
  if (raw == null) return undefined
  // Accept both ISO string and numeric timestamp
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'string') {
    const ts = new Date(raw).getTime()
    return Number.isNaN(ts) ? undefined : ts
  }
  return undefined
}

/**
 * Transform a single Redux MinApp object into a SQLite miniapp row.
 *
 * @param source - Raw MinAppType from Redux
 * @param status - The status this app should have ('enabled' | 'disabled' | 'pinned')
 * @param sortOrder - Position within the status group (array index)
 */
export function transformMiniApp(
  source: Record<string, unknown>,
  status: MiniAppStatus,
  sortOrder: number
): InsertMiniAppRow {
  // logo: keep only non-empty string values (URLs / base64), drop React component references
  const rawLogo = source.logo
  const logo = typeof rawLogo === 'string' && rawLogo.length > 0 ? rawLogo : null

  return {
    appId: toRequired<string>(source.id, ''),
    name: toRequired<string>(source.name, ''),
    url: toRequired<string>(source.url, ''),
    logo,
    type: normalizeType(source.type),
    status,
    sortOrder,
    // v2 fix: Handle typo 'bodered' → 'bordered' during migration
    bordered: toRequired(source.bodered ?? source.bordered, true),
    background: toNullable<string>(source.background),
    supportedRegions: toNullableRegions(source.supportedRegions),
    nameKey: toNullable<string>(source.nameKey),
    // Map Redux addTime → createdAt if available
    createdAt: parseAddTime(source.addTime),
    updatedAt: undefined
  }
}
