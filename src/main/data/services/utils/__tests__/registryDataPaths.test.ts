import { beforeEach, describe, expect, it, vi } from 'vitest'

// The override is used only when its manifest exists, its schemaVersion matches
// this build's REGISTRY_SCHEMA_VERSION (real package export = 1), and its
// releaseFloor is >= this app's version (app.getVersion mocked to 2.0.0 below).
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

import { resolveRegistryPaths } from '../registryDataPaths'

const OVERRIDE = '/mock/feature.provider_registry.override'
const BUNDLED = '/mock/feature.provider_registry.data'
const MANIFEST = `${OVERRIDE}/manifest.json`

const overridePaths = {
  models: `${OVERRIDE}/models.json`,
  providers: `${OVERRIDE}/providers.json`,
  providerModels: `${OVERRIDE}/provider-models.json`
}
const bundledPaths = {
  models: `${BUNDLED}/models.json`,
  providers: `${BUNDLED}/providers.json`,
  providerModels: `${BUNDLED}/provider-models.json`
}

const FILES = { 'models.json': 'a', 'providers.json': 'b', 'provider-models.json': 'c' }

describe('registryDataPaths.resolveRegistryPaths', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
  })

  it('resolves all three files to the override when the manifest matches schema + floor', () => {
    existsSyncMock.mockImplementation((p: string) => p === MANIFEST)
    readFileSyncMock.mockReturnValue(JSON.stringify({ schemaVersion: 1, releaseFloor: '2.0.0', files: FILES }))
    expect(resolveRegistryPaths()).toEqual(overridePaths)
  })

  it('resolves all three files to bundled data when no override manifest exists', () => {
    existsSyncMock.mockReturnValue(false)
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores an override written for a newer schema (app downgrade) — falls back to bundled', () => {
    existsSyncMock.mockImplementation((p: string) => p === MANIFEST)
    readFileSyncMock.mockReturnValue(JSON.stringify({ schemaVersion: 2, releaseFloor: '2.5.0', files: FILES }))
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores a stale override from an older app after upgrade (same schema, older floor)', () => {
    // App is now 2.0.0; the override was persisted by a 1.x app (floor 1.0.0). The
    // bundled catalog this build ships is newer, so the stale override must NOT win.
    existsSyncMock.mockImplementation((p: string) => p === MANIFEST)
    readFileSyncMock.mockReturnValue(JSON.stringify({ schemaVersion: 1, releaseFloor: '1.0.0', files: FILES }))
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })

  it('ignores a half-written override (data present, manifest absent) — all-or-nothing', () => {
    existsSyncMock.mockImplementation((p: string) => p === `${OVERRIDE}/models.json`)
    expect(resolveRegistryPaths()).toEqual(bundledPaths)
  })
})
