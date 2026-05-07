/**
 * MiniApp migration mappings and transform functions.
 *
 * Per the layered preset pattern (see best-practice-layered-preset-pattern.md),
 * preset apps store **delta only** (no name/url/logo/etc.). Custom apps store
 * full data. The discriminator is preset membership, not a stored kind column.
 */

import type { MiniAppInsert, MiniAppRegion, MiniAppStatus } from '@data/db/schemas/miniapp'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'

const presetMap = new Map(PRESETS_MINI_APPS.map((p) => [p.id, p]))

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

/**
 * Transform a single Redux MiniApp object into a SQLite miniapp row (without orderKey).
 *
 * Order keys are stamped by `assignOrderKeysByScope` in the migrator after all rows
 * are partitioned into status buckets — see data-ordering-guide.md §5.
 *
 * Row shape depends on preset membership:
 *   - appId ∈ PRESETS_MINI_APPS  →  delta-only override row (NULL for preset fields)
 *   - appId ∉ PRESETS_MINI_APPS  →  full custom row
 *
 * Preset fields are intentionally dropped for default apps so future preset
 * updates (name, url, logo, ...) propagate to existing installs (per spec
 * §"Update Compatibility").
 *
 * @param source - Raw MiniAppType from Redux
 * @param status - The status this app should have ('enabled' | 'disabled' | 'pinned')
 */
export function transformMiniApp(
  source: Record<string, unknown>,
  status: MiniAppStatus
): Omit<MiniAppInsert, 'orderKey'> {
  const appId = toRequired<string>(source.id, '')
  // v1 stamps `type: 'Custom'` on apps loaded from custom-minapps.json
  // (see v1 src/renderer/src/config/minapps.ts:loadCustomMiniApp). Preset rows
  // in v1 leave `type` unset. Honor that explicit signal first so a user-created
  // app whose id collides with a v2-only preset isn't misclassified as preset.
  const isExplicitCustom = source.type === 'Custom'
  const preset = !isExplicitCustom ? presetMap.get(appId) : undefined

  // Preset (default) app — full preset data + delta status, presetMiniAppId set.
  // Mirrors ModelService preset-derived rows: full data with presetModelId.
  if (preset) {
    return {
      appId,
      presetMiniAppId: appId,
      name: preset.name,
      url: preset.url,
      logo: preset.logo ?? null,
      bordered: preset.bordered ?? true,
      background: preset.background ?? null,
      supportedRegions: preset.supportedRegions ?? null,
      nameKey: preset.nameKey ?? null,
      status
    }
  }

  // Custom app — full data from source.
  const rawLogo = source.logo
  const logo = typeof rawLogo === 'string' && rawLogo.length > 0 ? rawLogo : null

  return {
    appId,
    presetMiniAppId: null,
    name: toRequired<string>(source.name, ''),
    url: toRequired<string>(source.url, ''),
    logo,
    status,
    // v2 fix: Handle typo 'bodered' → 'bordered' during migration
    // Prefer the correctly spelled 'bordered' field; fall back to the typo field
    bordered: toRequired(source.bordered ?? source.bodered, true),
    background: toNullable<string>(source.background),
    supportedRegions: toNullableRegions(source.supportedRegions),
    nameKey: toNullable<string>(source.nameKey)
  }
}
