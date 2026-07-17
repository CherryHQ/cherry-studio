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
const appRelaunchMock = vi.fn()
const showErrorBoxMock = vi.fn()
const rmSyncMock = vi.fn()
const mkdirSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const existsSyncMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()
const bootConfigPersistMock = vi.fn()

type FactoryResetMarker = {
  status: 'pending'
  userDataPath: string
  requestedAt: string
  attempts?: number
  mode?: 'tree' | 'owned-manifest' | 'manifest'
} | null

function stubElectron(userData: string = USER_DATA) {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      getPath: vi.fn((key: string) => (key === 'userData' ? userData : '/mock/unknown')),
      exit: appExitMock,
      relaunch: appRelaunchMock
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

function stubApplication(userData: string = USER_DATA) {
  vi.doMock('@application', () => ({
    application: {
      getPath: vi.fn((key: string) => {
        if (key === 'app.userdata') return userData
        if (key === 'app.temp') return APP_TEMP
        if (key === 'feature.ovms.model_registry_file') return `${OVMS_DIR}/models/config.json`
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
  mkdirSyncMock.mockImplementation(() => undefined)
  existsSyncMock.mockImplementation((p: string) => {
    if (p.endsWith('cherrystudio.sqlite')) return opts.sentinel ?? true
    return false
  })
  vi.doMock('node:fs', () => {
    const fsMock = {
      readdirSync: readdirSyncMock,
      rmSync: rmSyncMock,
      mkdirSync: mkdirSyncMock,
      existsSync: existsSyncMock
    }
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
    // app.temp must come back after the rm: getPath('app.temp') already cached
    // the auto-ensure for this key, so nothing else in this session recreates
    // it — office attachment parsing and Clear cache would hit ENOENT.
    expect(mkdirSyncMock).toHaveBeenCalledWith(APP_TEMP, { recursive: true })

    // Every deletion carries the Windows lock-retry options — a transient
    // antivirus/indexer lock must not consume a MAX_WIPE_ATTEMPTS slot.
    for (const [, options] of rmSyncMock.mock.calls) {
      expect(options).toMatchObject({ recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }

    // Retry accounting + the wipe-mode decision armed before the destructive pass…
    expect(bootConfigSetMock).toHaveBeenCalledWith(
      'temp.factory_reset',
      expect.objectContaining({ attempts: 1, mode: 'tree' })
    )
    // …and the marker cleared plus settings reset (keeping the data-dir location) at the end.
    expect(store['temp.factory_reset']).toBeNull()
    expect(store['app.disable_hardware_acceleration']).toBe(false)
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': USER_DATA })
    expect(bootConfigPersistMock).toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('relaunches into a preboot retry (marker pending, never a writable app) when a critical entry fails to delete', async () => {
    const store = stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)
    rmSyncMock.mockImplementation((target: string) => {
      if (target === `${USER_DATA}/cherrystudio.sqlite`) throw new Error('EPERM: operation not permitted')
    })

    const run = await importGate()
    run()

    expect(store['temp.factory_reset']).toEqual(pendingMarker({ attempts: 1, mode: 'tree' }))
    // Settings untouched — the reset is not "done". persist() ran exactly once
    // (the durable attempt increment), never for a completion the pass didn't earn.
    expect(store['app.disable_hardware_acceleration']).toBe(true)
    expect(bootConfigPersistMock).toHaveBeenCalledTimes(1)
    // Booting on would open a data-loss window: anything the user creates in
    // the half-wiped app gets deleted by the retry pass (#17138 review).
    expect(appRelaunchMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
  })

  it('gives up at the attempt cap on a failing pass: marker cleared, user warned, no relaunch', async () => {
    const store = stubBootConfig(pendingMarker({ attempts: 1, mode: 'tree' }))
    stubFs(FULL_LISTINGS)
    rmSyncMock.mockImplementation((target: string) => {
      if (target === `${USER_DATA}/cherrystudio.sqlite`) throw new Error('EPERM: operation not permitted')
    })

    const run = await importGate()
    run()

    // The final allowed pass failed — relaunching again would only make the
    // next boot's cap check give up anyway, so give up here and say so.
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })

  it('treats a failed OVMS registry removal as critical — the marker stays pending', async () => {
    const store = stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)
    rmSyncMock.mockImplementation((target: string) => {
      if (target === `${OVMS_DIR}/models/config.json`) throw new Error('EBUSY: resource busy or locked')
    })

    const run = await importGate()
    run()

    // The registry is user-authored model configuration: clearing the marker
    // over a locked registry would declare the reset complete while the next
    // boot still loads the user's model setup (#17138 review).
    expect(store['temp.factory_reset']).toEqual(pendingMarker({ attempts: 1, mode: 'tree' }))
    expect(store['app.disable_hardware_acceleration']).toBe(true)
    expect(appRelaunchMock).toHaveBeenCalled()
  })

  it('skips the destructive pass entirely when the attempt count cannot be durably recorded', async () => {
    stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)
    bootConfigPersistMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    const run = await importGate()
    run()

    // No accounting on disk → no wipe: an unrecorded pass would void the
    // attempt cap and re-wipe user-created data on every boot.
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('coerces a corrupted non-numeric attempts value instead of disabling the cap', async () => {
    const store = stubBootConfig(pendingMarker({ attempts: 'x' as unknown as number }))
    stubFs(FULL_LISTINGS)

    const run = await importGate()
    run()

    // '"x" >= 2' is false and '"x" + 1' concatenates — without coercion the
    // cap arithmetic never terminates. Coerced to 0, the pass runs and the
    // increment writes a real number.
    expect(bootConfigSetMock).toHaveBeenCalledWith('temp.factory_reset', expect.objectContaining({ attempts: 1 }))
    expect(store['temp.factory_reset']).toBeNull()
  })

  it('abandons a marker at the attempt cap without wiping again, warning the user', async () => {
    const store = stubBootConfig(pendingMarker({ attempts: 2 }))
    stubFs(FULL_LISTINGS)

    const run = await importGate()
    run()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
    // A crash-mid-pass lands here on the next boot — the user asked for a
    // reset and must hear that it gave up, not infer it from leftover data.
    expect(showErrorBoxMock).toHaveBeenCalled()
  })

  it('quits instead of booting when the marker cannot be durably cleared after a clean wipe', async () => {
    stubBootConfig(pendingMarker())
    stubFs(FULL_LISTINGS)
    // First persist (the attempt increment) succeeds; the completion persist fails.
    bootConfigPersistMock
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })

    const run = await importGate()
    run()

    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
  })

  it('falls back to the strict Cherry-artifact manifest when the ownership sentinel is missing', async () => {
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
    // Non-Cherry-named entries survive in strict manifest mode — without the
    // ownership sentinel they could belong to another app.
    expect(targets).not.toContain(`${USER_DATA}/IndexedDB`)
    expect(targets).not.toContain(`${USER_DATA}/UserPhotos`)
    expect(bootConfigSetMock).toHaveBeenCalledWith('temp.factory_reset', expect.objectContaining({ mode: 'manifest' }))
  })

  it('uses the owned manifest (v1 artifacts + user state included) for a sentinel-proven near-root directory', async () => {
    const SHALLOW = '/d/CherryData'
    stubElectron(SHALLOW)
    stubApplication(SHALLOW)
    const store = stubBootConfig(pendingMarker({ userDataPath: SHALLOW }))
    stubFs(
      {
        [SHALLOW]: [
          'cherrystudio.sqlite',
          'Data',
          'version.log',
          'IndexedDB',
          'Local Storage',
          'config.json',
          '.claude',
          'tesseract',
          'Cookies'
        ],
        [CHERRY_HOME]: ['config']
      },
      { sentinel: true }
    )

    const run = await importGate()
    run()

    const targets = rmTargets()
    expect(targets).toContain(`${SHALLOW}/cherrystudio.sqlite`)
    // The v1 artifacts must go with the database: the migration-status row is
    // wiped with the sqlite file, so leftover v1 markers would make the next
    // boot re-detect v1 data and migrate the residue back in (#17138 review).
    expect(targets).toContain(`${SHALLOW}/version.log`)
    expect(targets).toContain(`${SHALLOW}/IndexedDB`)
    expect(targets).toContain(`${SHALLOW}/Local Storage`)
    expect(targets).toContain(`${SHALLOW}/config.json`)
    // User state at the userData root the Cherry-named manifest misses.
    expect(targets).toContain(`${SHALLOW}/.claude`)
    expect(targets).toContain(`${SHALLOW}/tesseract`)
    // Documented residual: the rest of Chromium's state survives this mode.
    expect(targets).not.toContain(`${SHALLOW}/Cookies`)
    expect(bootConfigSetMock).toHaveBeenCalledWith(
      'temp.factory_reset',
      expect.objectContaining({ mode: 'owned-manifest' })
    )
    expect(store['temp.factory_reset']).toBeNull()
  })

  it('never tree-wipes ~/.cherrystudio itself — tool binaries and boot-config.json survive', async () => {
    stubElectron(CHERRY_HOME)
    stubApplication(CHERRY_HOME)
    const store = stubBootConfig(pendingMarker({ userDataPath: CHERRY_HOME }))
    stubFs({ [CHERRY_HOME]: [...FULL_LISTINGS[CHERRY_HOME], 'cherrystudio.sqlite', 'Data'] }, { sentinel: true })

    const run = await importGate()
    run()

    const targets = rmTargets()
    // Cherry artifacts and the user-state subtrees still go…
    expect(targets).toContain(`${CHERRY_HOME}/cherrystudio.sqlite`)
    expect(targets).toContain(`${CHERRY_HOME}/Data`)
    expect(targets).toContain(`${CHERRY_HOME}/config`)
    // …but a tree pass here would delete the kept machine artifacts and the
    // boot-config file (the marker included) out from under the gate.
    expect(targets).not.toContain(`${CHERRY_HOME}/bin`)
    expect(targets).not.toContain(`${CHERRY_HOME}/binary-manager`)
    expect(targets).not.toContain(`${CHERRY_HOME}/ovms`)
    expect(targets).not.toContain(`${CHERRY_HOME}/install`)
    expect(targets).not.toContain(`${CHERRY_HOME}/boot-config.json`)
    expect(store['temp.factory_reset']).toBeNull()
  })

  it('reuses the recorded wipe mode on retry even though the first pass deleted the sentinel', async () => {
    const store = stubBootConfig(pendingMarker({ attempts: 1, mode: 'tree' }))
    // Crash-mid-wipe resume: the sentinel is already gone, but the recorded
    // decision must hold — re-deriving would downgrade to a manifest wipe and
    // declare success over whatever the crashed pass never reached.
    stubFs(FULL_LISTINGS, { sentinel: false })

    const run = await importGate()
    run()

    expect(rmTargets()).toContain(`${USER_DATA}/Local Storage`)
    expect(store['temp.factory_reset']).toBeNull()
  })

  it('re-derives the mode when the recorded value is not a known wipe mode', async () => {
    stubBootConfig(pendingMarker({ mode: 'everything' as unknown as 'tree' }))
    stubFs(FULL_LISTINGS, { sentinel: false })

    const run = await importGate()
    run()

    // Unknown hand-edited value → fresh decision (no sentinel → strict manifest).
    expect(rmTargets()).not.toContain(`${USER_DATA}/Local Storage`)
    expect(bootConfigSetMock).toHaveBeenCalledWith('temp.factory_reset', expect.objectContaining({ mode: 'manifest' }))
  })

  it('never tree-wipes the home directory, sentinel or not', async () => {
    stubElectron(HOME)
    stubApplication(HOME)
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
