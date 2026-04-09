import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/crashTelemetry.ts
 *
 * Mocking strategy (mirrors chromiumFlags.test.ts):
 *   - The global `electron` mock from tests/main.setup.ts lacks
 *     `crashReporter` and `app.on`. We shadow it per test with a richer
 *     mock backed by shared vi.fn() instances at module scope.
 *   - `@main/constant` is shadowed per test so we can flip `isDev`.
 *   - `process.on` is a Node global. We temporarily swap it with a
 *     vi.fn() during each test and restore it in afterEach. This avoids
 *     vi.spyOn's overloaded-signature type inference problems while
 *     still giving us a call log to assert against.
 *   - `@logger` is already globally mocked; no per-test mock needed.
 */

const crashReporterStartMock = vi.fn()
const appOnMock = vi.fn()
const processOnMock = vi.fn<(event: string, listener: (...args: unknown[]) => void) => NodeJS.Process>(() => process)

const originalProcessOn = process.on.bind(process)

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      on: appOnMock
    },
    crashReporter: {
      start: crashReporterStartMock
    }
  }))
}

function stubConstants(opts: { isDev: boolean }) {
  vi.doMock('@main/constant', () => ({
    isDev: opts.isDev,
    isLinux: false,
    isWin: false,
    isPortable: false,
    isMac: true
  }))
}

async function loadModule() {
  return import('../crashTelemetry')
}

beforeEach(() => {
  vi.resetModules()
  crashReporterStartMock.mockReset()
  appOnMock.mockReset()
  processOnMock
    .mockReset()
    .mockImplementation(() => process)
  // Swap process.on with our observable stub. Cast through unknown to
  // sidestep the overloaded EventEmitter.on signature.
  ;(process as unknown as { on: typeof processOnMock }).on = processOnMock
})

afterEach(() => {
  ;(process as unknown as { on: typeof originalProcessOn }).on = originalProcessOn
})

describe('initCrashTelemetry', () => {
  it('starts the local crash reporter with the expected product/company info', async () => {
    stubConstants({ isDev: false })
    stubElectron()

    const { initCrashTelemetry } = await loadModule()
    initCrashTelemetry()

    expect(crashReporterStartMock).toHaveBeenCalledTimes(1)
    expect(crashReporterStartMock).toHaveBeenCalledWith({
      companyName: 'CherryHQ',
      productName: 'CherryStudio',
      submitURL: '',
      uploadToServer: false
    })
  })

  it('registers a web-contents-created handler for webContents hardening', async () => {
    stubConstants({ isDev: false })
    stubElectron()

    const { initCrashTelemetry } = await loadModule()
    initCrashTelemetry()

    const webContentsCall = appOnMock.mock.calls.find(([event]) => event === 'web-contents-created')
    expect(webContentsCall).toBeDefined()
    expect(typeof webContentsCall?.[1]).toBe('function')
  })

  describe('production-only process error handlers', () => {
    it('installs both process.on handlers when isDev is false', async () => {
      stubConstants({ isDev: false })
      stubElectron()

      const { initCrashTelemetry } = await loadModule()
      initCrashTelemetry()

      const events = processOnMock.mock.calls.map(([event]) => event)
      expect(events).toContain('uncaughtException')
      expect(events).toContain('unhandledRejection')
    })

    it('does NOT install process.on handlers when isDev is true', async () => {
      stubConstants({ isDev: true })
      stubElectron()

      const { initCrashTelemetry } = await loadModule()
      initCrashTelemetry()

      const events = processOnMock.mock.calls.map(([event]) => event)
      expect(events).not.toContain('uncaughtException')
      expect(events).not.toContain('unhandledRejection')
    })
  })

  it('does not throw when called once with production settings', async () => {
    stubConstants({ isDev: false })
    stubElectron()

    const { initCrashTelemetry } = await loadModule()
    expect(() => initCrashTelemetry()).not.toThrow()
  })
})
