import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/userDataLocation.ts
 *
 * The pending-relocation *execution* (copy + commit) moved to the preboot
 * relocation gate — see relocation/__tests__/relocationGate.test.ts. This
 * file covers the path-resolution side and the two write helpers
 * (`requestRelocation` for the IPC layer, `commitRelocation` for the gate).
 *
 * Mocking strategy:
 *   - `@main/core/platform` exposes module-level booleans (isLinux/isWin/isPortable)
 *     computed at evaluation time. We use `vi.doMock` + `vi.resetModules()` and
 *     dynamically import the module-under-test in each test, so we can swap
 *     platform values per scenario.
 *   - The global `electron` mock from tests/main.setup.ts lacks `setPath` and
 *     `isPackaged`. We shadow it via `vi.doMock('electron', ...)` per test.
 *   - The global `node:fs` mock lacks `accessSync`. We shadow it per test.
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
  lstatSyncImpl?: (p: string) => { isSymbolicLink?: () => boolean }
  statSyncImpl?: (p: string) => { isDirectory?: () => boolean }
}

type BootConfigStore = {
  'app.user_data_path'?: Record<string, string>
  'temp.user_data_relocation'?:
    | { status: 'pending'; from: string; to: string; copy: boolean }
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
  const lstatSync = vi.fn(opts.lstatSyncImpl ?? (() => ({ isSymbolicLink: () => false })))
  const statSync = vi.fn(opts.statSyncImpl ?? (() => ({ isDirectory: () => true })))
  vi.doMock('node:fs', () => {
    const fsMock = {
      existsSync,
      accessSync,
      lstatSync,
      statSync,
      constants: { W_OK: 2, R_OK: 4 },
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
  bootConfigGetMock.mockReset()
  bootConfigSetMock.mockReset()
  bootConfigFlushMock.mockReset()
})

afterEach(() => {
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

describe('requestRelocation', () => {
  it('writes a pending request with from/to/copy and flushes', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    const store = stubBootConfig({})
    stubFs()
    const { requestRelocation } = await loadModule()
    requestRelocation('/old/data/../data', '/new/data/../data', true)
    expect(store['temp.user_data_relocation']).toEqual({
      status: 'pending',
      from: '/old/data',
      to: '/new/data',
      copy: true
    })
    expect(bootConfigFlushMock).toHaveBeenCalled()
    // requestRelocation never mutates the live path — relocation runs in
    // preboot on the next launch.
    expect(setPathMock).not.toHaveBeenCalled()
  })

  it('rejects relative relocation paths before persisting', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    const store = stubBootConfig({})
    stubFs()
    const { requestRelocation } = await loadModule()
    expect(() => requestRelocation('old/data', '/new/data', true)).toThrow(/must be absolute/i)
    expect(store['temp.user_data_relocation']).toBeUndefined()
    expect(bootConfigFlushMock).not.toHaveBeenCalled()
  })

  it('copy=false is recorded faithfully', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    const store = stubBootConfig({})
    stubFs()
    const { requestRelocation } = await loadModule()
    requestRelocation('/old/data', '/new/data', false)
    expect(store['temp.user_data_relocation']).toMatchObject({ copy: false })
  })
})

describe('commitRelocation', () => {
  it('sets app.user_data_path[exe]=target, clears temp, flushes', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    const store = stubBootConfig({
      'temp.user_data_relocation': { status: 'pending', from: '/old/data', to: '/new/data', copy: true }
    })
    stubFs()
    const { commitRelocation } = await loadModule()
    commitRelocation('/new/data/../data')
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': '/new/data' })
    expect(store['temp.user_data_relocation']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })

  it('merges with existing exe entries without clobbering siblings', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    const store = stubBootConfig({
      'app.user_data_path': { '/other/exe': '/other/data' }
    })
    stubFs()
    const { commitRelocation } = await loadModule()
    commitRelocation('/new/data')
    expect(store['app.user_data_path']).toEqual({
      '/other/exe': '/other/data',
      '/mock/exe': '/new/data'
    })
  })

  it('AppImage build keys by the normalized AppImage path', async () => {
    vi.stubEnv('APPIMAGE', '/home/alice/Apps/CherryStudio-1.0.0.AppImage')
    stubConstants({ isLinux: true, isWin: false, isPortable: false })
    stubElectron({ exePath: '/tmp/.mount_abc/usr/bin/cherry-studio' })
    const store = stubBootConfig({})
    stubFs()
    const { commitRelocation } = await loadModule()
    commitRelocation('/home/alice/cherry-data')
    expect(store['app.user_data_path']).toEqual({
      '/home/alice/Apps/cherry-studio.appimage': '/home/alice/cherry-data'
    })
  })

  it('clears the committed entry for the current executable', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    const store = stubBootConfig({
      'app.user_data_path': { '/mock/exe': '/custom/data', '/other/exe': '/other/data' }
    })
    stubFs()
    const { clearCommittedUserDataLocation } = await loadModule()
    clearCommittedUserDataLocation()
    expect(store['app.user_data_path']).toEqual({ '/other/exe': '/other/data' })
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })
})

describe('resolveUserDataLocation', () => {
  it('app.isPackaged=false: appends Dev suffix and ignores BootConfig', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ isPackaged: false, userData: '/mock/userData' })
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

  it('BootConfig has matching exe but path is relative: throws before fallback', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    stubBootConfig({ 'app.user_data_path': { '/mock/exe': 'custom/data' } })
    stubFs()
    const { InvalidConfiguredUserDataPathError, resolveUserDataLocation } = await loadModule()
    expect(() => resolveUserDataLocation()).toThrow(InvalidConfiguredUserDataPathError)
    expect(setPathMock).not.toHaveBeenCalled()
  })

  it('BootConfig has matching exe but path is a symlink: throws before fallback', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
    stubFs({ lstatSyncImpl: () => ({ isSymbolicLink: () => true }) })
    const { InvalidConfiguredUserDataPathError, resolveUserDataLocation } = await loadModule()
    expect(() => resolveUserDataLocation()).toThrow(InvalidConfiguredUserDataPathError)
    expect(setPathMock).not.toHaveBeenCalled()
  })

  it('BootConfig has matching exe but path is invalid (existsSync false): throws before fallback', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    stubBootConfig({ 'app.user_data_path': { '/mock/exe': '/custom/data' } })
    stubFs({ existsSyncImpl: () => false })
    const { InvalidConfiguredUserDataPathError, resolveUserDataLocation } = await loadModule()
    expect(() => resolveUserDataLocation()).toThrow(InvalidConfiguredUserDataPathError)
    expect(setPathMock).not.toHaveBeenCalled()
  })

  it('BootConfig has invalid committed path but pending copy=false exists: defers to relocation gate', async () => {
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    stubBootConfig({
      'app.user_data_path': { '/mock/exe': '/custom/data' },
      'temp.user_data_relocation': { status: 'pending', from: '/custom/data', to: '/new/data', copy: false }
    })
    stubFs({ existsSyncImpl: () => false })
    const { resolveUserDataLocation } = await loadModule()
    expect(() => resolveUserDataLocation()).not.toThrow()
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

  it('ignores temp.user_data_relocation — execution lives in the relocation gate', async () => {
    // Regression guard: resolveUserDataLocation must NOT consume or act on a
    // pending relocation. It resolves userData to the committed OLD location so
    // the relocation gate (which runs later) sees the old path as
    // app.getPath('userData') while it copies.
    stubConstants({ isLinux: false, isWin: false, isPortable: false })
    stubElectron({ exePath: '/mock/exe' })
    stubBootConfig({
      'app.user_data_path': { '/mock/exe': '/committed/data' },
      'temp.user_data_relocation': { status: 'pending', from: '/committed/data', to: '/new/data', copy: true }
    })
    stubFs({ existsSyncImpl: () => true, accessSyncImpl: () => undefined })
    const { resolveUserDataLocation } = await loadModule()
    resolveUserDataLocation()
    // Set to the committed OLD path, not the relocation target.
    expect(setPathMock).toHaveBeenCalledWith('userData', '/committed/data')
    expect(setPathMock).toHaveBeenCalledTimes(1)
  })
})
