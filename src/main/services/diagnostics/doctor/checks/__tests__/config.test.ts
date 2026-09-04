import { beforeEach, describe, expect, it, vi } from 'vitest'

const bootConfig = vi.hoisted(() => ({ getLoadError: vi.fn(), repair: vi.fn() }))
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: bootConfig }))

const { bootConfigValid } = await import('../config')
const signal = new AbortController().signal
const ctx = { signal, share: (_key: string, factory: (signal: AbortSignal) => Promise<never>) => factory(signal) }

beforeEach(() => vi.clearAllMocks())

describe('config-boot-config-valid', () => {
  it('passes when the boot config loaded cleanly', async () => {
    bootConfig.getLoadError.mockReturnValue(null)
    await expect(bootConfigValid.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns with the invalid key count and offers repair on a validation error', async () => {
    bootConfig.getLoadError.mockReturnValue({
      type: 'validation_error',
      message: 'bad values',
      filePath: '/x',
      invalidKeys: ['app.language', 'app.theme']
    })
    await expect(bootConfigValid.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'invalid_keys', params: { count: 2 } },
      actions: [{ kind: 'fix', fixId: 'repair' }],
      evidence: [
        { key: 'invalidKeys', value: 'app.language, app.theme', dataClass: 'public' },
        { key: 'filePath', value: '/x', dataClass: 'local_only' }
      ]
    })
  })

  it('maps a parse error to its own detail variant', async () => {
    bootConfig.getLoadError.mockReturnValue({ type: 'parse_error', message: 'not json', filePath: '/x' })
    await expect(bootConfigValid.run(ctx)).resolves.toMatchObject({ detail: { variant: 'parse_error' } })
  })

  it('repair persists the config and asks for a relaunch', async () => {
    await expect(bootConfigValid.fixes.repair(ctx)).resolves.toEqual({ status: 'requires_relaunch' })
    expect(bootConfig.repair).toHaveBeenCalledOnce()
  })
})
