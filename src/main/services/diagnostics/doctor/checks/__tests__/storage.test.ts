import { application } from '@application'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preboot = vi.hoisted(() => ({
  isUsableDataDir: vi.fn(),
  getNormalizedExecutablePath: vi.fn(() => '/Applications/Cherry')
}))
const bootConfig = vi.hoisted(() => ({ get: vi.fn() }))
const storageMonitor = vi.hoisted(() => ({ refreshHealth: vi.fn() }))
const cleanup = vi.hoisted(() => ({ inspect: vi.fn(), run: vi.fn() }))
vi.mock('@main/core/preboot/userDataLocation', () => preboot)
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: bootConfig }))
vi.mock('@main/services/cacheCleanup', () => ({ cacheCleanupService: cleanup }))

const { diagnosticDataSize, diskSpace, userDataLocation } = await import('../storage')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }
const GB = 1024 ** 3
const MB = 1024 ** 2

beforeEach(() => {
  vi.clearAllMocks()
  ;(app as { isPackaged: boolean }).isPackaged = true
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'StorageMonitorService') return storageMonitor
    throw new Error(`Unexpected application.get(${name})`)
  }) as typeof application.get)
  cleanup.inspect.mockResolvedValue({ results: [] })
  cleanup.run.mockResolvedValue({ results: [] })
})

describe('storage-disk-space', () => {
  it.each([
    [512 * MB, 'fail', 'critical'],
    [2 * GB, 'warn', 'low']
  ])(
    'reports %i free bytes as %s and includes reclaimable diagnostic/cache size',
    async (freeBytes, status, variant) => {
      storageMonitor.refreshHealth.mockResolvedValue({ freeBytes, totalBytes: 100 * GB, checkedAt: 1, level: 'ok' })
      cleanup.inspect.mockResolvedValue({
        results: [
          { group: 'normal_cache', size: { bytes: 80 * MB, accuracy: 'estimated', completeness: 'complete' } },
          { group: 'logs', size: { bytes: 220 * MB, accuracy: 'exact', completeness: 'complete' } }
        ]
      })

      await expect(diskSpace.run(ctx)).resolves.toMatchObject({
        status,
        detail: {
          variant,
          params: {
            freeBytes,
            reclaimableBytes: 300 * MB,
            normalCacheBytes: 80 * MB,
            diagnosticDataBytes: 220 * MB
          }
        },
        actions: [{ kind: 'fix', fixId: 'cleanup' }]
      })
      expect(cleanup.inspect).toHaveBeenCalledWith(['normal_cache', 'logs'])
    }
  )

  it('passes at 5 GB and does not calculate cleanup sizes unnecessarily', async () => {
    storageMonitor.refreshHealth.mockResolvedValue({
      freeBytes: 5 * GB,
      totalBytes: 100 * GB,
      checkedAt: 1,
      level: 'ok'
    })

    await expect(diskSpace.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(cleanup.inspect).not.toHaveBeenCalled()
  })

  it('clears only ordinary cache and diagnostic data', async () => {
    cleanup.run.mockResolvedValue({
      results: [
        { group: 'normal_cache', status: 'cleared' },
        { group: 'logs', status: 'not_found' }
      ]
    })

    await expect(diskSpace.fixes.cleanup(ctx)).resolves.toEqual({ status: 'fixed' })
    expect(cleanup.run).toHaveBeenCalledWith(['normal_cache', 'logs'])
  })
})

describe('storage-diagnostic-data-size', () => {
  it('warns above 200 MB and offers the logs-group cleanup', async () => {
    cleanup.inspect.mockResolvedValue({
      results: [{ group: 'logs', size: { bytes: 200 * MB + 1, accuracy: 'exact', completeness: 'complete' } }]
    })

    await expect(diagnosticDataSize.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'large', params: { bytes: 200 * MB + 1 } },
      actions: [{ kind: 'fix', fixId: 'clear' }]
    })
  })

  it('passes at the 200 MB boundary', async () => {
    cleanup.inspect.mockResolvedValue({
      results: [{ group: 'logs', size: { bytes: 200 * MB, accuracy: 'exact', completeness: 'complete' } }]
    })

    await expect(diagnosticDataSize.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('clears only the diagnostic-data group', async () => {
    cleanup.run.mockResolvedValue({ results: [{ group: 'logs', status: 'cleared' }] })

    await expect(diagnosticDataSize.fixes.clear(ctx)).resolves.toEqual({ status: 'fixed' })
    expect(cleanup.run).toHaveBeenCalledWith(['logs'])
  })
})

describe('storage-userdata-location', () => {
  it('passes when no custom directory is configured', async () => {
    bootConfig.get.mockReturnValue(undefined)
    await expect(userDataLocation.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('passes when the configured directory is the one in use', async () => {
    bootConfig.get.mockReturnValue({ '/Applications/Cherry': '/mock/app.userdata' })
    await expect(userDataLocation.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns when boot fell back to the default directory and says whether the custom one works now', async () => {
    bootConfig.get.mockReturnValue({ '/Applications/Cherry': '/Volumes/External/Cherry' })
    preboot.isUsableDataDir.mockReturnValue(false)
    await expect(userDataLocation.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'fallback_to_default' },
      actions: [
        { kind: 'open_path', path: '/mock/app.userdata' },
        { kind: 'navigate', target: '/settings/data' }
      ],
      evidence: [
        { key: 'configured', value: '/Volumes/External/Cherry', dataClass: 'local_only' },
        { key: 'actual', value: '/mock/app.userdata', dataClass: 'local_only' },
        { key: 'configuredUsableNow', value: false, dataClass: 'public' }
      ]
    })
  })

  it('never fires in development builds, where the dev-suffix path is used', async () => {
    ;(app as { isPackaged: boolean }).isPackaged = false
    bootConfig.get.mockReturnValue({ '/Applications/Cherry': '/Volumes/External/Cherry' })
    await expect(userDataLocation.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(bootConfig.get).not.toHaveBeenCalled()
  })
})
