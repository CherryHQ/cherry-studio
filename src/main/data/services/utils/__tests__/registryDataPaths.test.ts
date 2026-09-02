import { beforeEach, describe, expect, it, vi } from 'vitest'

// The override is used only when its manifest and both remote-safe data files
// exist and this app falls inside the manifest compatibility range.
const { existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn()
}))
vi.mock('node:fs', () => ({ existsSync: existsSyncMock, readFileSync: readFileSyncMock }))
vi.mock('electron', () => ({ app: { getVersion: () => '2.0.0' } }))

// Unified application mock: getPath returns `/mock/${key}/${filename}`.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { REGISTRY_SCHEMA_VERSION } from '@cherrystudio/provider-registry/node'

import { resolveRegistryPaths } from '../registryDataPaths'

const OVERRIDE = '/mock/feature.provider_registry.override'
const BUNDLED = '/mock/feature.provider_registry.data'
const MANIFEST = `${OVERRIDE}/manifest.json`

const activePaths = {
  models: `${OVERRIDE}/models.json`,
  providers: `${BUNDLED}/providers.json`,
  providerModels: `${OVERRIDE}/provider-models.json`
}
const bundledPaths = {
  models: `${BUNDLED}/models.json`,
  providers: `${BUNDLED}/providers.json`,
  providerModels: `${BUNDLED}/provider-models.json`
}

const FILES = { 'models.json': 'a', 'provider-models.json': 'c' }
// Track the live wire schema: a snapshot is only accepted on the current version.
const VALID_MANIFEST = JSON.stringify({
  minAppVersion: '1.0.0',
  sourceAppVersion: '2.0.0',
  revision: 1,
  schemaVersion: REGISTRY_SCHEMA_VERSION,
  files: FILES
})

function completeOverride(pathname: string): boolean {
  return [MANIFEST, `${OVERRIDE}/models.json`, `${OVERRIDE}/provider-models.json`].includes(pathname)
}

function readCompleteOverride(pathname: string): string {
  if (pathname === MANIFEST) return VALID_MANIFEST
  if (pathname.endsWith('/models.json')) return JSON.stringify({ version: 'a', models: [] })
  if (pathname.endsWith('/provider-models.json')) return JSON.stringify({ version: 'c', overrides: [] })
  throw new Error(`unexpected read: ${pathname}`)
}

describe('registryDataPaths.resolveRegistryPaths', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
  })

  it('overrides model metadata while keeping security-sensitive provider routing bundled', () => {
    existsSyncMock.mockImplementation(completeOverride)
    readFileSyncMock.mockImplementation(readCompleteOverride)
    expect(resolveRegistryPaths()).toEqual(activePaths)
  })

  it('resolves all three files to bundled data when no override manifest exists', () => {
    existsSyncMock.mockReturnValue(false)
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores an override written for a newer schema (app downgrade) — falls back to bundled', () => {
    existsSyncMock.mockImplementation(completeOverride)
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        ...JSON.parse(VALID_MANIFEST),
        schemaVersion: REGISTRY_SCHEMA_VERSION + 1,
        sourceAppVersion: '2.5.0'
      })
    )
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores data that requires a newer application', () => {
    existsSyncMock.mockImplementation(completeOverride)
    readFileSyncMock.mockReturnValue(JSON.stringify({ ...JSON.parse(VALID_MANIFEST), minAppVersion: '2.1.0' }))
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores a stale snapshot after an application upgrade', () => {
    existsSyncMock.mockImplementation(completeOverride)
    readFileSyncMock.mockReturnValue(JSON.stringify({ ...JSON.parse(VALID_MANIFEST), sourceAppVersion: '1.9.0' }))
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores a half-written override (data present, manifest absent) — all-or-nothing', () => {
    existsSyncMock.mockImplementation((p: string) => p === `${OVERRIDE}/models.json`)
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores a manifest whose model snapshot is incomplete', () => {
    existsSyncMock.mockImplementation((p: string) => p !== `${OVERRIDE}/provider-models.json`)
    readFileSyncMock.mockReturnValue(VALID_MANIFEST)
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores model data whose content version does not match the manifest', () => {
    existsSyncMock.mockImplementation(completeOverride)
    readFileSyncMock.mockImplementation((pathname: string) =>
      pathname.endsWith('/models.json')
        ? JSON.stringify({ version: 'wrong', models: [] })
        : readCompleteOverride(pathname)
    )
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })
})
