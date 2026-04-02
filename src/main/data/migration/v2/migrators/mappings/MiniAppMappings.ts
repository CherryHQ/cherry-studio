/**
 * MiniApp migration mappings and transform functions
 */

import type { MiniAppInsert, MiniAppRegion, MiniAppStatus } from '@data/db/schemas/miniapp'
import { ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'

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

/**
 * [v2] Built-in app ID to logo key mapping.
 * Derived from the shared preset data (ORIGIN_DEFAULT_MIN_APPS) to stay in sync.
 * Custom apps with URL logos are not included here - their logos are preserved as-is.
 */
const BUILTIN_APP_LOGO_MAP: Record<string, string> = Object.fromEntries(
  ORIGIN_DEFAULT_MIN_APPS.filter((app) => app.logo).map((app) => [app.id, app.logo!])
)

const DEFAULT_LOGO_KEY = 'application'

/**
 * Transform a single Redux MinApp object into a SQLite miniapp row.
 *
 * [v2] Logo handling:
 * - Custom apps: preserve URL strings (base64 or http/https URLs)
 * - Built-in apps: map app ID to logo key for icon resolution system
 * - Invalid/empty: fallback to 'application' default key
 *
 * @param source - Raw MinAppType from Redux
 * @param status - The status this app should have ('enabled' | 'disabled' | 'pinned')
 * @param sortOrder - Position within the status group (array index)
 */
export function transformMiniApp(
  source: Record<string, unknown>,
  status: MiniAppStatus,
  sortOrder: number
): MiniAppInsert {
  // [v2] Logo resolution: URL strings are preserved for custom apps,
  // built-in apps get their logo key from the mapping table
  const rawLogo = source.logo
  const appId = String(source.id ?? '')

  let logo: string
  if (typeof rawLogo === 'string' && rawLogo.length > 0) {
    // Check if it's a URL (custom app) or already a key
    const isUrl = rawLogo.startsWith('http') || rawLogo.startsWith('data:')
    if (isUrl) {
      logo = rawLogo // Keep custom app URL logos
    } else {
      logo = rawLogo // Already a string key
    }
  } else {
    // Non-string logo (React component ref) or empty: resolve from built-in map
    logo = BUILTIN_APP_LOGO_MAP[appId] ?? DEFAULT_LOGO_KEY
  }

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
    nameKey: toNullable<string>(source.nameKey)
  }
}
