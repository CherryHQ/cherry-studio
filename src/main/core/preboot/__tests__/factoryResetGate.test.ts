import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/factoryResetGate.ts
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `vi.doMock` + `vi.resetModules()` + dynamic import of the module under
 *     test in each scenario.
 *   - `electron`, `node:fs`, `@application`, and `@main/data/bootConfig` are
 *     shadowed per test; the bootConfig mock uses a mutable store so set()
 *     affects subsequent get() calls.
 */

const USER_DATA = '/mock/home/appdata/CherryStudio'
const APP_TEMP = '/mock/tmp/CherryStudio'

const appExitMock = vi.fn()
const appRelaunchMock = vi.fn()
const showErrorBoxMock = vi.fn()
const rmSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const realpathNativeMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()
const bootConfigPersistMock = vi.fn()

type FactoryResetMarker = {
  status: 'pending'
  userDataPath: string
  requestedAt: string
  attempts?: number | string
  canonicalPath?: string
} | null

/** A realistic userData listing: wiped ∪ kept ∪ unknown-provenance debris. */
const DEFAULT_LISTING = [
  // wiped — Cherry user state
  'cherrystudio.sqlite',
  'cherrystudio.sqlite-wal',
  'cherrystudio.sqlite.bak-20260712163756',
  'Data',
  'Data.restore',
  'cache.json',
  'version.log',
  'restore-journal.json',
  '.claude',
  '.copilot_token',
  'config.json',
  'window-state.json',
  // wiped — Chromium state
  'Cookies',
  'Partitions',
  'Local Storage',
  'IndexedDB',
  // kept — machine artifacts and diagnostics
  'logs',
  'Crashpad',
  'Runtime',
  'Toolchain',
  'tesseract',
  // kept — unknown provenance (old-build debris, user files)
  'migration_temp',
  '.pi',
  'holiday-photos'
]

const EXPECTED_WIPED = [
  'cherrystudio.sqlite',
  'cherrystudio.sqlite-wal',
  'cherrystudio.sqlite.bak-20260712163756',
  'Data',
  'Data.restore',
  'cache.json',
  'version.log',
  'restore-journal.json',
  '.claude',
  '.copilot_token',
  'config.json',
  'window-state.json',
  'Cookies',
  'Partitions',
  'Local Storage',
  'IndexedDB'
]

const EXPECTED_KEPT = [
  'logs',
  'Crashpad',
  'Runtime',
  'Toolchain',
  'tesseract',
  'migration_temp',
  '.pi',
  'holiday-photos'
]

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: { exit: appExitMock, relaunch: appRelaunchMock },
    dialog: { showErrorBox: showErrorBoxMock }
  }))
}

function stubApplication(userData: string = USER_DATA) {
  vi.doMock('@application', () => ({
    application: {
      getPath: vi.fn((key: string) => {
        if (key === 'app.userdata') return userData
        if (key === 'app.temp') return APP_TEMP
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
      getFilePath: () => '/mock/home/.cherrystudio/boot-config.json'
    }
  }))
  return store
}

function stubFs(listing: string[] | Error = DEFAULT_LISTING) {
  readdirSyncMock.mockImplementation((dir: string) => {
    if (dir !== USER_DATA) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${dir}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    if (listing instanceof Error) throw listing
    return [...listing]
  })
  rmSyncMock.mockImplementation(() => undefined)
  // Identity: realpath resolves to the lexical path unless a test overrides.
  realpathNativeMock.mockImplementation((p: string) => p)
  const fsMock = {
    readdirSync: readdirSyncMock,
    rmSync: rmSyncMock,
    realpathSync: Object.assign(vi.fn(), { native: realpathNativeMock })
  }
  vi.doMock('node:fs', () => ({ __esModule: true, default: fsMock, ...fsMock }))
}

function pendingMarker(overrides: Partial<NonNullable<FactoryResetMarker>> = {}): FactoryResetMarker {
  return {
    status: 'pending',
    userDataPath: USER_DATA,
    requestedAt: '2026-07-20T00:00:00.000Z',
    ...overrides
  }
}

async function runGate() {
  const { runFactoryResetGate } = await import('../factoryResetGate')
  runFactoryResetGate()
}

function wipedEntries(): string[] {
  return rmSyncMock.mock.calls.map(([target]) => String(target)).filter((t) => t.startsWith(`${USER_DATA}/`))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('runFactoryResetGate', () => {
  it('does nothing without a pending marker', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(null)
    stubFs()
    await runGate()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
  })

  it('leaves a marker recorded for a different userData directory untouched', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker({ userDataPath: '/mock/other/CherryStudioDev' }))
    stubFs()
    await runGate()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('wipes exactly the whitelist, resets BootConfig, and relaunches', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker())
    stubFs()
    await runGate()

    const wiped = wipedEntries()
    for (const entry of EXPECTED_WIPED) {
      expect(wiped).toContain(`${USER_DATA}/${entry}`)
    }
    for (const entry of EXPECTED_KEPT) {
      expect(wiped).not.toContain(`${USER_DATA}/${entry}`)
    }
    // app.temp is removed best-effort, and NOT recreated (the relaunch below
    // hands path ensuring to the fresh process).
    expect(rmSyncMock).toHaveBeenCalledWith(APP_TEMP, expect.anything())

    // BootConfig reset: marker cleared, settings back to defaults, data-dir
    // location preserved.
    expect(store['temp.factory_reset']).toBeNull()
    expect(store['app.disable_hardware_acceleration']).toBe(false)
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': USER_DATA })
    expect(bootConfigPersistMock).toHaveBeenCalled()

    // Post-wipe relaunch into a clean process (#17138 suggestion).
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('records the canonical physical path with the arming write', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker())
    stubFs()
    realpathNativeMock.mockImplementation(() => '/mock/physical/CherryStudio')
    await runGate()

    const armed = bootConfigSetMock.mock.calls.find(
      ([key, value]) => key === 'temp.factory_reset' && value !== null
    )?.[1] as { canonicalPath?: string; attempts?: number }
    expect(armed?.canonicalPath).toBe('/mock/physical/CherryStudio')
    expect(armed?.attempts).toBe(1)
  })

  it('refuses to wipe when the recorded physical identity no longer matches', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker({ canonicalPath: '/mock/old-target', attempts: 1 }))
    stubFs()
    realpathNativeMock.mockImplementation(() => '/mock/new-target')
    await runGate()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('quits without wiping when the attempt count cannot be durably recorded', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker())
    stubFs()
    bootConfigPersistMock.mockImplementation(() => {
      throw new Error('EROFS: read-only file system')
    })
    await runGate()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('relaunches back into preboot when a pass fails with attempts left', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker())
    stubFs()
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runGate()

    const marker = store['temp.factory_reset'] as { attempts?: number }
    expect(marker?.attempts).toBe(1)
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it('gives up at the attempt cap: clears the marker, warns, continues boot', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker({ attempts: 1, canonicalPath: USER_DATA }))
    stubFs()
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runGate()

    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('abandons a marker that already reached the attempt cap without another pass', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker({ attempts: 2, canonicalPath: USER_DATA }))
    stubFs()
    await runGate()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.factory_reset']).toBeNull()
    expect(showErrorBoxMock).toHaveBeenCalled()
  })

  it('treats a corrupted attempts value as zero instead of voiding the cap', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker({ attempts: 'x' }))
    stubFs()
    await runGate()

    const armed = bootConfigSetMock.mock.calls.find(
      ([key, value]) => key === 'temp.factory_reset' && value !== null
    )?.[1] as { attempts?: number }
    expect(armed?.attempts).toBe(1)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('quits after a clean wipe whose marker clear cannot be persisted', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker())
    stubFs()
    let persistCalls = 0
    bootConfigPersistMock.mockImplementation(() => {
      persistCalls += 1
      // First persist arms the attempt counter; the second clears the marker.
      if (persistCalls === 2) throw new Error('ENOSPC: no space left on device')
    })
    await runGate()

    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('never touches paths outside userData and app.temp', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker())
    stubFs()
    await runGate()

    for (const [target] of rmSyncMock.mock.calls) {
      expect(String(target).startsWith(`${USER_DATA}/`) || String(target) === APP_TEMP).toBe(true)
    }
  })

  it('records the userData listing failure as critical instead of declaring success', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker())
    stubFs(new Error('EACCES: permission denied'))
    await runGate()

    const marker = store['temp.factory_reset'] as { attempts?: number } | null
    expect(marker?.attempts).toBe(1)
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(1)
  })

  it('treats a missing userData directory as already clean', async () => {
    stubElectron()
    stubApplication()
    const store = stubBootConfig(pendingMarker())
    stubFs()
    readdirSyncMock.mockImplementation(() => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })
    await runGate()

    expect(store['temp.factory_reset']).toBeNull()
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('continues boot when the gate itself throws unexpectedly', async () => {
    stubElectron()
    stubApplication()
    stubBootConfig(pendingMarker())
    stubFs()
    bootConfigGetMock.mockImplementation(() => {
      throw new Error('corrupted store')
    })
    await runGate()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })
})
