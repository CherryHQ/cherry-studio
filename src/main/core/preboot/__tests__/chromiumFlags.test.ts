import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootConfigSchema, DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'

/**
 * Tests for src/main/core/preboot/chromiumFlags.ts
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `@main/core/platform` exposes module-level booleans (isLinux/isWin/etc.)
 *     computed at evaluation time. We use `vi.doMock` + `vi.resetModules()` and
 *     dynamically import the module-under-test in each test, so we can swap
 *     platform values per scenario.
 *   - The global `electron` mock from tests/main.setup.ts lacks the specific
 *     `app.disableHardwareAcceleration` and `app.commandLine.appendSwitch`
 *     methods we need to assert on. We shadow it with `vi.doMock('electron', …)`
 *     per test, backed by shared vi.fn() instances at module scope.
 *   - `@main/data/bootConfig` is not globally mocked. We provide a per-test stub
 *     whose `get()` returns whatever `app.disable_hardware_acceleration` value
 *     the scenario needs.
 *   - `process.env.XDG_SESSION_TYPE` is controlled via `vi.stubEnv()`, which is
 *     automatically unstubbed in afterEach to prevent cross-test leakage.
 */

interface PlatformFlags {
  isLinux: boolean
  isWin: boolean
}

const disableHardwareAccelerationMock = vi.fn()
const appendSwitchMock = vi.fn()
const hasSwitchMock = vi.fn()
const bootConfigGetMock = vi.fn()

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      disableHardwareAcceleration: disableHardwareAccelerationMock,
      commandLine: {
        appendSwitch: appendSwitchMock,
        hasSwitch: hasSwitchMock
      }
    }
  }))
}

function stubConstants(flags: PlatformFlags) {
  vi.doMock('@main/core/platform', () => ({
    isLinux: flags.isLinux,
    isLinuxWayland: flags.isLinux && process.env.XDG_SESSION_TYPE === 'wayland',
    isWin: flags.isWin,
    isPortable: false,
    isMac: !flags.isLinux && !flags.isWin,
    isDev: false
  }))
}

function stubBootConfig(
  opts: { disableHardwareAcceleration?: boolean; remoteDebuggingEnabled?: boolean; remoteDebuggingPort?: number } = {}
) {
  bootConfigGetMock.mockImplementation((key: string) => {
    if (key === 'app.disable_hardware_acceleration') {
      return opts.disableHardwareAcceleration ?? false
    }
    if (key === 'app.remote_debugging.enabled') return opts.remoteDebuggingEnabled ?? false
    if (key === 'app.remote_debugging.port') return opts.remoteDebuggingPort ?? 9222
    return undefined
  })
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGetMock
    }
  }))
}

async function loadModule() {
  return import('../chromiumFlags')
}

beforeEach(() => {
  vi.resetModules()
  disableHardwareAccelerationMock.mockReset()
  appendSwitchMock.mockReset()
  hasSwitchMock.mockReset()
  bootConfigGetMock.mockReset()
})

afterEach(() => {
  // Intentionally NOT calling vi.doUnmock(...) — see userDataLocation.test.ts
  // for the rationale. resetModules() in beforeEach + fresh vi.doMock() in
  // each test is the robust pattern.
  vi.unstubAllEnvs()
})

describe('configureChromiumFlags', () => {
  describe('local CDP startup setting', () => {
    it('uses a saved custom port when no startup port is supplied', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig({ remoteDebuggingEnabled: true, remoteDebuggingPort: 9342 })
      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()
      expect(appendSwitchMock).toHaveBeenCalledWith('remote-debugging-port', '9342')
      expect(appendSwitchMock).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1')
    })

    it.each([0, 65536, 1.5, '9222', NaN])('rejects an invalid configured port: %s', (port) => {
      expect(bootConfigSchema.safeParse({ ...DefaultBootConfig, 'app.remote_debugging.port': port }).success).toBe(
        false
      )
    })

    it('does not enable a listener by default', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig()
      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()
      expect(appendSwitchMock.mock.calls.filter(([name]) => name.startsWith('remote-debugging-'))).toEqual([])
    })

    it('opens the default port only on loopback when enabled', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig({ remoteDebuggingEnabled: true })
      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()
      expect(appendSwitchMock).toHaveBeenCalledWith('remote-debugging-port', '9222')
      expect(appendSwitchMock).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1')
    })

    it('preserves an explicit startup port and constrains its address to loopback', async () => {
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig({ remoteDebuggingEnabled: true })
      hasSwitchMock.mockImplementation((name: string) => name === 'remote-debugging-port')
      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()
      expect(appendSwitchMock).not.toHaveBeenCalledWith('remote-debugging-port', expect.anything())
      expect(appendSwitchMock).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1')
    })
  })

  describe('hardware acceleration toggle', () => {
    it('calls disableHardwareAcceleration() when BootConfig flag is true', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig({ disableHardwareAcceleration: true })

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT call disableHardwareAcceleration() when BootConfig flag is false', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig({ disableHardwareAcceleration: false })

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).not.toHaveBeenCalled()
    })

    it('does NOT call disableHardwareAcceleration() when BootConfig flag is undefined', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig() // no opts → get() returns undefined

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).not.toHaveBeenCalled()
    })
  })

  describe('platform-specific switches', () => {
    it('Windows: appends wm-window-animations-disabled but no Linux switches', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('wm-window-animations-disabled')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('name', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('enable-features', 'GlobalShortcutsPortal')
    })

    it('Linux X11: appends class/name but NOT GlobalShortcutsPortal', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'x11')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).toHaveBeenCalledWith('name', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('enable-features', 'GlobalShortcutsPortal')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('wm-window-animations-disabled')
    })

    it('Linux Wayland: appends class/name AND GlobalShortcutsPortal', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('enable-features', 'GlobalShortcutsPortal')
      expect(appendSwitchMock).toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).toHaveBeenCalledWith('name', 'CherryStudio')
    })

    it('macOS: appends NO platform-specific switches', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).not.toHaveBeenCalledWith('wm-window-animations-disabled')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('name', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('enable-features', 'GlobalShortcutsPortal')
    })
  })

  describe('unconditional feature flags', () => {
    const UNCONDITIONAL_FEATURES =
      'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync,PageAllocatorRetryOnCommitFailure'

    it('always appends the unconditional enable-features flag on macOS', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('enable-features', UNCONDITIONAL_FEATURES)
    })

    it('always appends the unconditional enable-features flag on Windows', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('enable-features', UNCONDITIONAL_FEATURES)
    })

    it('always appends the unconditional enable-features flag on Linux Wayland', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('enable-features', UNCONDITIONAL_FEATURES)
    })
  })

  describe('all off baseline', () => {
    it('macOS with BootConfig off: only the unconditional feature flag is appended', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig({ disableHardwareAcceleration: false })

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).not.toHaveBeenCalled()
      // Only the unconditional enable-features call: 1 total.
      expect(appendSwitchMock).toHaveBeenCalledTimes(1)
      expect(appendSwitchMock).toHaveBeenCalledWith(
        'enable-features',
        'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync,PageAllocatorRetryOnCommitFailure'
      )
    })
  })
})
