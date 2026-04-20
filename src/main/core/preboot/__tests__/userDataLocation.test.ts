import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/userDataLocation.ts
 *
 * Mocking strategy:
 *   - `@main/constant` exposes module-level booleans (isLinux/isWin/isPortable)
 *     computed at evaluation time. We use `vi.doMock` + `vi.resetModules()` and
 *     dynamically import the module-under-test in each test, so we can swap
 *     platform values per scenario.
 *   - The global `electron` mock from tests/main.setup.ts lacks `setPath` and
 *     `isPackaged`. We shadow it via `vi.doMock('electron', ...)` per test.
 *   - The global `node:fs` mock lacks `accessSync` and `cpSync`. We shadow it
 *     per test with a full mock that exposes both.
 *   - `@main/data/bootConfig` is not globally mocked. We mock it per test with
 *     vi.fn stubs for get/set/flush.
 *   - `@logger` is already globally mocked in tests/main.setup.ts; we leave it.
 */

interface PlatformFlags {
  isLinux: boolean
  isWin: boolean
  isPortable: boolean
}

interface ElectronStubOptions {
  isPackaged?: boolean
  exePath?: string
  userData?: string
}

interface FsStubOptions {
  existsSyncImpl?: (p: string) => boolean
  accessSyncImpl?: (p: string, mode?: number) => void
  cpSyncImpl?: (src: string, dst: string, opts?: unknown) => void
}

type BootConfigStore = {
  'app.user_data_path'?: Record<string, string>
  'temp.user_data_relocation'?:
    | { status: 'pending'; from: string; to: string }
    | {
        status: 'failed'
        from: string
        to: string
        error: string
        failedAt: string
      }
    | null
}

const setPathMock = vi.fn()
const cpSyncMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()

function stubElectron(opts: ElectronStubOptions = {}) {
  const { isPackaged = true, exePath = '/mock/exe', userData = '/mock/userData' } = opts
  const getPath = vi.fn((key: string) => {
    if (key === 'exe') return exePath
    if (key === 'userData') return userData
    return '/mock/unknown'
  })
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      isPackaged,
      getPath,
      setPath: setPathMock
    }
  }))
}

function stubConstants(flags: PlatformFlags) {
  vi.doMock('@main/constant', () => ({
    isLinux: flags.isLinux,
    isWin: flags.isWin,
    isPortable: flags.isPortable,
    isMac: !flags.isLinux && !flags.isWin,
    isDev: false
  }))
}

function stubBootConfig(store: BootConfigStore = {}) {
  // Mutable store so set() affects subsequent get() calls in the same test.
  const internal: BootConfigStore = { ...store }
  bootConfigGetMock.mockImplementation((key: string) => {
    return (internal as Record<string, unknown>)[key]
  })
  bootConfigSetMock.mockImplementation((key: string, value: unknown) => {
    ;(internal as Record<string, unknown>)[key] = value
  })
  bootConfigFlushMock.mockImplementation(() => {
    /* no-op for tests */
  })
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGetMock,
      set: bootConfigSetMock,
      flush: bootConfigFlushMock
    }
  }))
  return internal
}

function stubFs(opts: FsStubOptions = {}) {
  const existsSync = vi.fn(opts.existsSyncImpl ?? (() => true))
  const accessSync = vi.fn(opts.accessSyncImpl ?? (() => undefined))
  cpSyncMock.mockImplementation(opts.cpSyncImpl ?? (() => undefined))
  vi.doMock('node:fs', () => {
    const fsMock = {
      existsSync,
      accessSync,
      cpSync: cpSyncMock,
      constants: { W_OK: 2 },
      promises: {
        access: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn()
      },
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn()
    }
    return { ...fsMock, default: fsMock }
  })
}

async function loadModule() {
  return import('../userDataLocation')
}

beforeEach(() => {
  vi.resetModules()
  setPathMock.mockReset()
  cpSyncMock.mockReset()
  bootConfigGetMock.mockReset()
  bootConfigSetMock.mockReset()
  bootConfigFlushMock.mockReset()
})

afterEach(() => {
  // Intentionally NOT calling vi.doUnmock(...) here.
  //
  // vi.doUnmock is not a clean inverse of vi.doMock — combined with the
  // next test's beforeEach vi.resetModules(), it can create a race where
  // a dynamic import sees the real module before the next vi.doMock
  // takes effect, producing hard-to-debug cross-test leakage.
  //
  // The robust pattern is: resetModules() in beforeEach + fresh
  // vi.doMock() inside each test (via the stub* helpers below). The
  // previous test's vi.doMock registration is naturally overwritten by
  // the next test's, and resetModules() guarantees re-evaluation.
  vi.unstubAllEnvs()
})

describe('getNormalizedExecutablePath', () => {
  it('macOS: returns app.getPath("exe") verbatim', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    expect(getNormalizedExecutablePath()).toBe('/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio')
  })

  it('Linux without APPIMAGE env: returns app.getPath("exe") verbatim', async () => {
    vi.stubEnv('APPIMAGE', '')
    stubConstants({ isLinux: true, isWin: false, isPortable: false })
    stubElectron({ exePath: '/usr/bin/cherry-studio' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    expect(getNormalizedExecutablePath()).toBe('/usr/bin/cherry-studio')
  })

  it('Linux with APPIMAGE env: returns normalized AppImage path', async () => {
    vi.stubEnv('APPIMAGE', '/home/alice/Applications/CherryStudio-1.0.0.AppImage')
    stubConstants({ isLinux: true, isWin: false, isPortable: false })
    stubElectron({ exePath: '/tmp/.mount_xxxx/usr/bin/cherry-studio' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    // path.join is globally mocked to args.join('/'); path.dirname is real.
    expect(getNormalizedExecutablePath()).toBe('/home/alice/Applications/cherry-studio.appimage')
  })

  it('Windows non-portable: returns app.getPath("exe") verbatim', async () => {
    stubConstants({ isLinux: false, isWin: true, isPortable: false })
    stubElectron({ exePath: 'C:\\Program Files\\Cherry Studio\\Cherry Studio.exe' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    expect(getNormalizedExecutablePath()).toBe('C:\\Program Files\\Cherry Studio\\Cherry Studio.exe')
  })

  it('Windows portable: returns PORTABLE_EXECUTABLE_DIR/cherry-studio-portable.exe', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'D:\\PortableApps\\CherryStudio')
    stubConstants({ isLinux: false, isWin: true, isPortable: true })
    stubElectron({ exePath: 'D:\\PortableApps\\CherryStudio\\Cherry Studio.exe' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    // path.join is globally mocked to args.join('/').
    expect(getNormalizedExecutablePath()).toBe('D:\\PortableApps\\CherryStudio/cherry-studio-portable.exe')
  })
})

describe('resolveUserDataLocation', () => {
  describe('normal resolution (no pending relocation)', () => {
    it('app.isPackaged=false: appends Dev suffix and ignores BootConfig', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ isPackaged: false, userData: '/mock/userData' })
      // BootConfig is populated but should be ignored — the dev branch runs
      // before any BootConfig lookup, isolating dev data from production
      // config that might have been migrated by a packaged build of the app.
      stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
      stubFs()
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).toHaveBeenCalledWith('userData', '/mock/userDataDev')
      expect(setPathMock).toHaveBeenCalledTimes(1)
    })

    it('BootConfig has matching exe with valid path: setPath called with that path', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).toHaveBeenCalledWith('userData', '/custom/data')
      expect(setPathMock).toHaveBeenCalledTimes(1)
    })

    it('BootConfig has matching exe but path is invalid (existsSync false): falls through, no setPath', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
      stubFs({ existsSyncImpl: () => false })
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).not.toHaveBeenCalled()
    })

    it('BootConfig has matching exe but path is not writable (accessSync throws): falls through, no setPath', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
      stubFs({
        existsSyncImpl: () => true,
        accessSyncImpl: () => {
          throw new Error('EACCES')
        }
      })
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).not.toHaveBeenCalled()
    })

    it('BootConfig has no matching exe key: falls through, no setPath', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': { '/other/exe': '/custom/data' } })
      stubFs()
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).not.toHaveBeenCalled()
    })

    it('BootConfig empty + isPortable=true: setPath called with portableDir/data', async () => {
      vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'D:\\PortableApps\\CherryStudio')
      stubConstants({ isLinux: false, isWin: true, isPortable: true })
      stubElectron({ exePath: 'D:\\PortableApps\\CherryStudio\\Cherry Studio.exe' })
      stubBootConfig({ 'app.user_data_path': {} })
      stubFs()
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).toHaveBeenCalledWith('userData', 'D:\\PortableApps\\CherryStudio/data')
      expect(setPathMock).toHaveBeenCalledTimes(1)
    })

    it('BootConfig empty + non-portable: no-op (falls through to Electron default)', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': {} })
      stubFs()
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).not.toHaveBeenCalled()
    })

    it('AppImage normalized key matches in BootConfig: setPath called', async () => {
      vi.stubEnv('APPIMAGE', '/home/alice/Apps/CherryStudio-1.0.0.AppImage')
      stubConstants({ isLinux: true, isWin: false, isPortable: false })
      stubElectron({ exePath: '/tmp/.mount_abc/usr/bin/cherry-studio' })
      // Key matches the *normalized* path, not raw exe.
      stubBootConfig({
        'app.user_data_path': {
          '/home/alice/Apps/cherry-studio.appimage': '/home/alice/cherry-data'
        }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).toHaveBeenCalledWith('userData', '/home/alice/cherry-data')
    })

    it('Windows portable normalized key matches in BootConfig: setPath called', async () => {
      vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'D:\\PortableApps\\CherryStudio')
      stubConstants({ isLinux: false, isWin: true, isPortable: true })
      stubElectron({ exePath: 'D:\\PortableApps\\CherryStudio\\Cherry Studio.exe' })
      stubBootConfig({
        'app.user_data_path': {
          'D:\\PortableApps\\CherryStudio/cherry-studio-portable.exe': 'D:\\Data\\Cherry'
        }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).toHaveBeenCalledWith('userData', 'D:\\Data\\Cherry')
    })
  })

  describe('pending relocation', () => {
    it('pending relocation success: cpSync called, user_data_path updated, temp cleared, setPath to new', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': {},
        'temp.user_data_relocation': { status: 'pending', from: '/old/data', to: '/new/data' }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      // cpSync was called with from → to + the v2 option set (no errorOnExist).
      expect(cpSyncMock).toHaveBeenCalledWith('/old/data', '/new/data', {
        recursive: true,
        force: true,
        verbatimSymlinks: true
      })
      // After commit, user_data_path has the new mapping.
      expect(store['app.user_data_path']).toEqual({ '/mock/exe': '/new/data' })
      // temp cleared to null.
      expect(store['temp.user_data_relocation']).toBe(null)
      // flush was called at least once after commit.
      expect(bootConfigFlushMock).toHaveBeenCalled()
      // setPath called with the new path (Step 2 re-reads the now-updated map).
      expect(setPathMock).toHaveBeenCalledWith('userData', '/new/data')
    })

    it('pending relocation: from === to → pre-flight fails, no cpSync, marked as failed', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/custom/data' },
        'temp.user_data_relocation': { status: 'pending', from: '/same/path', to: '/same/path' }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      // cpSync NOT called — pre-flight rejected the request.
      expect(cpSyncMock).not.toHaveBeenCalled()
      // Marked as failed with a descriptive error.
      const recorded = store['temp.user_data_relocation']
      expect(recorded).toMatchObject({
        status: 'failed',
        from: '/same/path',
        to: '/same/path'
      })
      expect(recorded && 'error' in recorded && recorded.error).toMatch(/same path/i)
      // user_data_path unchanged.
      expect(store['app.user_data_path']).toEqual({ '/mock/exe': '/custom/data' })
      // Step 2 fell through to the previous path.
      expect(setPathMock).toHaveBeenCalledWith('userData', '/custom/data')
    })

    it('pending relocation: to is inside from → pre-flight fails, no cpSync, marked as failed', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/old' },
        'temp.user_data_relocation': { status: 'pending', from: '/old', to: '/old/subdir' }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      expect(cpSyncMock).not.toHaveBeenCalled()
      const recorded = store['temp.user_data_relocation']
      expect(recorded).toMatchObject({ status: 'failed' })
      expect(recorded && 'error' in recorded && recorded.error).toMatch(/inside source|recurse/i)
    })

    it('pending relocation: sibling prefix (e.g. /a vs /ab) is NOT rejected by inside-source check', async () => {
      // Regression guard: naive startsWith('/a') would false-positive on '/ab'.
      // The path.sep guard must prevent this.
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({
        'app.user_data_path': {},
        'temp.user_data_relocation': { status: 'pending', from: '/a', to: '/ab' }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      // cpSync WAS called — /ab is a sibling, not a child of /a.
      expect(cpSyncMock).toHaveBeenCalledWith('/a', '/ab', {
        recursive: true,
        force: true,
        verbatimSymlinks: true
      })
    })

    it('pending relocation: source does not exist → pre-flight fails, no cpSync, marked as failed', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/existing/data' },
        'temp.user_data_relocation': {
          status: 'pending',
          from: '/missing/source',
          to: '/new/target'
        }
      })
      stubFs({
        // `from` doesn't exist; anything else (like `to` parent) does.
        existsSyncImpl: (p: string) => p !== '/missing/source',
        accessSyncImpl: () => undefined
      })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      expect(cpSyncMock).not.toHaveBeenCalled()
      const recorded = store['temp.user_data_relocation']
      expect(recorded).toMatchObject({ status: 'failed', from: '/missing/source' })
      expect(recorded && 'error' in recorded && recorded.error).toMatch(/source does not exist/i)
      // Fell through to the existing old path.
      expect(setPathMock).toHaveBeenCalledWith('userData', '/existing/data')
    })

    it('pending relocation: target parent does not exist → pre-flight fails, no cpSync, marked as failed', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': {},
        'temp.user_data_relocation': {
          status: 'pending',
          from: '/old/data',
          to: '/nonexistent/parent/newdata'
        }
      })
      stubFs({
        // `from` exists; target parent `/nonexistent/parent` does NOT.
        existsSyncImpl: (p: string) => p === '/old/data',
        accessSyncImpl: () => undefined
      })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      expect(cpSyncMock).not.toHaveBeenCalled()
      const recorded = store['temp.user_data_relocation']
      expect(recorded).toMatchObject({ status: 'failed' })
      expect(recorded && 'error' in recorded && recorded.error).toMatch(/target parent.*does not exist/i)
    })

    it('pending relocation: target parent not writable → pre-flight fails, no cpSync, marked as failed', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': {},
        'temp.user_data_relocation': {
          status: 'pending',
          from: '/old/data',
          to: '/readonly/newdata'
        }
      })
      stubFs({
        existsSyncImpl: () => true,
        accessSyncImpl: (p: string) => {
          if (p === '/readonly') throw new Error('EACCES: permission denied')
        }
      })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      expect(cpSyncMock).not.toHaveBeenCalled()
      const recorded = store['temp.user_data_relocation']
      expect(recorded).toMatchObject({ status: 'failed' })
      expect(recorded && 'error' in recorded && recorded.error).toMatch(/EACCES/)
    })

    it('pending relocation failure (cpSync throws): failed state recorded, user_data_path unchanged, fall through to old location', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/old/data' },
        'temp.user_data_relocation': { status: 'pending', from: '/old/data', to: '/new/data' }
      })
      stubFs({
        existsSyncImpl: () => true,
        accessSyncImpl: () => undefined,
        cpSyncImpl: () => {
          throw new Error('ENOSPC')
        }
      })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      // cpSync was attempted.
      expect(cpSyncMock).toHaveBeenCalled()
      // user_data_path NOT updated to new — still the old value.
      expect(store['app.user_data_path']).toEqual({ '/mock/exe': '/old/data' })
      // temp was marked as failed (not null, not still pending).
      const recorded = store['temp.user_data_relocation']
      expect(recorded).toMatchObject({
        status: 'failed',
        from: '/old/data',
        to: '/new/data',
        error: 'ENOSPC'
      })
      // failedAt is an ISO timestamp.
      expect(recorded && 'failedAt' in recorded && typeof recorded.failedAt === 'string').toBe(true)
      // flush was called after marking failed.
      expect(bootConfigFlushMock).toHaveBeenCalled()
      // Step 2 fell through to the existing user_data_path (old location).
      expect(setPathMock).toHaveBeenCalledWith('userData', '/old/data')
    })

    it('temp.user_data_relocation is null: no relocation attempted, normal resolution proceeds', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/custom/data' },
        'temp.user_data_relocation': null
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      expect(cpSyncMock).not.toHaveBeenCalled()
      expect(setPathMock).toHaveBeenCalledWith('userData', '/custom/data')
    })

    it('temp.user_data_relocation is in failed state: no auto-retry, normal resolution proceeds', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/old/data' },
        'temp.user_data_relocation': {
          status: 'failed',
          from: '/old/data',
          to: '/new/data',
          error: 'EACCES',
          failedAt: '2026-04-07T00:00:00.000Z'
        }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      // cpSync was NOT called — failed states are not auto-retried.
      expect(cpSyncMock).not.toHaveBeenCalled()
      // Normal resolution used the old path.
      expect(setPathMock).toHaveBeenCalledWith('userData', '/old/data')
    })

    it('app.isPackaged=false: pending relocation is bypassed, dev suffix still applied', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ isPackaged: false, userData: '/mock/userData' })
      stubBootConfig({
        'app.user_data_path': {},
        'temp.user_data_relocation': { status: 'pending', from: '/old/data', to: '/new/data' }
      })
      stubFs({ existsSyncImpl: () => true })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      // Regression guard: the dev branch must run BEFORE the relocation
      // logic, otherwise a stale pending relocation in BootConfig would
      // mutate the dev userData. cpSync should never run in dev mode.
      expect(cpSyncMock).not.toHaveBeenCalled()
      // setPath is still called — but with the Dev suffix, not the
      // relocation target.
      expect(setPathMock).toHaveBeenCalledWith('userData', '/mock/userDataDev')
      expect(setPathMock).toHaveBeenCalledTimes(1)
    })
  })
})
