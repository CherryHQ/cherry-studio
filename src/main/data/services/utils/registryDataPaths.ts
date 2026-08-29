import { existsSync, readFileSync } from 'node:fs'

import { application } from '@application'
import {
  type CatalogManifest,
  CatalogManifestSchema,
  isCatalogManifestCompatible,
  type RegistryPaths,
  REMOTE_REGISTRY_FILES
} from '@cherrystudio/provider-registry/node'
import { app } from 'electron'

/**
 * Completion marker written last after both remote-safe model metadata files.
 * Provider routing always remains bundled.
 */
export const OVERRIDE_MANIFEST = 'manifest.json'

/**
 * Read the active complete override manifest for this build. The provider file
 * is deliberately excluded: unsigned remote data may enrich models but cannot
 * replace credential-bearing routing configuration.
 */
export function readActiveOverrideManifest(): CatalogManifest | null {
  const manifestPath = application.getPath('feature.provider_registry.override', OVERRIDE_MANIFEST)
  if (!existsSync(manifestPath)) return null
  for (const file of REMOTE_REGISTRY_FILES) {
    if (!existsSync(application.getPath('feature.provider_registry.override', file))) return null
  }
  try {
    const manifest = CatalogManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf-8')))
    if (!isCatalogManifestCompatible(manifest, app.getVersion())) return null
    for (const file of REMOTE_REGISTRY_FILES) {
      const data = JSON.parse(
        readFileSync(application.getPath('feature.provider_registry.override', file), 'utf-8')
      ) as { version?: unknown }
      if (typeof data.version !== 'string' || data.version !== manifest.files[file]) return null
    }
    return manifest
  } catch {
    return null
  }
}

/**
 * Resolve registry files while keeping provider routing bundled. Models and
 * provider-model metadata switch together only after a complete compatible
 * snapshot is present; a partial snapshot falls back to bundled metadata.
 */
export function resolveRegistryPaths(): RegistryPaths {
  const bundled = 'feature.provider_registry.data' as const
  const modelData = readActiveOverrideManifest() ? 'feature.provider_registry.override' : bundled
  return {
    models: application.getPath(modelData, 'models.json'),
    providers: application.getPath(bundled, 'providers.json'),
    providerModels: application.getPath(modelData, 'provider-models.json')
  }
}
