import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/crashTelemetry.ts
 *
 * Mocking strategy (mirrors chromiumFlags.test.ts):
 *   - The global `electron` mock from tests/main.setup.ts lacks
 *     `crashReporter` and `app.on`. We shadow it per test with a richer
 *     mock backed by shared vi.fn() instances at module scope.
 *   - `@main/core/platform` is shadowed per test so we can flip `isDev`.
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
  vi.doMock('@main/core/platform', () => ({
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
  processOnMock.mockReset().mockImplementation(() => process)
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

  it('leaves a session alone when its owner installs its own header policy', async () => {
    // The bug this guards: Electron keeps ONE `onHeadersReceived` per session, so this pass
    // registering on every web contents does not ADD to a session's policy, it replaces it.
    // A mini app's guest attaches after its session is configured, so the module that just
    // installed the app's CSP re-delivery would silently lose the slot to this one.
    stubConstants({ isDev: false })
    stubElectron()
    const { markSelfHardenedSession } = await import('@main/core/security/selfHardenedSessions')

    const { initCrashTelemetry } = await loadModule()
    initCrashTelemetry()

    const webContentsCall = appOnMock.mock.calls.find(([event]) => event === 'web-contents-created')
    const onHeadersReceived = vi.fn()
    const ownedSession = { webRequest: { onHeadersReceived } }
    markSelfHardenedSession(ownedSession as never)
    webContentsCall?.[1]({}, { mainFrame: { collectJavaScriptCallStack: vi.fn() }, on: vi.fn(), session: ownedSession })

    expect(onHeadersReceived).not.toHaveBeenCalled()
  })

  it('still claims the slot on a session nobody else owns', async () => {
    // The negative control: without this the case above passes just as well if the pass
    // stopped registering anywhere at all.
    stubConstants({ isDev: false })
    stubElectron()

    const { initCrashTelemetry } = await loadModule()
    initCrashTelemetry()

    const webContentsCall = appOnMock.mock.calls.find(([event]) => event === 'web-contents-created')
    const onHeadersReceived = vi.fn()
    webContentsCall?.[1](
      {},
      {
        mainFrame: { collectJavaScriptCallStack: vi.fn() },
        on: vi.fn(),
        session: { webRequest: { onHeadersReceived } }
      }
    )

    expect(onHeadersReceived).toHaveBeenCalled()
  })

  it('removes response headers that Electron net.fetch cannot convert to ByteString', async () => {
    stubConstants({ isDev: false })
    stubElectron()

    const { initCrashTelemetry } = await loadModule()
    initCrashTelemetry()

    const webContentsCall = appOnMock.mock.calls.find(([event]) => event === 'web-contents-created')
    const onHeadersReceived = vi.fn()
    const webContents = {
      mainFrame: { collectJavaScriptCallStack: vi.fn() },
      on: vi.fn(),
      session: { webRequest: { onHeadersReceived } }
    }
    webContentsCall?.[1]({}, webContents)

    const listener = onHeadersReceived.mock.calls[0]?.[0]
    const callback = vi.fn()
    listener(
      {
        responseHeaders: {
          'Content-Type': ['application/json'],
          'X-Proxy-Message': ['机器已连接']
        }
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'Content-Type': ['application/json'],
        'Document-Policy': ['include-js-call-stacks-in-crash-reports']
      }
    })
  })

  describe('production-only process error handlers', () => {
    it('installs both process.on handlers when isDev is false', async () => {
      stubConstants({ isDev: false })
      stubElectron()

      const { initCrashTelemetry } = await loadModule()
      initCrashTelemetry()

      const events = processOnMock.mock.calls.map(([event]) => event)
      expect(events).toContain('uncaughtExceptionMonitor')
      expect(events).not.toContain('uncaughtException')
      expect(events).toContain('unhandledRejection')
    })

    it('does NOT install process.on handlers when isDev is true', async () => {
      stubConstants({ isDev: true })
      stubElectron()

      const { initCrashTelemetry } = await loadModule()
      initCrashTelemetry()

      const events = processOnMock.mock.calls.map(([event]) => event)
      expect(events).not.toContain('uncaughtExceptionMonitor')
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
