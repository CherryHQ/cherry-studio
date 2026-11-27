import { existsSync, readFileSync } from 'node:fs'

import { app } from 'electron'

import { application } from '@application'
import {
  type CatalogManifest,
  CatalogManifestSchema,
  isCatalogManifestCompatible,
  type RegistryPaths,
  REMOTE_REGISTRY_FILES,
  type RemoteRegistryFileName
} from '@cherrystudio/provider-registry/node'

/**
 * Completion marker written last after both remote-safe model metadata files.
 * Provider routing always remains bundled.
 */
export const OVERRIDE_MANIFEST = 'manifest.json'

/**
 * Reason an existing override snapshot on disk is rejected. `file` names the
 * first failing catalog file (`'manifest.json'` when the manifest itself fails).
 */
export interface OverrideSnapshotRejection {
  file: RemoteRegistryFileName | typeof OVERRIDE_MANIFEST
  cause: 'missing' | 'unparsable' | 'version-mismatch' | 'incompatible' | 'manifest-unparsable'
}

function inspectOverrideSnapshot(): { manifest: CatalogManifest } | { rejection: OverrideSnapshotRejection } | null {
  const manifestPath = application.getPath('feature.provider_registry.override', OVERRIDE_MANIFEST)
  if (!existsSync(manifestPath)) return null

  let manifest: CatalogManifest
  try {
    manifest = CatalogManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  } catch {
    return { rejection: { file: OVERRIDE_MANIFEST, cause: 'manifest-unparsable' } }
  }
  if (!isCatalogManifestCompatible(manifest, app.getVersion())) {
    return { rejection: { file: OVERRIDE_MANIFEST, cause: 'incompatible' } }
  }

  for (const file of REMOTE_REGISTRY_FILES) {
    if (!existsSync(application.getPath('feature.provider_registry.override', file))) {
      return { rejection: { file, cause: 'missing' } }
    }
  }
  for (const file of REMOTE_REGISTRY_FILES) {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(application.getPath('feature.provider_registry.override', file), 'utf-8'))
    } catch {
      return { rejection: { file, cause: 'unparsable' } }
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { rejection: { file, cause: 'unparsable' } }
    }
    const version = (data as { version?: unknown }).version
    if (typeof version !== 'string' || version !== manifest.files[file]) {
      return { rejection: { file, cause: 'version-mismatch' } }
    }
  }
  return { manifest }
}

/**
 * Report the first reason an on-disk override snapshot is rejected (`'manifest.json'`
 * in `file` when the manifest itself fails), or `null` when absent or active.
 */
export function probeOverrideSnapshot(): OverrideSnapshotRejection | null {
  const result = inspectOverrideSnapshot()
  return result && 'rejection' in result ? result.rejection : null
}

/**
 * Read the active complete override manifest for this build. The provider file
 * is deliberately excluded: unsigned remote data may enrich models but cannot
 * replace credential-bearing routing configuration.
 */
export function readActiveOverrideManifest(): CatalogManifest | null {
  const result = inspectOverrideSnapshot()
  return result && 'manifest' in result ? result.manifest : null
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
