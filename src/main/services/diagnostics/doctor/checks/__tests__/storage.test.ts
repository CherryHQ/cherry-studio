import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preboot = vi.hoisted(() => ({
  isUsableDataDir: vi.fn(),
  getNormalizedExecutablePath: vi.fn(() => '/Applications/Cherry')
}))
const bootConfig = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@main/core/preboot/userDataLocation', () => preboot)
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: bootConfig }))

const { userDataLocation } = await import('../storage')
const signal = new AbortController().signal
const ctx = { signal, share: (_key: string, factory: (signal: AbortSignal) => Promise<never>) => factory(signal) }

beforeEach(() => {
  vi.clearAllMocks()
  ;(app as { isPackaged: boolean }).isPackaged = true
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
