import { beforeEach, describe, expect, it, vi } from 'vitest'

const appGetPath = vi.fn()
const appSetPath = vi.fn()
const bootConfigGet = vi.fn()
const bootConfigSet = vi.fn()
const bootConfigFlush = vi.fn()

function stubRuntime() {
  vi.doMock('@main/core/paths/constants', () => ({ CHERRY_HOME: '/home/.cherrystudio' }))
  vi.doMock('@main/core/platform', () => ({
    isLinux: false,
    isWin: false,
    isPortable: false
  }))
  vi.doMock('electron', () => ({
    app: {
      getPath: appGetPath,
      setPath: appSetPath,
      isPackaged: false,
      resourcesPath: '/resources',
      getVersion: vi.fn(() => '2.0.0')
    }
  }))
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGet,
      set: bootConfigSet,
      flush: bootConfigFlush
    }
  }))
}

function stubFs(options: { existingDirs?: Set<string>; legacyConfig?: string } = {}) {
  const existingDirs = options.existingDirs ?? new Set<string>()
  vi.doMock('node:fs', () => {
    const fsMock = {
      existsSync: vi.fn((p: string) => p === '/home/.cherrystudio/config/config.json' || existingDirs.has(p)),
      readFileSync: vi.fn((p: string) => {
        if (p === '/home/.cherrystudio/config/config.json' && options.legacyConfig !== undefined) {
          return options.legacyConfig
        }
        throw new Error(`Unexpected readFileSync(${p})`)
      }),
      lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
      statSync: vi.fn(() => ({ isDirectory: () => true })),
      accessSync: vi.fn(() => undefined),
      constants: { W_OK: 2 }
    }
    return { ...fsMock, default: fsMock }
  })
}

async function loadModule() {
  return import('../MigrationPaths')
}

beforeEach(() => {
  vi.resetModules()
  appGetPath.mockReset().mockImplementation((name: string) => {
    if (name === 'userData') return '/default/userData'
    if (name === 'exe') return '/Applications/Cherry Studio.app/exe'
    throw new Error(`Unexpected app.getPath(${name})`)
  })
  appSetPath.mockReset()
  bootConfigGet.mockReset()
  bootConfigSet.mockReset()
  bootConfigFlush.mockReset()
})

describe('resolveMigrationPaths', () => {
  it('blocks fallback migration when a committed BootConfig userData path is unusable', async () => {
    stubRuntime()
    stubFs({ existingDirs: new Set(['/default/userData']) })
    bootConfigGet.mockImplementation((key: string) => {
      if (key === 'app.user_data_path') return { '/Applications/Cherry Studio.app/exe': '/missing/custom-data' }
      return undefined
    })

    const { resolveMigrationPaths } = await loadModule()
    const result = resolveMigrationPaths()

    expect(result.inaccessibleLegacyPath).toBe('/missing/custom-data')
    expect(result.paths.userData).toBe('/default/userData')
    expect(result.userDataChanged).toBe(false)
    expect(appSetPath).not.toHaveBeenCalled()
    expect(bootConfigSet).not.toHaveBeenCalled()
  })

  it('uses a valid legacy custom path only when no BootConfig path is configured', async () => {
    stubRuntime()
    stubFs({
      existingDirs: new Set(['/default/userData', '/legacy/custom-data']),
      legacyConfig: JSON.stringify({ appDataPath: '/legacy/custom-data' })
    })
    bootConfigGet.mockImplementation((key: string) => {
      if (key === 'app.user_data_path') return {}
      return undefined
    })

    const { resolveMigrationPaths } = await loadModule()
    const result = resolveMigrationPaths()

    expect(result.inaccessibleLegacyPath).toBeNull()
    expect(result.paths.userData).toBe('/legacy/custom-data')
    expect(result.userDataChanged).toBe(true)
    expect(appSetPath).toHaveBeenCalledWith('userData', '/legacy/custom-data')
  })
})
