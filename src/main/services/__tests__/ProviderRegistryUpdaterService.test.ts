import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock, applyOverrideMock, getCatalogVersionMock, getCountryMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  applyOverrideMock: vi.fn(),
  getCatalogVersionMock: vi.fn(),
  getCountryMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {},
  Injectable: () => (target: unknown) => target,
  ServicePhase: () => (target: unknown) => target,
  Phase: { WhenReady: 'whenReady' }
}))

vi.mock('@main/services/RegionService', () => ({ regionService: { getCountry: getCountryMock } }))
vi.mock('@main/utils/systemInfo', () => ({ generateUserAgent: () => 'test-ua' }))
vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: { applyOverride: applyOverrideMock, getCatalogVersion: getCatalogVersionMock }
}))
// Keep the real CatalogManifestSchema / REGISTRY_FILES / REGISTRY_SCHEMA_VERSION;
// stub only the heavy data-list schemas so catalog bodies validate trivially
// (`.version` read straight off the parsed object).
vi.mock('@cherrystudio/provider-registry/node', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@cherrystudio/provider-registry/node')
  const passthrough = { parse: (data: unknown) => data }
  return {
    ...actual,
    ModelListSchema: passthrough,
    ProviderListSchema: passthrough,
    ProviderModelListSchema: passthrough
  }
})
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  net: { fetch: netFetchMock }
}))

import { ProviderRegistryUpdaterService } from '../ProviderRegistryUpdaterService'

const response = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, text: async () => body })

/** Route manifest.json vs data files. `manifest: null` → 404; `dataOk: false` → data 404s. */
function mockRemote(opts: { floor?: string; manifest?: string | null; dataVersion?: string; dataOk?: boolean } = {}) {
  const { floor = '2.0.0', manifest, dataVersion = 'v2', dataOk = true } = opts
  const files = { 'models.json': dataVersion, 'providers.json': dataVersion, 'provider-models.json': dataVersion }
  const manifestBody =
    manifest === undefined ? JSON.stringify({ releaseFloor: floor, schemaVersion: 1, files }) : manifest
  netFetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/manifest.json')) {
      return manifestBody === null ? response('', false) : response(manifestBody)
    }
    return response(JSON.stringify({ version: dataVersion }), dataOk)
  })
}

describe('ProviderRegistryUpdaterService.check', () => {
  let service: ProviderRegistryUpdaterService

  beforeEach(() => {
    netFetchMock.mockReset()
    applyOverrideMock.mockReset()
    getCatalogVersionMock.mockReset()
    getCountryMock.mockReset()
    getCatalogVersionMock.mockReturnValue('v1') // current on-disk catalog is at v1
    getCountryMock.mockResolvedValue('US')
    service = new ProviderRegistryUpdaterService()
  })

  it('applies the override when the remote version is newer and the floor passes', async () => {
    mockRemote({ floor: '2.0.0', dataVersion: 'v2' })

    await service.check()

    expect(applyOverrideMock).toHaveBeenCalledTimes(1)
    const [appliedFiles, manifestBody] = applyOverrideMock.mock.calls[0]
    expect(Object.keys(appliedFiles).sort()).toEqual(['models.json', 'provider-models.json', 'providers.json'])
    const manifest = JSON.parse(manifestBody)
    expect(manifest.releaseFloor).toBe('2.0.0')
    expect(manifest.files['models.json']).toBe('v2')
  })

  it('is a no-op when the remote version matches the current one', async () => {
    mockRemote({ dataVersion: 'v1' })

    await service.check()

    expect(applyOverrideMock).not.toHaveBeenCalled()
  })

  it('does not apply when a download fails (non-ok data response)', async () => {
    mockRemote({ dataOk: false })

    await service.check()

    expect(applyOverrideMock).not.toHaveBeenCalled()
  })

  it('does not apply when a payload is invalid (keeps current data)', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    netFetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/manifest.json')
        ? response(JSON.stringify({ releaseFloor: '2.0.0', schemaVersion: 1, files }))
        : response('<<not json>>')
    )

    await service.check()

    expect(applyOverrideMock).not.toHaveBeenCalled()
  })

  it('rejects a cross-commit mixture (a file version does not match the manifest digest)', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    netFetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/manifest.json'))
        return response(JSON.stringify({ releaseFloor: '2.0.0', schemaVersion: 1, files }))
      // Branch advanced mid-fetch: models.json now belongs to a newer commit.
      if (url.endsWith('/models.json')) return response(JSON.stringify({ version: 'v3' }))
      return response(JSON.stringify({ version: 'v2' }))
    })

    await service.check()

    expect(applyOverrideMock).not.toHaveBeenCalled()
  })

  it('rejects a remote catalog whose release floor is older than the app (anti-downgrade)', async () => {
    // app is 1.0.0; a floor of 0.9.0 means the remote was generated for an older release.
    mockRemote({ floor: '0.9.0', dataVersion: 'v2' })

    await service.check()

    expect(applyOverrideMock).not.toHaveBeenCalled()
    // Data files are never fetched once the floor fails (manifest-first).
    expect(netFetchMock).toHaveBeenCalledWith(expect.stringContaining('/manifest.json'), expect.anything())
    expect(netFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/models.json'), expect.anything())
  })

  it('rejects a manifest with no valid releaseFloor', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    mockRemote({
      manifest: JSON.stringify({ releaseFloor: 'not-a-version', schemaVersion: 1, files }),
      dataVersion: 'v2'
    })

    await service.check()

    expect(applyOverrideMock).not.toHaveBeenCalled()
  })

  it('uses the GitCode mirror inside China', async () => {
    getCountryMock.mockResolvedValue('CN')
    mockRemote({ dataVersion: 'v2' })

    await service.check()

    expect(netFetchMock).toHaveBeenCalledWith(expect.stringContaining('raw.gitcode.com'), expect.anything())
  })

  it('fetches from the schema-version dir so old apps only receive compatible data', async () => {
    mockRemote({ dataVersion: 'v2' })

    await service.check()

    expect(netFetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/models.json'), expect.anything())
  })
})
