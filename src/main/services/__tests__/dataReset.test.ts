import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/services/dataReset.ts — both faces: runDataReset (the
 * preboot-timed execution) and requestDataReset (the running-app request).
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `vi.doMock` + `vi.resetModules()` + dynamic import of the module under
 *     test in each scenario.
 *   - `electron`, `node:fs`, `@application`, `@main/i18n`, and
 *     `@main/data/bootConfig` are shadowed per test; the bootConfig mock uses
 *     a mutable store so set() affects subsequent get() calls.
 */

const USER_DATA = '/mock/home/appdata/CherryStudio'
const APP_TEMP = '/mock/tmp/CherryStudio'

const appExitMock = vi.fn()
const appRelaunchMock = vi.fn()
const relaunchAfterShutdownMock = vi.fn()
const showErrorBoxMock = vi.fn()
const showMessageBoxMock = vi.fn()
const rmSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const realpathNativeMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()
const bootConfigPersistMock = vi.fn()

type DataResetMarker = {
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
  'cherrystudio.sqlite-shm',
  'Data',
  'Data.restore',
  'IndexedDB.restore',
  'Local Storage.restore',
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
  'holiday-photos',
  // kept — a user's own file that only *looks* like a db sibling: the sqlite
  // family is matched by exact name, so this survives (#17138 review).
  'cherrystudio.sqlite-personal-backup'
]

const EXPECTED_WIPED = [
  'cherrystudio.sqlite',
  'cherrystudio.sqlite-wal',
  'cherrystudio.sqlite-shm',
  'Data',
  'Data.restore',
  'IndexedDB.restore',
  'Local Storage.restore',
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
  'holiday-photos',
  'cherrystudio.sqlite-personal-backup'
]

const makeSession = () => ({
  clearCache: vi.fn().mockResolvedValue(undefined),
  clearStorageData: vi.fn().mockResolvedValue(undefined),
  clearAuthCache: vi.fn().mockResolvedValue(undefined)
})
let defaultSession = makeSession()
let webviewSession = makeSession()

function stubElectron() {
  defaultSession = makeSession()
  webviewSession = makeSession()
  vi.doMock('electron', () => ({
    __esModule: true,
    app: { exit: appExitMock, relaunch: appRelaunchMock },
    dialog: { showErrorBox: showErrorBoxMock, showMessageBox: showMessageBoxMock },
    session: { defaultSession, fromPartition: vi.fn(() => webviewSession) }
  }))
}

function stubApplication(userData: string = USER_DATA) {
  vi.doMock('@application', () => ({
    application: {
      getPath: vi.fn((key: string) => {
        if (key === 'app.userdata') return userData
        if (key === 'app.temp') return APP_TEMP
        return '/mock/unknown'
      }),
      relaunchAfterShutdown: relaunchAfterShutdownMock
    }
  }))
}

function stubI18n() {
  vi.doMock('@main/i18n', () => ({
    t: (key: string) => key,
    tFor: (_locale: string, key: string) => key,
    getAppLanguage: () => 'zh-CN'
  }))
}

function stubBootConfig(marker: DataResetMarker) {
  const store: Record<string, unknown> = {
    'app.disable_hardware_acceleration': true,
    'app.user_data_path': { '/mock/exe': USER_DATA },
    'temp.data_reset': marker,
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

function stubAll(marker: DataResetMarker) {
  stubElectron()
  stubApplication()
  stubI18n()
  const store = stubBootConfig(marker)
  stubFs()
  return store
}

function pendingMarker(overrides: Partial<NonNullable<DataResetMarker>> = {}): DataResetMarker {
  return {
    status: 'pending',
    userDataPath: USER_DATA,
    requestedAt: '2026-07-20T00:00:00.000Z',
    ...overrides
  }
}

async function runReset() {
  const { runDataReset } = await import('../dataReset')
  runDataReset()
}

async function requestReset() {
  const { requestDataReset } = await import('../dataReset')
  return requestDataReset()
}

function wipedEntries(): string[] {
  return rmSyncMock.mock.calls.map(([target]) => String(target)).filter((t) => t.startsWith(`${USER_DATA}/`))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('runDataReset', () => {
  it('does nothing without a pending marker', async () => {
    stubAll(null)
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
  })

  it('leaves a marker recorded for a different userData directory untouched', async () => {
    stubAll(pendingMarker({ userDataPath: '/mock/other/CherryStudioDev' }))
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('wipes exactly the whitelist, resets BootConfig, and relaunches', async () => {
    const store = stubAll(pendingMarker())
    await runReset()

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
    expect(store['temp.data_reset']).toBeNull()
    expect(store['app.disable_hardware_acceleration']).toBe(false)
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': USER_DATA })
    expect(bootConfigPersistMock).toHaveBeenCalled()

    // Post-wipe relaunch into a clean process (#17138 suggestion).
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('records the canonical physical path with the arming write', async () => {
    stubAll(pendingMarker())
    realpathNativeMock.mockImplementation(() => '/mock/physical/CherryStudio')
    await runReset()

    const armed = bootConfigSetMock.mock.calls.find(
      ([key, value]) => key === 'temp.data_reset' && value !== null
    )?.[1] as { canonicalPath?: string; attempts?: number } | undefined
    expect(armed?.canonicalPath).toBe('/mock/physical/CherryStudio')
    expect(armed?.attempts).toBe(1)
  })

  it('refuses to wipe when the recorded physical identity no longer matches', async () => {
    const store = stubAll(pendingMarker({ canonicalPath: '/mock/old-target', attempts: 1 }))
    realpathNativeMock.mockImplementation(() => '/mock/new-target')
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.data_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('quits without wiping when the attempt count cannot be durably recorded', async () => {
    stubAll(pendingMarker())
    bootConfigPersistMock.mockImplementation(() => {
      throw new Error('EROFS: read-only file system')
    })
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('relaunches back into preboot when a pass fails with attempts left', async () => {
    const store = stubAll(pendingMarker())
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runReset()

    const marker = store['temp.data_reset'] as { attempts?: number }
    expect(marker?.attempts).toBe(1)
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it('gives up at the attempt cap: clears the marker, warns, continues boot', async () => {
    const store = stubAll(pendingMarker({ attempts: 1, canonicalPath: USER_DATA }))
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runReset()

    expect(store['temp.data_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('abandons a marker that already reached the attempt cap without another pass', async () => {
    const store = stubAll(pendingMarker({ attempts: 2, canonicalPath: USER_DATA }))
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.data_reset']).toBeNull()
    expect(showErrorBoxMock).toHaveBeenCalled()
  })

  it('treats a corrupted attempts value as zero instead of voiding the cap', async () => {
    stubAll(pendingMarker({ attempts: 'x' }))
    await runReset()

    const armed = bootConfigSetMock.mock.calls.find(
      ([key, value]) => key === 'temp.data_reset' && value !== null
    )?.[1] as { attempts?: number } | undefined
    expect(armed?.attempts).toBe(1)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('quits after a clean wipe whose marker clear cannot be persisted', async () => {
    stubAll(pendingMarker())
    let persistCalls = 0
    bootConfigPersistMock.mockImplementation(() => {
      persistCalls += 1
      // First persist arms the attempt counter; the second clears the marker.
      if (persistCalls === 2) throw new Error('ENOSPC: no space left on device')
    })
    await runReset()

    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('never touches paths outside userData and app.temp', async () => {
    stubAll(pendingMarker())
    await runReset()

    for (const [target] of rmSyncMock.mock.calls) {
      expect(String(target).startsWith(`${USER_DATA}/`) || String(target) === APP_TEMP).toBe(true)
    }
  })

  it('records the userData listing failure as critical instead of declaring success', async () => {
    stubElectron()
    stubApplication()
    stubI18n()
    const store = stubBootConfig(pendingMarker())
    stubFs(new Error('EACCES: permission denied'))
    await runReset()

    const marker = store['temp.data_reset'] as { attempts?: number } | null
    expect(marker?.attempts).toBe(1)
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(1)
  })

  it('treats a missing userData directory as already clean', async () => {
    const store = stubAll(pendingMarker())
    readdirSyncMock.mockImplementation(() => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })
    await runReset()

    expect(store['temp.data_reset']).toBeNull()
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('continues boot when the module itself throws unexpectedly', async () => {
    stubAll(pendingMarker())
    bootConfigGetMock.mockImplementation(() => {
      throw new Error('corrupted store')
    })
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })
})

describe('requestDataReset', () => {
  beforeEach(() => {
    // The native confirmation dialog (the arming authority — renderer-side
    // dialogs don't count for a whole-profile wipe): button 1 is confirm.
    showMessageBoxMock.mockResolvedValue({ response: 1, checkboxChecked: false })
  })

  it('resolves without staging anything when the user cancels the native confirmation', async () => {
    stubAll(null)
    showMessageBoxMock.mockResolvedValue({ response: 0, checkboxChecked: false })

    await expect(requestReset()).resolves.toBeUndefined()

    expect(bootConfigSetMock).not.toHaveBeenCalled()
    expect(bootConfigPersistMock).not.toHaveBeenCalled()
    expect(relaunchAfterShutdownMock).not.toHaveBeenCalled()
  })

  it('stages the pending marker for the current userData, persists it, then gracefully relaunches', async () => {
    stubAll(null)

    await requestReset()

    expect(bootConfigSetMock).toHaveBeenCalledWith(
      'temp.data_reset',
      expect.objectContaining({
        status: 'pending',
        userDataPath: USER_DATA,
        // realpath resolves to the lexical path in the fs stub.
        canonicalPath: USER_DATA,
        // The execution side renders its dialogs in the requesting user's language.
        locale: 'zh-CN'
      })
    )
    // Durability ordering: the marker must be on disk before the relaunch fires.
    expect(bootConfigPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
      relaunchAfterShutdownMock.mock.invocationCallOrder[0]
    )
    // Graceful shutdown-then-relaunch, not the bare relaunch: running
    // services must release file handles before the next boot's wipe.
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('clears Chromium storage of both Cherry sessions after the marker is durable', async () => {
    stubAll(null)

    await requestReset()

    for (const s of [defaultSession, webviewSession]) {
      expect(s.clearCache).toHaveBeenCalledTimes(1)
      expect(s.clearStorageData).toHaveBeenCalledTimes(1)
      expect(s.clearAuthCache).toHaveBeenCalledTimes(1)
      // Ordering: the semantic clear runs only on a durably staged marker —
      // a failed persist must not half-clear a session the user keeps using.
      expect(bootConfigPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
        s.clearStorageData.mock.invocationCallOrder[0]
      )
    }
  })

  it('still relaunches when the Chromium clear fails — the wipe pass is the deterministic layer', async () => {
    stubAll(null)
    defaultSession.clearStorageData.mockRejectedValueOnce(new Error('session gone'))

    await expect(requestReset()).resolves.toBeUndefined()
    expect(relaunchAfterShutdownMock).toHaveBeenCalledTimes(1)
  })

  it('rolls the marker back and rejects without relaunching when persist fails', async () => {
    stubAll(null)
    bootConfigPersistMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    await expect(requestReset()).rejects.toThrow('EACCES')

    // The dirty in-memory marker is restored to its previous value, so a
    // later flush (e.g. during shutdown) cannot stage the failed request.
    expect(bootConfigSetMock).toHaveBeenLastCalledWith('temp.data_reset', null)
    expect(relaunchAfterShutdownMock).not.toHaveBeenCalled()
    expect(defaultSession.clearStorageData).not.toHaveBeenCalled()
  })
})
