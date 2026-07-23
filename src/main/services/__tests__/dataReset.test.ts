import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/services/dataReset.ts — both faces: runDataReset (the
 * preboot-timed execution) and requestDataReset (the running-app request).
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `vi.doMock` + `vi.resetModules()` + dynamic import of the module under
 *     test in each scenario.
 *   - `electron`, `node:fs`, `@application`, `@main/i18n`, and
 *     `@main/data/bootConfig` are shadowed per test.
 *   - The pending marker is now a FILE at `feature.data_reset.marker_file`,
 *     not a BootConfig key. The fs stub keeps a small in-memory file map
 *     backing the marker protocol (open/write/fsync/close/rename/unlink/read)
 *     so the atomic write, corrupt-marker rename, and delete-last semantics
 *     are exercised without touching the real filesystem. The wipe pass
 *     (readdir/rm) keeps its own independent mocks for failure injection.
 */

const USER_DATA = '/mock/home/appdata/CherryStudio'
const APP_TEMP = '/mock/tmp/CherryStudio'
const MARKER_FILE = `${USER_DATA}/data-reset.pending.json`
const MARKER_ASIDE = `${USER_DATA}/data-reset.pending.invalid`

const appExitMock = vi.fn()
const appRelaunchMock = vi.fn()
const applicationShutdownMock = vi.fn()
const applicationRelaunchMock = vi.fn()
const showErrorBoxMock = vi.fn()
const showMessageBoxMock = vi.fn()
const rmSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const realpathNativeMock = vi.fn()
const readFileSyncMock = vi.fn()
const openSyncMock = vi.fn()
const writeFileSyncMock = vi.fn()
const fsyncSyncMock = vi.fn()
const closeSyncMock = vi.fn()
const renameSyncMock = vi.fn()
const unlinkSyncMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()
const bootConfigPersistMock = vi.fn()

type DataResetMarker = {
  status: 'pending'
  requestedAt: string
  attempts?: number
  canonicalPath: string
} | null

/** In-memory backing for the marker protocol's fs ops. */
type FsControl = {
  files: Map<string, string>
  fds: Map<number, string>
  nextFd: number
  /** Committed marker versions, in order (each rename onto MARKER_FILE). */
  commits: DataResetMarker[]
  /** When set, openSync throws — models an un-writable marker directory. */
  failWrite: boolean
  /** When set, unlinkSync(MARKER_FILE) throws a non-ENOENT error. */
  failDelete: boolean
}
let fsCtl: FsControl

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
  'cherrystudio.sqlite-personal-backup',
  // kept — the pending marker itself survives its own wipe pass (removed
  // separately, last, by runDataReset).
  'data-reset.pending.json'
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
  'cherrystudio.sqlite-personal-backup',
  'data-reset.pending.json'
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

function stubApplication(userData: string = USER_DATA, opts: { throwOnUserData?: boolean } = {}) {
  vi.doMock('@application', () => ({
    application: {
      getPath: vi.fn((key: string) => {
        if (key === 'app.userdata') {
          if (opts.throwOnUserData) throw new Error('corrupted path registry')
          return userData
        }
        if (key === 'app.temp') return APP_TEMP
        if (key === 'feature.data_reset.marker_file') return `${userData}/data-reset.pending.json`
        return '/mock/unknown'
      }),
      shutdown: applicationShutdownMock,
      relaunch: applicationRelaunchMock
    }
  }))
}

function stubI18n() {
  vi.doMock('@main/i18n', () => ({ t: (key: string) => key }))
}

/** BootConfig now only carries the NON-marker keys the reset restores. */
function stubBootConfig() {
  const store: Record<string, unknown> = {
    'app.disable_hardware_acceleration': true,
    'app.user_data_path': { '/mock/exe': USER_DATA },
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
  fsCtl = { files: new Map(), fds: new Map(), nextFd: 3, commits: [], failWrite: false, failDelete: false }

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

  // --- marker protocol: in-memory file map ---
  readFileSyncMock.mockImplementation((p: string) => {
    if (!fsCtl.files.has(p)) {
      const error = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    return fsCtl.files.get(p)
  })
  openSyncMock.mockImplementation((p: string) => {
    if (fsCtl.failWrite) {
      const error = new Error('EROFS: read-only file system') as NodeJS.ErrnoException
      error.code = 'EROFS'
      throw error
    }
    fsCtl.files.set(p, '')
    const fd = fsCtl.nextFd++
    fsCtl.fds.set(fd, p)
    return fd
  })
  writeFileSyncMock.mockImplementation((target: number | string, data: string) => {
    const p = typeof target === 'number' ? fsCtl.fds.get(target) : target
    if (p === undefined) throw new Error('bad fd')
    fsCtl.files.set(p, String(data))
  })
  fsyncSyncMock.mockImplementation(() => undefined)
  closeSyncMock.mockImplementation((fd: number) => {
    fsCtl.fds.delete(fd)
  })
  renameSyncMock.mockImplementation((from: string, to: string) => {
    if (!fsCtl.files.has(from)) {
      const error = new Error(`ENOENT: no such file or directory, rename '${from}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    const content = fsCtl.files.get(from) as string
    fsCtl.files.set(to, content)
    fsCtl.files.delete(from)
    if (to === MARKER_FILE) {
      try {
        fsCtl.commits.push(JSON.parse(content) as DataResetMarker)
      } catch {
        fsCtl.commits.push(null)
      }
    }
  })
  unlinkSyncMock.mockImplementation((p: string) => {
    if (p === MARKER_FILE && fsCtl.failDelete) {
      const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      throw error
    }
    if (!fsCtl.files.has(p)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${p}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    fsCtl.files.delete(p)
  })

  const realpathSync = Object.assign(vi.fn(), { native: realpathNativeMock })
  const fsMock = {
    readdirSync: readdirSyncMock,
    rmSync: rmSyncMock,
    realpathSync,
    readFileSync: readFileSyncMock,
    openSync: openSyncMock,
    writeFileSync: writeFileSyncMock,
    fsyncSync: fsyncSyncMock,
    closeSync: closeSyncMock,
    renameSync: renameSyncMock,
    unlinkSync: unlinkSyncMock
  }
  vi.doMock('node:fs', () => ({ __esModule: true, default: fsMock, ...fsMock }))
}

function stubAll(marker: DataResetMarker) {
  stubElectron()
  stubApplication()
  stubI18n()
  const store = stubBootConfig()
  stubFs()
  if (marker) seedMarker(marker)
  return store
}

/** Write a valid marker into the in-memory map at this instance's marker path. */
function seedMarker(marker: DataResetMarker): void {
  fsCtl.files.set(MARKER_FILE, JSON.stringify(marker))
}

/** Write arbitrary (possibly corrupt) raw content at the marker path. */
function seedRawMarker(raw: string): void {
  fsCtl.files.set(MARKER_FILE, raw)
}

function markerExists(): boolean {
  return fsCtl.files.has(MARKER_FILE)
}

function readStoredMarker(): DataResetMarker {
  const raw = fsCtl.files.get(MARKER_FILE)
  return raw ? (JSON.parse(raw) as DataResetMarker) : null
}

function pendingMarker(overrides: Partial<NonNullable<DataResetMarker>> = {}): NonNullable<DataResetMarker> {
  return {
    status: 'pending',
    requestedAt: '2026-07-20T00:00:00.000Z',
    canonicalPath: USER_DATA,
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

  it("boots normally when no marker file exists in this userData (a sibling instance's marker lives in its own userData and is invisible here)", async () => {
    stubAll(null)
    // A pending marker sits in a DIFFERENT userData directory; this instance
    // reads only its own marker path, so the foreign marker is never seen.
    fsCtl.files.set('/mock/other/CherryStudioDev/data-reset.pending.json', JSON.stringify(pendingMarker()))
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(fsCtl.commits).toHaveLength(0)
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('wipes exactly the whitelist, resets BootConfig, removes the marker, and relaunches', async () => {
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

    // BootConfig reset: other keys back to defaults, data-dir location
    // preserved; the marker is no longer a BootConfig key so it lives in the
    // file and is removed LAST.
    expect(store['app.disable_hardware_acceleration']).toBe(false)
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': USER_DATA })
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(markerExists()).toBe(false)

    // Post-wipe relaunch into a clean process (#17138 suggestion).
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('leaves the pending marker file in place during the wipe pass', async () => {
    stubAll(pendingMarker())
    // rm nothing so we can observe every rmSync target; the marker is in the
    // listing and must NOT be one of them.
    rmSyncMock.mockImplementation(() => undefined)
    await runReset()

    expect(wipedEntries()).not.toContain(MARKER_FILE)
    // It was removed separately (unlink), last, after a clean pass.
    expect(unlinkSyncMock).toHaveBeenCalledWith(MARKER_FILE)
    expect(markerExists()).toBe(false)
  })

  it('renames a corrupt marker aside and continues booting', async () => {
    stubAll(null)
    seedRawMarker('{ this is not valid json')
    await runReset()

    expect(renameSyncMock).toHaveBeenCalledWith(MARKER_FILE, MARKER_ASIDE)
    expect(fsCtl.files.has(MARKER_ASIDE)).toBe(true)
    expect(markerExists()).toBe(false)
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('renames a schema-invalid marker aside and continues booting', async () => {
    stubAll(null)
    // Valid JSON but fails the zod schema (missing required canonicalPath,
    // attempts is a string). A hand-edited corrupt value can no longer void
    // the cap — it is rejected wholesale.
    seedRawMarker(JSON.stringify({ status: 'pending', requestedAt: 'now', attempts: 'x' }))
    await runReset()

    expect(renameSyncMock).toHaveBeenCalledWith(MARKER_FILE, MARKER_ASIDE)
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('records the canonical physical path with the arming write', async () => {
    stubAll(pendingMarker())
    realpathNativeMock.mockImplementation(() => '/mock/physical/CherryStudio')
    // Match canonicalPath so the mismatch guard passes and the arming write runs.
    seedMarker(pendingMarker({ canonicalPath: '/mock/physical/CherryStudio' }))
    await runReset()

    const armed = fsCtl.commits[0]
    expect(armed?.canonicalPath).toBe('/mock/physical/CherryStudio')
    expect(armed?.attempts).toBe(1)
  })

  it('refuses to wipe when the recorded physical identity no longer matches', async () => {
    stubAll(pendingMarker({ canonicalPath: '/mock/old-target', attempts: 1 }))
    realpathNativeMock.mockImplementation(() => '/mock/new-target')
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(false)
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('quits without wiping when the attempt count cannot be durably recorded', async () => {
    stubAll(pendingMarker())
    fsCtl.failWrite = true
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('relaunches back into preboot when a pass fails with attempts left', async () => {
    stubAll(pendingMarker())
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runReset()

    // The arming write committed attempts:1 and the marker is left pending for
    // the retry pass.
    expect(readStoredMarker()?.attempts).toBe(1)
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(1)
    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it('gives up at the attempt cap: clears the marker, warns, continues boot', async () => {
    stubAll(pendingMarker({ attempts: 1 }))
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runReset()

    expect(markerExists()).toBe(false)
    expect(bootConfigFlushMock).toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('abandons a marker that already reached the attempt cap without another pass', async () => {
    stubAll(pendingMarker({ attempts: 2 }))
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(false)
    expect(showErrorBoxMock).toHaveBeenCalled()
  })

  it('treats an absent attempts value as zero (arms the first pass)', async () => {
    stubAll(pendingMarker())
    await runReset()

    expect(fsCtl.commits[0]?.attempts).toBe(1)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('quits after a clean wipe whose marker cannot be removed', async () => {
    stubAll(pendingMarker())
    fsCtl.failDelete = true
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
    stubBootConfig()
    stubFs(new Error('EACCES: permission denied'))
    seedMarker(pendingMarker())
    await runReset()

    expect(readStoredMarker()?.attempts).toBe(1)
    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledWith(1)
  })

  it('treats a missing userData directory as already clean', async () => {
    stubAll(pendingMarker())
    readdirSyncMock.mockImplementation(() => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })
    await runReset()

    expect(markerExists()).toBe(false)
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('continues boot when the module itself throws unexpectedly', async () => {
    stubElectron()
    stubApplication(USER_DATA, { throwOnUserData: true })
    stubI18n()
    stubBootConfig()
    stubFs()
    seedMarker(pendingMarker())
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

    expect(fsCtl.commits).toHaveLength(0)
    expect(openSyncMock).not.toHaveBeenCalled()
    expect(applicationRelaunchMock).not.toHaveBeenCalled()
  })

  it('writes the pending marker for the current userData, durably, then gracefully relaunches', async () => {
    stubAll(null)

    await requestReset()

    expect(fsCtl.commits[0]).toEqual(
      expect.objectContaining({
        status: 'pending',
        // realpath resolves to the lexical path in the fs stub.
        canonicalPath: USER_DATA
      })
    )
    // The marker's location is the ownership — no userDataPath field.
    expect(fsCtl.commits[0]).not.toHaveProperty('userDataPath')
    // Durably fsync'd before the rename commit.
    expect(fsyncSyncMock).toHaveBeenCalled()
    // Durability ordering: the marker rename (commit) must precede the
    // shutdown sequence tearing services down.
    expect(renameSyncMock.mock.invocationCallOrder[0]).toBeLessThan(applicationShutdownMock.mock.invocationCallOrder[0])
    // Graceful shutdown-then-relaunch, not the bare relaunch: running
    // services must release file handles before the next boot's wipe.
    expect(applicationShutdownMock.mock.invocationCallOrder[0]).toBeLessThan(
      applicationRelaunchMock.mock.invocationCallOrder[0]
    )
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('clears Chromium storage of both Cherry sessions after the marker is durable', async () => {
    stubAll(null)

    await requestReset()

    for (const s of [defaultSession, webviewSession]) {
      expect(s.clearCache).toHaveBeenCalledTimes(1)
      expect(s.clearStorageData).toHaveBeenCalledTimes(1)
      expect(s.clearAuthCache).toHaveBeenCalledTimes(1)
      // Ordering: the semantic clear runs only on a durably written marker —
      // a failed write must not half-clear a session the user keeps using.
      expect(renameSyncMock.mock.invocationCallOrder[0]).toBeLessThan(s.clearStorageData.mock.invocationCallOrder[0])
    }
  })

  it('still relaunches when the Chromium clear fails — the wipe pass is the deterministic layer', async () => {
    stubAll(null)
    defaultSession.clearStorageData.mockRejectedValueOnce(new Error('session gone'))

    await expect(requestReset()).resolves.toBeUndefined()
    expect(applicationRelaunchMock).toHaveBeenCalledTimes(1)
  })

  it('still relaunches when the graceful shutdown itself fails', async () => {
    stubAll(null)
    applicationShutdownMock.mockRejectedValueOnce(new Error('service hung during stop'))

    await expect(requestReset()).resolves.toBeUndefined()

    // The staged marker must win over a broken teardown: a request that
    // shut down halfway but never relaunched would leave the app closed
    // with a pending wipe armed for whenever the user starts it next.
    expect(applicationRelaunchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects without relaunching when the marker write fails', async () => {
    stubAll(null)
    fsCtl.failWrite = true

    await expect(requestReset()).rejects.toThrow('EROFS')

    // No marker was committed and no teardown/relaunch happened — the
    // all-or-nothing write leaves nothing to roll back.
    expect(fsCtl.commits).toHaveLength(0)
    expect(applicationShutdownMock).not.toHaveBeenCalled()
    expect(applicationRelaunchMock).not.toHaveBeenCalled()
    expect(defaultSession.clearStorageData).not.toHaveBeenCalled()
  })
})
