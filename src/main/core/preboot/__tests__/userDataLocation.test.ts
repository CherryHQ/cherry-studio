import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/userDataLocation.ts
 *
 * Mocking strategy:
 *   - `@main/core/platform` exposes module-level booleans (isLinux/isWin/isPortable)
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
  statSyncImpl?: (p: string) => { isDirectory: () => boolean; isFile: () => boolean }
  cpSyncImpl?: (src: string, dst: string, opts?: unknown) => void
}

type BootConfigStore = {
  'app.user_data_path'?: Record<string, string>
  'temp.user_data_relocation'?:
    | { status: 'pending'; taskId: string; from: string; to: string; copy: boolean }
    | {
        status: 'failed'
        taskId: string
        from: string
        to: string
        copy: boolean
        error: string
        failedAt: string
      }
    | null
}

const setPathMock = vi.fn()
const cpSyncMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigPersistMock = vi.fn()
const TASK_ID = '11111111-1111-4111-8111-111111111111'

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
  vi.doMock('@main/core/platform', () => ({
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
  bootConfigPersistMock.mockImplementation(() => {
    /* no-op for tests */
  })
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGetMock,
      set: bootConfigSetMock,
      persist: bootConfigPersistMock
    }
  }))
  return internal
}

function stubFs(opts: FsStubOptions = {}) {
  const existsSync = vi.fn(opts.existsSyncImpl ?? (() => true))
  const accessSync = vi.fn(opts.accessSyncImpl ?? (() => undefined))
  // isUsableDataDir() gates on statSync().isDirectory(); default to a directory.
  const statSync = vi.fn(opts.statSyncImpl ?? (() => ({ isDirectory: () => true, isFile: () => false })))
  cpSyncMock.mockImplementation(opts.cpSyncImpl ?? (() => undefined))
  vi.doMock('node:fs', () => {
    const fsMock = {
      existsSync,
      accessSync,
      statSync,
      cpSync: cpSyncMock,
      constants: { R_OK: 4, W_OK: 2, X_OK: 1 },
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
  bootConfigPersistMock.mockReset()
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
    stubElectron({ exePath: 'C:\\Program Files\\Cherry Studio\\CherryStudio.exe' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    expect(getNormalizedExecutablePath()).toBe('C:\\Program Files\\Cherry Studio\\CherryStudio.exe')
  })

  it('Windows portable: returns PORTABLE_EXECUTABLE_DIR/cherry-studio-portable.exe', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'D:\\PortableApps\\CherryStudio')
    stubConstants({ isLinux: false, isWin: true, isPortable: true })
    stubElectron({ exePath: 'D:\\PortableApps\\CherryStudio\\CherryStudio.exe' })
    stubBootConfig()
    stubFs()
    const { getNormalizedExecutablePath } = await loadModule()
    // path.join is globally mocked to args.join('/').
    expect(getNormalizedExecutablePath()).toBe('D:\\PortableApps\\CherryStudio/cherry-studio-portable.exe')
  })
})

describe('isUsableDataDir', () => {
  async function loadWithFs(opts: FsStubOptions = {}) {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron()
    stubBootConfig()
    stubFs(opts)
    return (await loadModule()).isUsableDataDir
  }

  it('returns true for a directory that is readable, writable and searchable', async () => {
    const isUsableDataDir = await loadWithFs() // default statSync → directory, accessSync → ok
    expect(isUsableDataDir('/some/dir')).toBe(true)
  })

  it('requests read, write, and execute permission together', async () => {
    let requestedMode: number | undefined
    const isUsableDataDir = await loadWithFs({
      accessSyncImpl: (_p, mode) => {
        requestedMode = mode
      }
    })
    expect(isUsableDataDir('/some/dir')).toBe(true)
    // R_OK(4) | W_OK(2) | X_OK(1) = 7
    expect(requestedMode).toBe(7)
  })

  it('returns false when the path is a file, not a directory', async () => {
    const isUsableDataDir = await loadWithFs({
      statSyncImpl: () => ({ isDirectory: () => false, isFile: () => true })
    })
    expect(isUsableDataDir('/some/file')).toBe(false)
  })

  it('returns false when the directory is not read-writable (accessSync throws)', async () => {
    const isUsableDataDir = await loadWithFs({
      accessSyncImpl: () => {
        throw new Error('EACCES')
      }
    })
    expect(isUsableDataDir('/readonly/dir')).toBe(false)
  })

  it('returns false when the directory lacks search (X_OK) permission', async () => {
    const isUsableDataDir = await loadWithFs({
      accessSyncImpl: (_p, mode) => {
        if (typeof mode === 'number' && mode & 1 /* X_OK */) throw new Error('EACCES')
      }
    })
    expect(isUsableDataDir('/no-exec/dir')).toBe(false)
  })

  it('returns false when the path does not exist (statSync throws)', async () => {
    const isUsableDataDir = await loadWithFs({
      statSyncImpl: () => {
        throw new Error('ENOENT: no such file or directory')
      }
    })
    expect(isUsableDataDir('/missing')).toBe(false)
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

    it('app.isPackaged=false: appends configured dev suffix', async () => {
      vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', 'DevQuito')
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ isPackaged: false, userData: '/mock/userData' })
      stubBootConfig()
      stubFs()
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).toHaveBeenCalledWith('userData', '/mock/userDataDevQuito')
      expect(setPathMock).toHaveBeenCalledTimes(1)
    })

    it('app.isPackaged=false: blank configured dev suffix falls back to Dev', async () => {
      vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', '   ')
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ isPackaged: false, userData: '/mock/userData' })
      stubBootConfig()
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

    it('BootConfig has matching exe but path is missing (statSync throws): falls through, no setPath', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
      stubFs({
        statSyncImpl: () => {
          throw new Error('ENOENT: no such file or directory')
        }
      })
      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()
      expect(setPathMock).not.toHaveBeenCalled()
    })

    it('BootConfig has matching exe but path is a file, not a directory: falls through, no setPath', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
      stubFs({ statSyncImpl: () => ({ isDirectory: () => false, isFile: () => true }) })
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
      stubElectron({ exePath: 'D:\\PortableApps\\CherryStudio\\CherryStudio.exe' })
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
      stubElectron({ exePath: 'D:\\PortableApps\\CherryStudio\\CherryStudio.exe' })
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

  // The BootConfig commit itself moved to services/userDataRelocation and is
  // covered there (execution.test.ts) through the full relocation flow.
  describe('relocation state handling', () => {
    it('resolveUserDataLocation does not execute a pending relocation', async () => {
      stubConstants({ isLinux: false, isWin: false, isPortable: false })
      stubElectron({ exePath: '/mock/exe' })
      const store = stubBootConfig({
        'app.user_data_path': { '/mock/exe': '/old/data' },
        'temp.user_data_relocation': {
          status: 'pending',
          taskId: TASK_ID,
          from: '/old/data',
          to: '/new/data',
          copy: true
        }
      })
      stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })

      const { resolveUserDataLocation } = await loadModule()
      resolveUserDataLocation()

      expect(cpSyncMock).not.toHaveBeenCalled()
      expect(store['temp.user_data_relocation']).toEqual({
        status: 'pending',
        taskId: TASK_ID,
        from: '/old/data',
        to: '/new/data',
        copy: true
      })
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
          taskId: TASK_ID,
          from: '/old/data',
          to: '/new/data',
          copy: true,
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
        'temp.user_data_relocation': {
          status: 'pending',
          taskId: TASK_ID,
          from: '/old/data',
          to: '/new/data',
          copy: true
        }
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
