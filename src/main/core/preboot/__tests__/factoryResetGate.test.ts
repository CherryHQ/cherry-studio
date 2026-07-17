import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/factoryResetGate.ts
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `vi.doMock` + `vi.resetModules()` + dynamic import of the module under
 *     test in each scenario.
 *   - `electron`, `node:fs`, `node:os`, `@application`,
 *     `@main/core/paths/constants`, and `@main/data/bootConfig` are all
 *     shadowed per test; the bootConfig mock uses a mutable store so set()
 *     affects subsequent get() calls.
 */

const HOME = '/mock/home'
const USER_DATA = '/mock/home/appdata/CherryStudio'
const CHERRY_HOME = '/mock/home/.cherrystudio'
const APP_TEMP = '/mock/tmp/CherryStudio'
const OVMS_DIR = `${CHERRY_HOME}/ovms/ovms`

const appExitMock = vi.fn()
const showErrorBoxMock = vi.fn()
const rmSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const existsSyncMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()
const bootConfigPersistMock = vi.fn()

type FactoryResetMarker = { status: 'pending'; userDataPath: string; requestedAt: string; attempts?: number } | null

function stubElectron(userData: string = USER_DATA) {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      getPath: vi.fn((key: string) => (key === 'userData' ? userData : '/mock/unknown')),
      exit: appExitMock
    },
    dialog: { showErrorBox: showErrorBoxMock }
  }))
}

function stubOs() {
  vi.doMock('node:os', () => {
    const osMock = { homedir: () => HOME, tmpdir: () => '/mock/tmp' }
    return { __esModule: true, default: osMock, ...osMock }
  })
}

function stubConstants() {
  vi.doMock('@main/core/paths/constants', () => ({
    CHERRY_HOME,
    CHERRY_HOME_DIRNAME: '.cherrystudio',
    BOOT_CONFIG_PATH: `${CHERRY_HOME}/boot-config.json`,
    LOGS_DIR: `${USER_DATA}/logs`
  }))
}

function stubApplication() {
  vi.doMock('@application', () => ({
    application: {
      getPath: vi.fn((key: string) => {
        if (key === 'app.temp') return APP_TEMP
        if (key === 'feature.ovms.ovms') return OVMS_DIR
        return '/mock/unknown'
      })
    }
  }))
}

function stubBootConfig(marker: FactoryResetMarker) {
  const store: Record<string, unknown> = {
    'app.disable_hardware_acceleration': true,
    'app.user_data_path': { '/mock/exe': USER_DATA },
    'temp.factory_reset': marker,
    'temp.user_data_relocation': null
  }
  bootConfigGetMock.mockImplementation((key: string) => store[key])
  bootConfigSetMock.mockImplementation((key: string, value: unknown) => {
    store[key] = value
  })
  bootConfigFlushMock.mockImplementation(() => undefined)
  bootConfigPersistMock.mockImplementation(() => undefined)
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGetMock,
      set: bootConfigSetMock,
      flush: bootConfigFlushMock,
      persist: bootConfigPersistMock,
      getFilePath: () => `${CHERRY_HOME}/boot-config.json`
    }
  }))
  return store
}

function stubFs(listings: Record<string, string[] | Error>, opts: { sentinel?: boolean } = {}) {
  readdirSyncMock.mockImplementation((dir: string) => {
    const listing = listings[dir]
    if (listing === undefined) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${dir}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    if (listing instanceof Error) throw listing
    return [...listing]
  })
  rmSyncMock.mockImplementation(() => undefined)
  existsSyncMock.mockImplementation((p: string) => {
    if (p.endsWith('cherrystudio.sqlite')) return opts.sentinel ?? true
    return false
  })
  vi.doMock('node:fs', () => {
    const fsMock = { readdirSync: readdirSyncMock, rmSync: rmSyncMock, existsSync: existsSyncMock }
    return { __esModule: true, default: fsMock, ...fsMock }
  })
}

async function importGate() {
  const module = await import('../factoryResetGate')
  return module.runFactoryResetGate
}

function rmTargets(): string[] {
  return rmSyncMock.mock.calls.map(([target]) => target as string)
}

function pendingMarker(overrides: Partial<NonNullable<FactoryResetMarker>> = {}): FactoryResetMarker {
  return { status: 'pending', userDataPath: USER_DATA, requestedAt: '2026-07-17T00:00:00.000Z', ...overrides }
}

const FULL_LISTINGS = {
  [USER_DATA]: [
    'cherrystudio.sqlite',
    'Data',
    'cache.json',
    'Local Storage',
    'logs',
    'Crashpad',
    'Runtime',
    'Toolchain'
  ],
  [CHERRY_HOME]: ['bin', 'binary-manager', 'ovms', 'install', 'config', 'mcp', 'trace', 'boot-config.json']
}

describe('runFactoryResetGate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubElectron()
    stubOs()
    stubConstants()
    stubApplication()
  })

  it('is a no-op when no marker is pending', async () => {
    stubBootConfig(null)
    stubFs({})

    const run = await importGate()
    run()

    expect(readdirSyncMock).not.toHaveBeenCalled()
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
  })

  it('leaves a marker belonging to another userData directory untouched', async () => {
    const store = stubBootConfig(pendingMarker({ userDataPath: '/other/instance/userData' }))
    stubFs(FULL_LISTINGS)

    const run = await importGate()
    run()

    expect(rmSyncMock).not.toHaveBeenCalled()
    // The owning instance must still find its marker.
    expect(store['temp.factory_reset']).toEqual(pendingMarker({ userDataPath: '/other/instance/userData' }))
    expect(bootConfigSetMock).not.toHaveBeenCalled()
  })

  it('wipes userData (keeping diagnostics and model artifacts), CHERRY_HOME user state, temp and OVMS registry, then hard-persists the BootConfig reset', async () => {
    const store = stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)

    const run = await importGate()
    run()

    const targets = rmTargets()
    expect(targets).toContain(`${USER_DATA}/cherrystudio.sqlite`)
    expect(targets).toContain(`${USER_DATA}/Data`)
    expect(targets).toContain(`${USER_DATA}/cache.json`)
    expect(targets).toContain(`${USER_DATA}/Local Storage`)
    expect(targets).not.toContain(`${USER_DATA}/logs`)
    expect(targets).not.toContain(`${USER_DATA}/Crashpad`)
    // Local model weights + onnxruntime are re-downloadable machine artifacts;
    // the fresh DB is safe because the embedding registration self-heals on
    // the next status probe (LocalEmbeddingDownloadService.checkStatus).
    expect(targets).not.toContain(`${USER_DATA}/Runtime`)
    expect(targets).not.toContain(`${USER_DATA}/Toolchain`)

    expect(targets).toContain(`${CHERRY_HOME}/config`)
    expect(targets).toContain(`${CHERRY_HOME}/mcp`)
    expect(targets).toContain(`${CHERRY_HOME}/trace`)
    expect(targets).not.toContain(`${CHERRY_HOME}/bin`)
    expect(targets).not.toContain(`${CHERRY_HOME}/binary-manager`)
    expect(targets).not.toContain(`${CHERRY_HOME}/ovms`)
    expect(targets).not.toContain(`${CHERRY_HOME}/boot-config.json`)

    expect(targets).toContain(APP_TEMP)
    expect(targets).toContain(`${OVMS_DIR}/models/config.json`)

    // Retry accounting armed before the destructive pass…
    expect(bootConfigSetMock).toHaveBeenCalledWith('temp.factory_reset', expect.objectContaining({ attempts: 1 }))
    // …and the marker cleared plus settings reset (keeping the data-dir location) at the end.
    expect(store['temp.factory_reset']).toBeNull()
    expect(store['app.disable_hardware_acceleration']).toBe(false)
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': USER_DATA })
    expect(bootConfigPersistMock).toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('keeps the marker pending (attempts incremented) when a critical entry fails to delete', async () => {
    const store = stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)
    rmSyncMock.mockImplementation((target: string) => {
      if (target === `${USER_DATA}/cherrystudio.sqlite`) throw new Error('EPERM: operation not permitted')
    })

    const run = await importGate()
    run()

    expect(store['temp.factory_reset']).toEqual(pendingMarker({ attempts: 1 }))
    // Settings untouched — the reset is not "done".
    expect(store['app.disable_hardware_acceleration']).toBe(true)
    expect(bootConfigPersistMock).not.toHaveBeenCalled()
  })

  it('abandons a marker at the attempt cap without wiping again', async () => {
    const store = stubBootConfig(pendingMarker({ attempts: 2 }))
    stubFs(FULL_LISTINGS)

    const run = await importGate()
    run()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })

  it('quits instead of booting when the marker cannot be durably cleared after a clean wipe', async () => {
    stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)
    bootConfigPersistMock.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device')
    })

    const run = await importGate()
    run()

    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
  })

  it('falls back to the Cherry-artifact manifest when the ownership sentinel is missing', async () => {
    stubBootConfig(pendingMarker())
    stubFs(
      { [USER_DATA]: ['cherrystudio.sqlite', 'Data', 'IndexedDB', 'UserPhotos'], [CHERRY_HOME]: ['config'] },
      { sentinel: false }
    )

    const run = await importGate()
    run()

    const targets = rmTargets()
    expect(targets).toContain(`${USER_DATA}/cherrystudio.sqlite`)
    expect(targets).toContain(`${USER_DATA}/Data`)
    // Non-Cherry-named entries survive in fallback mode.
    expect(targets).not.toContain(`${USER_DATA}/IndexedDB`)
    expect(targets).not.toContain(`${USER_DATA}/UserPhotos`)
  })

  it('never tree-wipes the home directory, sentinel or not', async () => {
    stubElectron(HOME)
    const store = stubBootConfig(pendingMarker({ userDataPath: HOME }))
    stubFs({ [HOME]: ['Documents', 'cherrystudio.sqlite', 'Data'], [CHERRY_HOME]: ['config'] }, { sentinel: true })

    const run = await importGate()
    run()

    const targets = rmTargets()
    expect(targets).not.toContain(`${HOME}/Documents`)
    expect(targets).toContain(`${HOME}/cherrystudio.sqlite`)
    expect(store['temp.factory_reset']).toBeNull()
  })

  it('still completes when CHERRY_HOME does not exist', async () => {
    const store = stubBootConfig(pendingMarker())
    stubFs({ [USER_DATA]: ['cherrystudio.sqlite'] })

    const run = await importGate()
    run()

    expect(rmTargets()).toContain(`${USER_DATA}/cherrystudio.sqlite`)
    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigPersistMock).toHaveBeenCalled()
  })
})
