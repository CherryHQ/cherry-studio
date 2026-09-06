import { describe, expect, it } from 'vitest'

import {
  CatalogManifestSchema,
  isCatalogManifestCompatible,
  REGISTRY_SCHEMA_VERSION,
  REMOTE_REGISTRY_FILES
} from '../registry-loader'

// Literal version window on the CURRENT wire schema — the range contract under
// test must not drift when REGISTRY_MIN_APP_VERSION moves.
const manifest = CatalogManifestSchema.parse({
  minAppVersion: '2.0.7',
  sourceAppVersion: '2.0.7',
  revision: 1,
  schemaVersion: REGISTRY_SCHEMA_VERSION,
  files: { 'models.json': 'models-v1', 'provider-models.json': 'overrides-v1' }
})

describe('remote registry manifest', () => {
  it('accepts only applications inside the explicit compatibility range', () => {
    expect(isCatalogManifestCompatible(manifest, '2.0.7')).toBe(true)
    expect(isCatalogManifestCompatible(manifest, '2.0.6')).toBe(false)
    expect(isCatalogManifestCompatible(manifest, '2.0.8')).toBe(false)
  })

  it('rejects a manifest for another wire schema', () => {
    expect(isCatalogManifestCompatible({ ...manifest, schemaVersion: REGISTRY_SCHEMA_VERSION + 1 }, '2.0.7')).toBe(
      false
    )
  })

  it('requires a non-negative monotonic revision', () => {
    expect(() => CatalogManifestSchema.parse({ ...manifest, revision: -1 })).toThrow()
  })

  it('limits unsigned remote updates to model metadata files', () => {
    expect(REMOTE_REGISTRY_FILES).toEqual(['models.json', 'provider-models.json'])
    expect(REMOTE_REGISTRY_FILES).not.toContain('providers.json')
  })
})
