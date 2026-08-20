import { describe, expect, it } from 'vitest'

import {
  CatalogManifestSchema,
  isCatalogManifestCompatible,
  REGISTRY_MIN_APP_VERSION,
  REMOTE_REGISTRY_FILES
} from '../registry-loader'

const manifest = CatalogManifestSchema.parse({
  minAppVersion: REGISTRY_MIN_APP_VERSION,
  sourceAppVersion: '2.0.7',
  revision: 1,
  schemaVersion: 1,
  files: { 'models.json': 'models-v1', 'provider-models.json': 'overrides-v1' }
})

describe('remote registry manifest', () => {
  it('accepts only applications inside the explicit compatibility range', () => {
    expect(isCatalogManifestCompatible(manifest, '2.0.7')).toBe(true)
    expect(isCatalogManifestCompatible(manifest, '2.0.6')).toBe(false)
    expect(isCatalogManifestCompatible(manifest, '2.0.8')).toBe(false)
  })

  it('rejects a manifest for another wire schema', () => {
    expect(isCatalogManifestCompatible({ ...manifest, schemaVersion: 2 }, '2.0.7')).toBe(false)
  })

  it('requires a non-negative monotonic revision', () => {
    expect(() => CatalogManifestSchema.parse({ ...manifest, revision: -1 })).toThrow()
  })

  it('limits unsigned remote updates to model metadata files', () => {
    expect(REMOTE_REGISTRY_FILES).toEqual(['models.json', 'provider-models.json'])
    expect(REMOTE_REGISTRY_FILES).not.toContain('providers.json')
  })
})
