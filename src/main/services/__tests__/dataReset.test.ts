import type * as NodePathModule from 'node:path'

import { createMockApplication } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The in-memory filesystem exercises the reset marker protocol without disk I/O.

const USER_DATA = '/mock/home/appdata/CherryStudio'
const APP_TEMP = '/mock/tmp/CherryStudio'
const MARKER_FILE = `${USER_DATA}/data-reset.pending.json`
const MARKER_ASIDE = `${USER_DATA}/data-reset.pending.invalid`
const DATABASE_FILE = `${USER_DATA}/Data/cherrystudio.sqlite`
const CLAUDE_ROOT = `${USER_DATA}/Data/Agents/.claude`
const VERSION_LOG_FILE = `${USER_DATA}/version.log`
const REGISTRY_OVERRIDE = `${USER_DATA}/Runtime/provider-registry-override`

let applicationMock: ReturnType<typeof createMockApplication>
const showErrorBoxMock = vi.fn()
const showMessageBoxMock = vi.fn()
const appendFileSyncMock = vi.fn()
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

type DataResetMarker =
  | {
      version: 1
      status: 'pending'
      requestedAt: string
      attempts?: number
      canonicalPath: string
      operation?: 'full_reset' | 'v1_remigration'
    }
  | {
      version: 1
      status: 'completed'
      completedAt: string
      operation?: 'full_reset' | 'v1_remigration'
    }
  | null

type FsControl = {
  files: Map<string, string>
  fds: Map<number, string>
  nextFd: number
  commits: DataResetMarker[]
  failWrite: boolean
  failDelete: boolean
  failDirectorySync: boolean
  directorySyncFailuresToSkip: number
  operations: string[]
}
let fsCtl: FsControl

const DEFAULT_LISTING = [
  // Cherry user state
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
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
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
  // User file with a database-like name
  'cherrystudio.sqlite-personal-backup',
  // Marker removed after the wipe commits
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
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
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
  clearData: vi.fn().mockResolvedValue(undefined),
  clearAuthCache: vi.fn().mockResolvedValue(undefined)
})
let defaultSession = makeSession()
let webviewSession = makeSession()

function stubElectron() {
  defaultSession = makeSession()
  webviewSession = makeSession()
  vi.doMock('electron', () => ({
    __esModule: true,
    app: { isPackaged: false },
    dialog: { showErrorBox: showErrorBoxMock, showMessageBox: showMessageBoxMock },
    session: { defaultSession, fromPartition: vi.fn(() => webviewSession) }
  }))
}

function stubApplication(userData: string = USER_DATA, opts: { throwOnUserData?: boolean } = {}) {
  applicationMock = createMockApplication()
  applicationMock.getPath.mockImplementation((key: string) => {
    if (key === 'app.userdata') {
      if (opts.throwOnUserData) throw new Error('corrupted path registry')
      return userData
    }
    if (key === 'app.temp') return APP_TEMP
    if (key === 'feature.data_reset.marker_file') return `${userData}/data-reset.pending.json`
    if (key === 'app.database.file') return `${userData}/Data/cherrystudio.sqlite`
    if (key === 'feature.agents.claude.root') return `${userData}/Data/Agents/.claude`
    if (key === 'feature.version_log.file') return `${userData}/version.log`
    if (key === 'feature.provider_registry.override') return `${userData}/Runtime/provider-registry-override`
    return '/mock/unknown'
  })
  vi.doMock('@application', () => ({ application: applicationMock }))
}

function stubI18n() {
  vi.doMock('@main/i18n', () => ({ t: (key: string) => key }))
}

function stubFs(listing: string[] | Error = DEFAULT_LISTING) {
  fsCtl = {
    files: new Map(),
    fds: new Map(),
    nextFd: 3,
    commits: [],
    failWrite: false,
    failDelete: false,
    failDirectorySync: false,
    directorySyncFailuresToSkip: 0,
    operations: []
  }

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
  appendFileSyncMock.mockImplementation((target: string, data: string) => {
    fsCtl.files.set(target, `${fsCtl.files.get(target) ?? ''}${data}`)
  })
  realpathNativeMock.mockImplementation((p: string) => p)

  readFileSyncMock.mockImplementation((p: string) => {
    if (!fsCtl.files.has(p)) {
      const error = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    return fsCtl.files.get(p)
  })
  openSyncMock.mockImplementation((p: string, flags: string) => {
    if (flags !== 'r' && fsCtl.failWrite) {
      const error = new Error('EROFS: read-only file system') as NodeJS.ErrnoException
      error.code = 'EROFS'
      throw error
    }
    if (flags !== 'r') fsCtl.files.set(p, '')
    const fd = fsCtl.nextFd++
    fsCtl.fds.set(fd, p)
    return fd
  })
  writeFileSyncMock.mockImplementation((target: number | string, data: string) => {
    const p = typeof target === 'number' ? fsCtl.fds.get(target) : target
    if (p === undefined) throw new Error('bad fd')
    fsCtl.files.set(p, String(data))
  })
  fsyncSyncMock.mockImplementation((fd: number) => {
    const p = fsCtl.fds.get(fd)
    if (p) fsCtl.operations.push(`fsync:${p}`)
    if (p === USER_DATA && fsCtl.failDirectorySync) {
      if (fsCtl.directorySyncFailuresToSkip > 0) {
        fsCtl.directorySyncFailuresToSkip--
        return
      }
      throw new Error('EIO: failed to sync marker directory')
    }
  })
  closeSyncMock.mockImplementation((fd: number) => {
    fsCtl.fds.delete(fd)
  })
  renameSyncMock.mockImplementation((from: string, to: string) => {
    fsCtl.operations.push(`rename:${to}`)
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
    fsCtl.operations.push(`unlink:${p}`)
  })

  const realpathSync = Object.assign(vi.fn(), { native: realpathNativeMock })
  const fsMock = {
    appendFileSync: appendFileSyncMock,
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

// The in-memory filesystem above is keyed by POSIX literals, so the module under test
// has to join them the same way regardless of host.
function stubPath() {
  vi.doMock('node:path', async () => {
    const actual: typeof NodePathModule = await vi.importActual('node:path')
    return { __esModule: true, default: actual.posix, ...actual.posix }
  })
}

function stubAll(marker: DataResetMarker) {
  stubElectron()
  stubApplication()
  stubI18n()
  stubFs()
  stubPath()
  if (marker) seedMarker(marker)
}

function seedMarker(marker: DataResetMarker): void {
  fsCtl.files.set(MARKER_FILE, JSON.stringify(marker))
}

function seedRawMarker(raw: string): void {
  fsCtl.files.set(MARKER_FILE, raw)
}

function seedRawVersionLog(raw: string): void {
  fsCtl.files.set(VERSION_LOG_FILE, raw)
}

function markerExists(): boolean {
  return fsCtl.files.has(MARKER_FILE)
}

function readStoredMarker(): DataResetMarker {
  const raw = fsCtl.files.get(MARKER_FILE)
  return raw ? (JSON.parse(raw) as DataResetMarker) : null
}

type PendingMarker = Extract<NonNullable<DataResetMarker>, { status: 'pending' }>
type CompletedMarker = Extract<NonNullable<DataResetMarker>, { status: 'completed' }>

function pendingMarker(overrides: Partial<PendingMarker> = {}): PendingMarker {
  return {
    version: 1,
    status: 'pending',
    requestedAt: '2026-07-20T00:00:00.000Z',
    canonicalPath: USER_DATA,
    ...overrides
  }
}

function completedMarker(): CompletedMarker {
  return {
    version: 1,
    status: 'completed',
    completedAt: '2026-07-21T00:00:00.000Z'
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

async function requestRemigration() {
  const { requestV1Remigration } = await import('../dataReset')
  return requestV1Remigration()
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
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it("boots normally when no marker file exists in this userData (a sibling instance's marker lives in its own userData and is invisible here)", async () => {
    stubAll(null)
    fsCtl.files.set('/mock/other/CherryStudioDev/data-reset.pending.json', JSON.stringify(pendingMarker()))
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(fsCtl.commits).toHaveLength(0)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('wipes exactly the whitelist, commits a completed record, removes the marker, and relaunches', async () => {
    stubAll(pendingMarker())
    await runReset()

    const wiped = wipedEntries()
    for (const entry of EXPECTED_WIPED) {
      expect(wiped).toContain(`${USER_DATA}/${entry}`)
    }
    for (const entry of EXPECTED_KEPT) {
      expect(wiped).not.toContain(`${USER_DATA}/${entry}`)
    }
    expect(rmSyncMock).toHaveBeenCalledWith(APP_TEMP, expect.anything())
    expect(rmSyncMock).toHaveBeenCalledWith(REGISTRY_OVERRIDE, expect.anything())

    expect(fsCtl.commits.map((c) => c?.status)).toEqual(['pending', 'completed'])
    expect(markerExists()).toBe(false)

    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('treats a legacy marker without an operation as a full reset', async () => {
    stubAll(pendingMarker())
    await runReset()

    expect(wipedEntries()).toContain(`${USER_DATA}/Data`)
    expect(rmSyncMock).toHaveBeenCalledWith(APP_TEMP, expect.anything())
    expect(appendFileSyncMock).not.toHaveBeenCalled()
    expect(fsCtl.commits.at(-1)).toMatchObject({ status: 'completed', operation: 'full_reset' })
  })

  it('removes only current v2 migration targets without modifying version history', async () => {
    stubAll(pendingMarker({ operation: 'v1_remigration' }))
    const versionLog =
      '1.7.21|mac|prod|unpackaged|install|2026-08-05T13:34:28.984Z\n' +
      '2.0.0|mac|prod|packaged|install|2026-08-05T14:01:04.323Z\n'
    seedRawVersionLog(versionLog)
    await runReset()

    expect(rmSyncMock.mock.calls.map(([target]) => target)).toEqual([
      `${DATABASE_FILE}-wal`,
      `${DATABASE_FILE}-shm`,
      CLAUDE_ROOT,
      DATABASE_FILE
    ])
    expect(appendFileSyncMock).not.toHaveBeenCalled()
    expect(fsCtl.files.get(VERSION_LOG_FILE)).toBe(versionLog)

    expect(rmSyncMock).not.toHaveBeenCalledWith(APP_TEMP, expect.anything())
    expect(fsCtl.commits.at(-1)).toMatchObject({
      status: 'completed',
      operation: 'v1_remigration'
    })
    expect(markerExists()).toBe(false)
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed remigration pending, refuses to boot, and retries on the next launch', async () => {
    stubAll(pendingMarker({ operation: 'v1_remigration' }))
    rmSyncMock.mockImplementation((target: string) => {
      if (target === `${DATABASE_FILE}-shm`) throw new Error('EBUSY: resource busy')
    })

    await runReset()

    expect(readStoredMarker()).toMatchObject({ status: 'pending', operation: 'v1_remigration', attempts: 1 })
    expect(rmSyncMock).not.toHaveBeenCalledWith(DATABASE_FILE, expect.anything())
    expect(showErrorBoxMock).toHaveBeenCalledWith('Migration Reset Failed', expect.any(String))
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()

    vi.clearAllMocks()
    rmSyncMock.mockImplementation(() => undefined)
    await runReset()

    expect(markerExists()).toBe(false)
    expect(rmSyncMock).toHaveBeenCalledWith(DATABASE_FILE, expect.anything())
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
  })

  it('fsyncs the marker parent directory after each marker rename and unlink on POSIX', async () => {
    if (process.platform === 'win32') return
    stubAll(pendingMarker())
    await runReset()

    const markerOps = fsCtl.operations.filter((op) =>
      [`rename:${MARKER_FILE}`, `fsync:${USER_DATA}`, `unlink:${MARKER_FILE}`].includes(op)
    )
    expect(markerOps).toEqual([
      `rename:${MARKER_FILE}`,
      `fsync:${USER_DATA}`,
      `rename:${MARKER_FILE}`,
      `fsync:${USER_DATA}`,
      `unlink:${MARKER_FILE}`,
      `fsync:${USER_DATA}`
    ])
  })

  it('leaves the pending marker file in place during the wipe pass', async () => {
    stubAll(pendingMarker())
    rmSyncMock.mockImplementation(() => undefined)
    await runReset()

    expect(wipedEntries()).not.toContain(MARKER_FILE)
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
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('quits without wiping when the marker cannot be read', async () => {
    stubAll(null)
    const error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    readFileSyncMock.mockImplementation(() => {
      throw error
    })

    await runReset()

    expect(renameSyncMock).not.toHaveBeenCalled()
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('quits without wiping when an invalid marker cannot be quarantined', async () => {
    stubAll(null)
    seedRawMarker('{ this is not valid json')
    renameSyncMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    await runReset()

    expect(markerExists()).toBe(true)
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('renames a schema-invalid marker aside and continues booting', async () => {
    stubAll(null)
    seedRawMarker(JSON.stringify({ status: 'pending', requestedAt: 'now', attempts: 'x' }))
    await runReset()

    expect(renameSyncMock).toHaveBeenCalledWith(MARKER_FILE, MARKER_ASIDE)
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('records the canonical physical path with the arming write', async () => {
    stubAll(pendingMarker())
    realpathNativeMock.mockImplementation(() => '/mock/physical/CherryStudio')
    seedMarker(pendingMarker({ canonicalPath: '/mock/physical/CherryStudio' }))
    await runReset()

    expect(fsCtl.commits[0]).toMatchObject({
      canonicalPath: '/mock/physical/CherryStudio',
      attempts: 1
    })
  })

  it('refuses to wipe when the recorded physical identity no longer matches', async () => {
    stubAll(pendingMarker({ canonicalPath: '/mock/old-target', attempts: 1 }))
    realpathNativeMock.mockImplementation(() => '/mock/new-target')
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(false)
    expect(showErrorBoxMock).toHaveBeenCalledWith('Data Reset Cancelled', expect.any(String))
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('quits without wiping when the current physical identity cannot be resolved', async () => {
    stubAll(pendingMarker())
    realpathNativeMock.mockImplementation(() => {
      throw new Error('EACCES: cannot resolve userData')
    })
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(true)
    expect(showErrorBoxMock).toHaveBeenCalledWith('Data Reset Failed', expect.any(String))
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('quits without wiping when the attempt count cannot be durably recorded', async () => {
    stubAll(pendingMarker())
    fsCtl.failWrite = true
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('relaunches back into preboot when a pass fails with attempts left', async () => {
    stubAll(pendingMarker())
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runReset()

    expect(readStoredMarker()).toMatchObject({ status: 'pending', attempts: 1 })
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it('gives up at the attempt cap: clears the marker, warns, continues boot', async () => {
    stubAll(pendingMarker({ attempts: 1 }))
    rmSyncMock.mockImplementation((target: string) => {
      if (String(target).endsWith('/Data')) throw new Error('EBUSY: resource busy')
    })
    await runReset()

    expect(markerExists()).toBe(false)
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('abandons a marker that already reached the attempt cap without another pass', async () => {
    stubAll(pendingMarker({ attempts: 2 }))
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(false)
    expect(showErrorBoxMock).toHaveBeenCalled()
  })

  it('quits rather than booting writable when abandoning a marker fails', async () => {
    stubAll(pendingMarker({ attempts: 2 }))
    fsCtl.failDelete = true
    await runReset()

    expect(markerExists()).toBe(true)
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('treats an absent attempts value as zero (arms the first pass)', async () => {
    stubAll(pendingMarker())
    await runReset()

    expect(fsCtl.commits[0]).toMatchObject({ attempts: 1 })
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('quits after a clean wipe when the completion record cannot be durably committed', async () => {
    if (process.platform === 'win32') return
    stubAll(pendingMarker())
    fsCtl.failDirectorySync = true
    fsCtl.directorySyncFailuresToSkip = 1
    await runReset()

    expect(readStoredMarker()?.status).toBe('completed')
    expect(showErrorBoxMock).toHaveBeenCalledWith('Data Reset Incomplete', expect.any(String))
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('relaunches after a clean wipe even when the marker unlink cannot be proven durable', async () => {
    if (process.platform === 'win32') return
    stubAll(pendingMarker())
    fsCtl.failDirectorySync = true
    fsCtl.directorySyncFailuresToSkip = 2
    await runReset()

    expect(showErrorBoxMock).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('relaunches after a clean wipe even when the completed marker cannot be removed', async () => {
    stubAll(pendingMarker())
    fsCtl.failDelete = true
    await runReset()

    expect(readStoredMarker()?.status).toBe('completed')
    expect(showErrorBoxMock).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('recognizes a resurrected completed marker: clears it and boots normally without wiping', async () => {
    stubAll(completedMarker())
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(false)
    expect(showErrorBoxMock).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('fails closed across boots until the completed record is proven durable', async () => {
    if (process.platform === 'win32') return
    stubAll(pendingMarker())
    // First boot
    fsCtl.failDirectorySync = true
    fsCtl.directorySyncFailuresToSkip = 1
    await runReset()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(readStoredMarker()?.status).toBe('completed')

    // Second boot
    vi.clearAllMocks()
    await runReset()
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()

    // Third boot
    vi.clearAllMocks()
    fsCtl.failDirectorySync = false
    await runReset()
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(false)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('boots normally even when a resurrected completed marker cannot be cleared', async () => {
    stubAll(completedMarker())
    fsCtl.failDelete = true
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(markerExists()).toBe(true)
    expect(showErrorBoxMock).not.toHaveBeenCalled()
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it.each([
    ['negative attempts', { ...pendingMarker(), attempts: -100 }],
    ['fractional attempts', { ...pendingMarker(), attempts: 0.5 }],
    ['missing version', { status: 'pending', requestedAt: 'now', canonicalPath: USER_DATA }],
    ['unknown extra field', { ...pendingMarker(), extra: true }],
    ['unknown status', { version: 1, status: 'wiping', requestedAt: 'now', canonicalPath: USER_DATA }]
  ])('quarantines a schema-valid-looking marker (%s) without wiping', async (_name, raw) => {
    stubAll(null)
    seedRawMarker(JSON.stringify(raw))
    await runReset()

    expect(renameSyncMock).toHaveBeenCalledWith(MARKER_FILE, MARKER_ASIDE)
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
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
    stubFs(new Error('EACCES: permission denied'))
    seedMarker(pendingMarker())
    await runReset()

    expect(readStoredMarker()).toMatchObject({ status: 'pending', attempts: 1 })
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
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
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('quits when the module itself throws unexpectedly', async () => {
    stubElectron()
    stubApplication(USER_DATA, { throwOnUserData: true })
    stubI18n()
    stubFs()
    seedMarker(pendingMarker())
    await runReset()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(showErrorBoxMock).toHaveBeenCalled()
    expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })
})

describe('requestDataReset', () => {
  beforeEach(() => {
    showMessageBoxMock.mockResolvedValue({ response: 1, checkboxChecked: false })
  })

  it('resolves without staging anything when the user cancels the native confirmation', async () => {
    stubAll(null)
    showMessageBoxMock.mockResolvedValue({ response: 0, checkboxChecked: false })

    await expect(requestReset()).resolves.toBeUndefined()

    expect(fsCtl.commits).toHaveLength(0)
    expect(openSyncMock).not.toHaveBeenCalled()
    expect(defaultSession.clearData).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('writes the pending marker for the current userData, durably, then gracefully relaunches', async () => {
    stubAll(null)

    await requestReset()

    expect(fsCtl.commits[0]).toEqual(
      expect.objectContaining({
        version: 1,
        status: 'pending',
        canonicalPath: USER_DATA,
        operation: 'full_reset'
      })
    )
    expect(fsCtl.commits[0]).not.toHaveProperty('userDataPath')
    expect(fsyncSyncMock).toHaveBeenCalled()
    expect(renameSyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      applicationMock.shutdown.mock.invocationCallOrder[0]
    )
    expect(applicationMock.shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      applicationMock.relaunch.mock.invocationCallOrder[0]
    )
  })

  it('rejects before staging when the current physical identity cannot be resolved', async () => {
    stubAll(null)
    realpathNativeMock.mockImplementation(() => {
      throw new Error('EACCES: cannot resolve userData')
    })

    await expect(requestReset()).rejects.toThrow('cannot resolve userData')

    expect(fsCtl.commits).toHaveLength(0)
    expect(markerExists()).toBe(false)
    expect(defaultSession.clearData).not.toHaveBeenCalled()
    expect(applicationMock.shutdown).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })

  it('uses the guarded graceful relaunch when the marker rename commits but its directory fsync fails', async () => {
    if (process.platform === 'win32') return
    stubAll(null)
    fsCtl.failDirectorySync = true

    await expect(requestReset()).resolves.toBeUndefined()

    expect(fsCtl.commits).toHaveLength(1)
    expect(markerExists()).toBe(true)
    expect(applicationMock.shutdown).toHaveBeenCalledTimes(1)
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
    expect(applicationMock.forceExit).not.toHaveBeenCalled()
  })

  it('clears both Chromium sessions after the marker is durable and before shutdown', async () => {
    stubAll(null)

    await requestReset()

    for (const target of [defaultSession, webviewSession]) {
      expect(target.clearData).toHaveBeenCalledTimes(1)
      expect(target.clearAuthCache).toHaveBeenCalledTimes(1)
      expect(renameSyncMock.mock.invocationCallOrder[0]).toBeLessThan(target.clearData.mock.invocationCallOrder[0])
      expect(target.clearData.mock.invocationCallOrder[0]).toBeLessThan(
        applicationMock.shutdown.mock.invocationCallOrder[0]
      )
    }
  })

  it('still relaunches when a Chromium clear fails', async () => {
    stubAll(null)
    defaultSession.clearData.mockRejectedValueOnce(new Error('session gone'))

    await expect(requestReset()).resolves.toBeUndefined()

    expect(defaultSession.clearAuthCache).toHaveBeenCalledTimes(1)
    expect(webviewSession.clearData).toHaveBeenCalledTimes(1)
    expect(applicationMock.shutdown).toHaveBeenCalledTimes(1)
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
  })

  it('bounds a Chromium clear that never settles after the marker is staged', async () => {
    stubAll(null)
    defaultSession.clearData.mockImplementation(() => new Promise(() => {}))
    const { requestDataReset } = await import('../dataReset')
    vi.useFakeTimers()

    try {
      const request = requestDataReset()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(request).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }

    expect(markerExists()).toBe(true)
    expect(applicationMock.shutdown).toHaveBeenCalledTimes(1)
    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
  })

  it('still relaunches when the graceful shutdown itself fails', async () => {
    stubAll(null)
    applicationMock.shutdown.mockRejectedValueOnce(new Error('service hung during stop'))

    await expect(requestReset()).resolves.toBeUndefined()

    expect(applicationMock.relaunch).toHaveBeenCalledTimes(1)
  })

  it('rejects without relaunching when the marker write fails', async () => {
    stubAll(null)
    fsCtl.failWrite = true

    await expect(requestReset()).rejects.toThrow('EROFS')

    expect(fsCtl.commits).toHaveLength(0)
    expect(defaultSession.clearData).not.toHaveBeenCalled()
    expect(applicationMock.shutdown).not.toHaveBeenCalled()
    expect(applicationMock.relaunch).not.toHaveBeenCalled()
  })
})

describe('requestV1Remigration', () => {
  it('stages a remigration without native confirmation or clearing Chromium state', async () => {
    stubAll(null)

    await requestRemigration()

    expect(fsCtl.commits[0]).toMatchObject({
      version: 1,
      status: 'pending',
      canonicalPath: USER_DATA,
      operation: 'v1_remigration'
    })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(defaultSession.clearData).not.toHaveBeenCalled()
    expect(defaultSession.clearAuthCache).not.toHaveBeenCalled()
    expect(webviewSession.clearData).not.toHaveBeenCalled()
    expect(webviewSession.clearAuthCache).not.toHaveBeenCalled()
    expect(renameSyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      applicationMock.shutdown.mock.invocationCallOrder[0]
    )
    expect(applicationMock.shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      applicationMock.relaunch.mock.invocationCallOrder[0]
    )
  })
})
