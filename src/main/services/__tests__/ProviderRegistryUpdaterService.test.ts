import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  netFetchMock,
  getCatalogVersionMock,
  isInChinaMock,
  notifyDataChangeMock,
  readActiveManifestMock,
  writeSnapshotMock
} = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  getCatalogVersionMock: vi.fn(),
  isInChinaMock: vi.fn(),
  notifyDataChangeMock: vi.fn(),
  readActiveManifestMock: vi.fn(),
  writeSnapshotMock: vi.fn()
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

vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina: isInChinaMock } }))
vi.mock('@main/utils/systemInfo', () => ({ generateUserAgent: () => 'test-ua' }))
vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: { getCatalogVersion: getCatalogVersionMock }
}))
vi.mock('@main/data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataChangeMock }))
vi.mock('@main/data/services/utils/registryDataPaths', () => ({
  readActiveOverrideManifest: readActiveManifestMock
}))
vi.mock('@main/services/providerRegistrySnapshot', () => ({
  writeProviderRegistrySnapshot: writeSnapshotMock
}))
// Keep the real manifest contract / remote file list / schema version;
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

import { REGISTRY_SCHEMA_VERSION } from '@cherrystudio/provider-registry/node'

import { ProviderRegistryUpdaterService } from '../ProviderRegistryUpdaterService'

const response = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, text: async () => body })

/** Route manifest.json vs data files. `manifest: null` → 404; `dataOk: false` → data 404s. */
function mockRemote(
  opts: {
    minAppVersion?: string
    sourceAppVersion?: string
    revision?: number
    manifest?: string | null
    dataVersion?: string
    dataOk?: boolean
  } = {}
) {
  const {
    minAppVersion = '1.0.0',
    sourceAppVersion = '2.0.0',
    revision = 2,
    manifest,
    dataVersion = 'v2',
    dataOk = true
  } = opts
  const files = { 'models.json': dataVersion, 'providers.json': dataVersion, 'provider-models.json': dataVersion }
  const manifestBody =
    manifest === undefined
      ? JSON.stringify({ minAppVersion, sourceAppVersion, revision, schemaVersion: REGISTRY_SCHEMA_VERSION, files })
      : manifest
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
    getCatalogVersionMock.mockReset()
    isInChinaMock.mockReset()
    notifyDataChangeMock.mockReset()
    readActiveManifestMock.mockReset()
    writeSnapshotMock.mockReset()
    getCatalogVersionMock.mockReturnValue('v1') // current on-disk catalog is at v1
    isInChinaMock.mockResolvedValue(false)
    readActiveManifestMock.mockReturnValue(null)
    service = new ProviderRegistryUpdaterService()
  })

  it('applies only remote-safe model metadata and notifies mounted DataApi projections', async () => {
    mockRemote({ dataVersion: 'v2' })

    await service.check()

    expect(writeSnapshotMock).toHaveBeenCalledTimes(1)
    const [appliedFiles, manifestBody] = writeSnapshotMock.mock.calls[0]
    expect(Object.keys(appliedFiles).sort()).toEqual(['models.json', 'provider-models.json'])
    const manifest = JSON.parse(manifestBody)
    expect(manifest.minAppVersion).toBe('1.0.0')
    expect(manifest.sourceAppVersion).toBe('2.0.0')
    expect(manifest.revision).toBe(2)
    expect(manifest.files['models.json']).toBe('v2')
    expect(netFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/providers.json'), expect.anything())
    expect(notifyDataChangeMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        { endpoint: '/models', kind: 'projection' },
        { endpoint: '/models/:uniqueModelId*' },
        { endpoint: '/providers/:providerId/models:resolve', kind: 'membership' },
        { endpoint: '/providers/:providerId/models/:modelId*/image-generation-support' }
      ])
    )
  })

  it('is a no-op when the remote version matches the current one', async () => {
    mockRemote({ dataVersion: 'v1' })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
  })

  it('commits a newer manifest revision even when model content is unchanged', async () => {
    getCatalogVersionMock.mockReturnValue('v2')
    readActiveManifestMock.mockReturnValue({ revision: 1 })
    mockRemote({ revision: 2, dataVersion: 'v2' })

    await service.check()

    expect(writeSnapshotMock).toHaveBeenCalledOnce()
  })

  it('does not apply when a download fails (non-ok data response)', async () => {
    mockRemote({ dataOk: false })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
  })

  it('does not apply when a payload is invalid (keeps current data)', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    netFetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/manifest.json')
        ? response(
            JSON.stringify({
              minAppVersion: '1.0.0',
              sourceAppVersion: '2.0.0',
              revision: 2,
              schemaVersion: REGISTRY_SCHEMA_VERSION,
              files
            })
          )
        : response('<<not json>>')
    )

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
  })

  it('rejects a cross-commit mixture (a file version does not match the manifest digest)', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    netFetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/manifest.json'))
        return response(
          JSON.stringify({
            minAppVersion: '1.0.0',
            sourceAppVersion: '2.0.0',
            revision: 2,
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            files
          })
        )
      // Branch advanced mid-fetch: models.json now belongs to a newer commit.
      if (url.endsWith('/models.json')) return response(JSON.stringify({ version: 'v3' }))
      return response(JSON.stringify({ version: 'v2' }))
    })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
  })

  it('rejects a snapshot older than the application bundle', async () => {
    mockRemote({ sourceAppVersion: '0.9.0', dataVersion: 'v2' })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
    expect(netFetchMock).toHaveBeenCalledWith(expect.stringContaining('/manifest.json'), expect.anything())
    expect(netFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/models.json'), expect.anything())
  })

  it('rejects data that requires a newer application', async () => {
    mockRemote({ minAppVersion: '1.1.0', dataVersion: 'v2' })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
    expect(netFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/models.json'), expect.anything())
  })

  it('rejects a manifest with no valid compatibility range', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    mockRemote({
      manifest: JSON.stringify({
        minAppVersion: 'not-a-version',
        sourceAppVersion: '2.0.0',
        revision: 2,
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        files
      }),
      dataVersion: 'v2'
    })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
  })

  it('rejects a manifest for a different registry schema version', async () => {
    const files = { 'models.json': 'v2', 'providers.json': 'v2', 'provider-models.json': 'v2' }
    mockRemote({
      manifest: JSON.stringify({
        minAppVersion: '1.0.0',
        sourceAppVersion: '2.0.0',
        revision: 2,
        schemaVersion: REGISTRY_SCHEMA_VERSION + 1,
        files
      }),
      dataVersion: 'v2'
    })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
    expect(netFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/models.json'), expect.anything())
  })

  it('rejects a snapshot revision that is not newer than the active override', async () => {
    readActiveManifestMock.mockReturnValue({ revision: 3 })
    mockRemote({ revision: 3, dataVersion: 'v2' })

    await service.check()

    expect(writeSnapshotMock).not.toHaveBeenCalled()
    expect(netFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/models.json'), expect.anything())
  })

  it('uses the GitCode mirror inside China', async () => {
    isInChinaMock.mockResolvedValue(true)
    mockRemote({ dataVersion: 'v2' })

    await service.check()

    expect(netFetchMock).toHaveBeenCalledWith(expect.stringContaining('raw.gitcode.com'), expect.anything())
  })

  it('fetches from the schema-version dir so old apps only receive compatible data', async () => {
    mockRemote({ dataVersion: 'v2' })

    await service.check()

    expect(netFetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/v${REGISTRY_SCHEMA_VERSION}/models.json`),
      expect.anything()
    )
  })
})
