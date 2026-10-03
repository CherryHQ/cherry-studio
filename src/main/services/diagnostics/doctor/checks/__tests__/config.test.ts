import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bootConfig = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), getLoadError: vi.fn(), repair: vi.fn() }))
const scan = vi.hoisted(() => ({ collectErrorLogRecords: vi.fn() }))
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: bootConfig }))
vi.mock('@main/services/diagnostics/scan', async (importOriginal) => ({ ...(await importOriginal<object>()), ...scan }))

const { bootConfigValid, hardwareAcceleration } = await import('../config')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

beforeEach(() => {
  vi.clearAllMocks()
  bootConfig.get.mockReturnValue(false)
  scan.collectErrorLogRecords.mockResolvedValue({
    records: [],
    truncated: false,
    unparsedLineCount: 0,
    skippedFileCount: 0
  })
})

afterEach(() => vi.restoreAllMocks())

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

describe('config-hardware-acceleration', () => {
  it('passes silently while hardware acceleration is enabled', async () => {
    await expect(hardwareAcceleration.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(scan.collectErrorLogRecords).not.toHaveBeenCalled()
  })

  it('navigates to settings to re-enable acceleration when no renderer crash occurred in seven days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
    bootConfig.get.mockReturnValue(true)

    await expect(hardwareAcceleration.run(ctx)).resolves.toEqual({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'disabled_without_recent_crash' },
      actions: [{ kind: 'navigate', target: '/settings/general' }]
    })
    expect(scan.collectErrorLogRecords).toHaveBeenCalledWith(
      '/mock/app.logs',
      {
        fromMs: 1_999_395_200_000,
        toMs: 2_000_000_000_000
      },
      signal
    )
  })

  it('does not recommend acceleration when a recent renderer crash may justify the setting', async () => {
    bootConfig.get.mockReturnValue(true)
    scan.collectErrorLogRecords.mockResolvedValue({
      records: [
        { level: 'error', timestampMs: Date.now(), message: 'Renderer process crashed with: {"reason":"crashed"}' }
      ],
      truncated: false,
      unparsedLineCount: 0,
      skippedFileCount: 0
    })

    await expect(hardwareAcceleration.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('does not suggest enabling acceleration from incomplete crash evidence', async () => {
    bootConfig.get.mockReturnValue(true)
    scan.collectErrorLogRecords.mockResolvedValue({
      records: [],
      truncated: false,
      unparsedLineCount: 0,
      skippedFileCount: 1
    })
    await expect(hardwareAcceleration.run(ctx)).rejects.toThrow('incomplete')
  })
})
