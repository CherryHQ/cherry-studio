import { existsSync, readFileSync } from 'node:fs'

import { application } from '@application'
import {
  CatalogManifestSchema,
  REGISTRY_SCHEMA_VERSION,
  type RegistryPaths
} from '@cherrystudio/provider-registry/node'
import { app } from 'electron'
import semver from 'semver'

/**
 * Completion marker written LAST into the override dir once all catalog files are
 * in place (see `ProviderRegistryService.applyOverride`). Carries the schema
 * version and `releaseFloor` the override was written for.
 */
export const OVERRIDE_MANIFEST = 'manifest.json'

/**
 * Whether a complete override set that is safe for THIS build is present. The
 * override dir persists across app version changes, so the manifest is validated
 * on every read:
 *
 * - **schemaVersion** must equal this build's — after a DOWNGRADE the override may
 *   target a newer schema this build cannot parse.
 * - **releaseFloor** must be ≥ this app's version — after an UPGRADE (even with the
 *   same schema) an override persisted by an older app must not keep shadowing the
 *   newer bundled catalog this build ships with.
 *
 * On any mismatch we fall back to the (always self-consistent) bundled data. This
 * mirrors the updater's download-time floor check, applied at activation so a
 * lagging mirror can never leave a freshly-upgraded app stuck on stale data.
 */
function isOverrideActive(): boolean {
  const manifestPath = application.getPath('feature.provider_registry.override', OVERRIDE_MANIFEST)
  if (!existsSync(manifestPath)) return false
  try {
    const manifest = CatalogManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf-8')))
    if (manifest.schemaVersion !== REGISTRY_SCHEMA_VERSION) return false
    const floor = semver.valid(semver.coerce(manifest.releaseFloor))
    if (!floor) return false
    const appVersion = semver.coerce(app.getVersion())?.version ?? '0.0.0'
    return semver.gte(floor, appVersion)
  } catch {
    return false
  }
}

/**
 * Resolve the three registry files to their on-disk paths — **all-or-nothing**:
 * when a complete override set is present (its manifest exists) all three resolve
 * to the user-writable override copy; otherwise all three resolve to the bundled
 * data. Never mixes the two, so a half-written override (no manifest yet) or a
 * partially-updated set is ignored in favour of the consistent bundled data.
 */
export function resolveRegistryPaths(): RegistryPaths {
  const key = isOverrideActive() ? 'feature.provider_registry.override' : 'feature.provider_registry.data'
  return {
    models: application.getPath(key, 'models.json'),
    providers: application.getPath(key, 'providers.json'),
    providerModels: application.getPath(key, 'provider-models.json')
  }
}
