import fs from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for the v1→v2 legacy custom-userData recovery.
 *
 * v1 records which data directory belongs to which *executable path* in
 * ~/.cherrystudio/config/config.json:
 *
 *   { "appDataPath": [ { "executablePath": "...", "dataPath": "..." } ] }
 *
 * The old resolver only accepted an entry when `executablePath` matched the
 * running executable EXACTLY, so any exe-path change across the v1→v2 upgrade
 * (new appId, reinstall to a new location) returned null, migration ran
 * against an empty default directory, and the user's data appeared lost.
 *
 * Reported real config (single entry):
 *   executablePath: D:\Cherry Studio\Cherry Studio.exe   (v1 custom install dir)
 *   dataPath:       E:\Dropbox\Cherry Data\CherryStudio   (custom data dir, still on disk)
 *
 * Coverage is split in two:
 *   - `selectLegacyUserData` — the pure decision matrix (A0/A1/B1–B4), driven
 *     by an injected probe so no fs/electron plumbing is needed.
 *   - `resolveMigrationPaths` — the integration wiring (setPath, boot-config
 *     write, legacyDataConfirmed) against a path-aware node:fs mock.
 */

const CONFIG_FILE = '/mock/home/.cherrystudio/config/config.json'
const DEFAULT_USER_DATA = '/mock/userData'

const h = vi.hoisted(() => ({
  getPath: vi.fn((key: string): string => (key === 'userData' ? '/mock/userData' : '/mock/unknown')),
  setPath: vi.fn(),
  getVersion: vi.fn((): string => '2.0.0'),
  normalizedExe: vi.fn((): string => '/current/exe'),
  bootGet: vi.fn((): unknown => undefined),
  bootSet: vi.fn(),
  bootPersist: vi.fn()
}))

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  const m = await createNodeFsMock()
  // createNodeFsMock keeps accessSync real; isUsableDataDir() probes it, so
  // replace it with a controllable spy (default: everything is accessible).
  const accessSync = vi.fn()
  return { ...m, accessSync, default: { ...m.default, accessSync } }
})

vi.mock('electron', () => ({
  __esModule: true,
  app: { getPath: h.getPath, setPath: h.setPath, getVersion: h.getVersion }
}))

// Partial mock: keep the REAL isUsableDataDir (it runs against the mocked
// node:fs above, so the validator-tightening integration cases exercise real
// logic), stub only the exe normalization.
vi.mock('@main/core/preboot/userDataLocation', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getNormalizedExecutablePath: h.normalizedExe }
})

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { get: h.bootGet, set: h.bootSet, persist: h.bootPersist }
}))

vi.mock('@main/core/paths/constants', () => ({
  CHERRY_HOME: '/mock/home/.cherrystudio',
  CHERRY_HOME_DIRNAME: '.cherrystudio',
  BOOT_CONFIG_PATH: '/mock/home/.cherrystudio/boot-config.json'
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

// Imported after the mocks are declared so the module binds to them.
import { resolveMigrationPaths, selectLegacyUserData } from '../MigrationPaths'

// ── Pure decision matrix ────────────────────────────────────────────

/** A fully-controllable probe; every predicate defaults to the boring case. */
function probe(over: Partial<Parameters<typeof selectLegacyUserData>[0]['probe']> = {}) {
  return {
    isUsableDir: over.isUsableDir ?? (() => true),
    hasV1Data: over.hasV1Data ?? (() => false),
    hasValidSqlite: over.hasValidSqlite ?? (() => false),
    versionOk: over.versionOk ?? (() => true),
    mtimeOf: over.mtimeOf ?? (() => 0)
  }
}

describe('selectLegacyUserData', () => {
  it('A0: current userData has a non-empty sqlite → keep it, no redirect', () => {
    // Locks the scope trade-off: a pre-fix user who already got a default
    // sqlite + markCompleted is NOT dragged back to the custom dir.
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/old/exe', dataPath: '/custom/data' }],
      currentExe: '/current/exe',
      probe: probe({
        hasValidSqlite: (d) => d === DEFAULT_USER_DATA,
        // The stale custom entry would otherwise be eligible.
        hasV1Data: () => true
      })
    })
    expect(result).toEqual({ kind: 'keep' })
  })

  it('A1: exact exe mapping to a usable non-default dir → redirect without notice', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/current/exe', dataPath: '/custom/data' }],
      currentExe: '/current/exe',
      probe: probe()
    })
    expect(result).toEqual({ kind: 'redirect', target: '/custom/data', notice: false })
  })

  it('A1: exact exe mapping that resolves to the current default → no redirect', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/current/exe', dataPath: DEFAULT_USER_DATA }],
      currentExe: '/current/exe',
      probe: probe()
    })
    expect(result).toEqual({ kind: 'default' })
  })

  it('A1: exact exe mapping to an inaccessible dir → inaccessible (never fuzzy)', () => {
    // a2: exact dir gone; a stale eligible entry exists but must NOT be silently used.
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [
        { executablePath: '/current/exe', dataPath: '/unmounted/custom' },
        { executablePath: '/old/exe', dataPath: '/stale/eligible' }
      ],
      currentExe: '/current/exe',
      probe: probe({
        isUsableDir: (d) => d !== '/unmounted/custom',
        hasV1Data: (d) => d === '/stale/eligible'
      })
    })
    expect(result).toEqual({ kind: 'inaccessible', path: '/unmounted/custom' })
  })

  it('A1: exact dir usable but version-ineligible, stale eligible entry exists → still picks exact dir', () => {
    // a1: A1 authority short-circuits BEFORE the fuzzy mtime pass; the version
    // gate downstream decides migrate/block for the exact dir.
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [
        { executablePath: '/current/exe', dataPath: '/exact/dir' },
        { executablePath: '/old/exe', dataPath: '/stale/eligible' }
      ],
      currentExe: '/current/exe',
      probe: probe({
        hasV1Data: () => true,
        versionOk: (d) => d !== '/exact/dir', // exact dir is version-ineligible
        mtimeOf: (d) => (d === '/stale/eligible' ? 999 : 1)
      })
    })
    expect(result).toEqual({ kind: 'redirect', target: '/exact/dir', notice: false })
  })

  it('A1: exact dir usable but empty (no v1 marker), real-data eligible entry exists → still picks exact dir', () => {
    // a3: an explicit exe mapping is authoritative even when empty — do not
    // "helpfully" fuzzy-recover another entry.
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [
        { executablePath: '/current/exe', dataPath: '/exact/empty' },
        { executablePath: '/old/exe', dataPath: '/other/realdata' }
      ],
      currentExe: '/current/exe',
      probe: probe({
        hasV1Data: (d) => d === '/other/realdata',
        mtimeOf: (d) => (d === '/other/realdata' ? 999 : 1)
      })
    })
    expect(result).toEqual({ kind: 'redirect', target: '/exact/empty', notice: false })
  })

  it('B1: single eligible entry (no exact match) → redirect with notice', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/old/exe', dataPath: '/custom/data' }],
      currentExe: '/current/exe',
      probe: probe({ hasV1Data: (d) => d === '/custom/data' })
    })
    expect(result).toEqual({ kind: 'redirect', target: '/custom/data', notice: true })
  })

  it('keeps a fresh Windows portable build isolated from setup data', () => {
    const result = selectLegacyUserData({
      currentUserData: 'D:\\Portable\\data',
      entries: [{ executablePath: 'C:\\Program Files\\CherryStudio\\CherryStudio.exe', dataPath: '/setup/data' }],
      currentExe: 'D:\\Portable\\cherry-studio-portable.exe',
      probe: probe({ hasV1Data: (d) => d === '/setup/data' })
    })
    expect(result).toEqual({ kind: 'default' })
  })

  it('keeps different Windows portable locations isolated without an exact mapping', () => {
    const result = selectLegacyUserData({
      currentUserData: 'D:\\NewPortable\\data',
      entries: [{ executablePath: 'E:\\OldPortable\\cherry-studio-portable.exe', dataPath: 'E:\\OldPortable\\data' }],
      currentExe: 'D:\\NewPortable\\cherry-studio-portable.exe',
      probe: probe({ hasV1Data: (d) => d === 'E:\\OldPortable\\data' })
    })
    expect(result).toEqual({ kind: 'default' })
  })

  it('keeps a fresh Windows setup build isolated from portable data', () => {
    const result = selectLegacyUserData({
      currentUserData: 'C:\\Users\\Alice\\AppData\\Roaming\\CherryStudio',
      entries: [{ executablePath: 'D:\\Portable\\cherry-studio-portable.exe', dataPath: 'D:\\Portable\\data' }],
      currentExe: 'C:\\Program Files\\CherryStudio\\CherryStudio.exe',
      probe: probe({ hasV1Data: (d) => d === 'D:\\Portable\\data' })
    })
    expect(result).toEqual({ kind: 'default' })
  })

  it('B1: multiple eligible entries → picks the most-recently-used by mtime', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [
        { executablePath: '/a/exe', dataPath: '/data/older' },
        { executablePath: '/b/exe', dataPath: '/data/newer' }
      ],
      currentExe: '/current/exe',
      probe: probe({
        hasV1Data: () => true,
        mtimeOf: (d) => (d === '/data/newer' ? 200 : 100)
      })
    })
    expect(result).toEqual({ kind: 'redirect', target: '/data/newer', notice: true })
  })

  it('B2: candidate with v1 data but version-ineligible → redirect without notice (gate will block)', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/old/exe', dataPath: '/too/old' }],
      currentExe: '/current/exe',
      probe: probe({
        hasV1Data: (d) => d === '/too/old',
        versionOk: () => false
      })
    })
    expect(result).toEqual({ kind: 'redirect', target: '/too/old', notice: false })
  })

  it('B3: no candidate but an entry dataPath is not usable → inaccessible', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/old/exe', dataPath: '/unmounted/drive' }],
      currentExe: '/current/exe',
      probe: probe({ isUsableDir: (d) => d === DEFAULT_USER_DATA })
    })
    expect(result).toEqual({ kind: 'inaccessible', path: '/unmounted/drive' })
  })

  it('B4: no entries and no recoverable data → default (keep current, no redirect)', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [],
      currentExe: '/current/exe',
      probe: probe()
    })
    expect(result).toEqual({ kind: 'default' })
  })

  it('小王: default dir holds the real (more recent) data + a stale custom entry → keeps default', () => {
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/old/exe', dataPath: '/stale/custom' }],
      currentExe: '/current/exe',
      probe: probe({
        hasV1Data: () => true,
        mtimeOf: (d) => (d === DEFAULT_USER_DATA ? 900 : 100) // default used most recently
      })
    })
    expect(result).toEqual({ kind: 'default' })
  })

  it('normalizes trailing separators when matching the exact exe entry', () => {
    // The mapping resolves to the current default (with a trailing sep) → no redirect.
    const result = selectLegacyUserData({
      currentUserData: DEFAULT_USER_DATA,
      entries: [{ executablePath: '/current/exe', dataPath: `${DEFAULT_USER_DATA}/` }],
      currentExe: '/current/exe',
      probe: probe()
    })
    expect(result).toEqual({ kind: 'default' })
  })
})

// ── resolveMigrationPaths integration ───────────────────────────────

const REAL_USER_CONFIG = JSON.stringify({
  appDataPath: [
    { executablePath: 'D:\\Cherry Studio\\Cherry Studio.exe', dataPath: 'E:\\Dropbox\\Cherry Data\\CherryStudio' }
  ]
})

const GOOD_VERSION_LOG = '1.9.12|darwin|production|true|normal|2025-03-01T00:00:00Z'

// Build marker sub-paths with the SAME (real) path.join production uses, so
// keys match regardless of separator quirks on the POSIX test host.
const marker = (dir: string, name: string) => path.join(dir, name)

interface FsDesc {
  /** Paths that statSync reports as directories. */
  dirs?: string[]
  /** Full sqlite file path → byte size (statSync isFile). */
  sqlite?: Record<string, number>
  /** Path → readFileSync content (also existsSync-true). */
  contents?: Record<string, string>
  /** Extra existsSync-true paths (markers with no readable content needed). */
  exists?: string[]
  /** Directory → mtimeMs for the B1 recency tie-break. */
  mtimes?: Record<string, number>
}

function applyFs(desc: FsDesc) {
  const dirs = new Set(desc.dirs ?? [])
  const sqlite = desc.sqlite ?? {}
  const contents = desc.contents ?? {}
  const mtimes = desc.mtimes ?? {}
  const existsSet = new Set<string>([...dirs, ...Object.keys(sqlite), ...Object.keys(contents), ...(desc.exists ?? [])])

  vi.mocked(fs.existsSync).mockImplementation((p) => existsSet.has(p as string))
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const c = contents[p as string]
    if (c === undefined) throw new Error(`ENOENT: ${String(p)}`)
    return c as never
  })
  vi.mocked(fs.statSync).mockImplementation((p) => {
    const key = p as string
    if (dirs.has(key)) {
      return { isDirectory: () => true, isFile: () => false, size: 0, mtimeMs: mtimes[key] ?? 1 } as fs.Stats
    }
    if (key in sqlite) {
      return { isDirectory: () => false, isFile: () => true, size: sqlite[key], mtimeMs: 0 } as fs.Stats
    }
    throw new Error(`ENOENT: ${key}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getPath.mockImplementation((key: string) => (key === 'userData' ? DEFAULT_USER_DATA : '/mock/unknown'))
  h.getVersion.mockReturnValue('2.0.0')
  h.normalizedExe.mockReturnValue('/current/exe')
  h.bootGet.mockReturnValue(undefined)
})

describe('resolveMigrationPaths — legacy custom userData recovery', () => {
  it('redirects to the matching entry when the current exe matches exactly (regression guard)', () => {
    h.normalizedExe.mockReturnValue('D:\\Cherry Studio\\Cherry Studio.exe')
    applyFs({
      dirs: ['E:\\Dropbox\\Cherry Data\\CherryStudio'],
      contents: {
        [CONFIG_FILE]: REAL_USER_CONFIG,
        [marker('E:\\Dropbox\\Cherry Data\\CherryStudio', 'version.log')]: GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.paths.userData).toBe('E:\\Dropbox\\Cherry Data\\CherryStudio')
    expect(result.userDataChanged).toBe(true)
    expect(result.legacyDataConfirmed).toBe(true)
    expect(h.setPath).toHaveBeenCalledWith('userData', 'E:\\Dropbox\\Cherry Data\\CherryStudio')
  })

  it('recovers the sole recorded dataPath when v2 was reinstalled to a new location (exe no longer matches)', () => {
    h.normalizedExe.mockReturnValue('C:\\Users\\me\\AppData\\Local\\Programs\\cherrystudio\\Cherry Studio.exe')
    applyFs({
      dirs: ['E:\\Dropbox\\Cherry Data\\CherryStudio'],
      contents: {
        [CONFIG_FILE]: REAL_USER_CONFIG,
        [marker('E:\\Dropbox\\Cherry Data\\CherryStudio', 'version.log')]: GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.paths.userData).toBe('E:\\Dropbox\\Cherry Data\\CherryStudio')
    expect(result.userDataChanged).toBe(true)
    // B1 fuzzy recovery → notice surfaced to the introduction screen.
    expect(result.dataLocation).toBe('E:\\Dropbox\\Cherry Data\\CherryStudio')
    expect(h.setPath).toHaveBeenCalledWith('userData', 'E:\\Dropbox\\Cherry Data\\CherryStudio')
  })

  it('recovers the only on-disk dataPath among multiple entries when none match the current exe', () => {
    h.normalizedExe.mockReturnValue('/new/install/exe')
    applyFs({
      dirs: ['/Volumes/Data/CherryStudio'],
      contents: {
        [CONFIG_FILE]: JSON.stringify({
          appDataPath: [
            { executablePath: '/old/portable/exe', dataPath: '/removed/usb/CherryStudio' },
            { executablePath: '/old/install/exe', dataPath: '/Volumes/Data/CherryStudio' }
          ]
        }),
        '/Volumes/Data/CherryStudio/version.log': GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.paths.userData).toBe('/Volumes/Data/CherryStudio')
    expect(result.userDataChanged).toBe(true)
    expect(h.setPath).toHaveBeenCalledWith('userData', '/Volumes/Data/CherryStudio')
  })

  it('string-form config synthesizes an exact entry → recovers even when the exe changed', () => {
    // Legacy string form applied to ALL executables; it must still win.
    h.normalizedExe.mockReturnValue('/some/new/exe')
    applyFs({
      dirs: ['/legacy/string/data'],
      contents: {
        [CONFIG_FILE]: JSON.stringify({ appDataPath: '/legacy/string/data' }),
        '/legacy/string/data/version.log': GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.paths.userData).toBe('/legacy/string/data')
    expect(result.userDataChanged).toBe(true)
    // A1 (synthetic exact) path → no notice.
    expect(result.dataLocation).toBeUndefined()
    expect(h.setPath).toHaveBeenCalledWith('userData', '/legacy/string/data')
  })

  it('ordinary user with no appDataPath → no redirect, no setPath, legacyDataConfirmed=false', () => {
    applyFs({
      dirs: [DEFAULT_USER_DATA],
      contents: { [CONFIG_FILE]: JSON.stringify({}) }
    })

    const result = resolveMigrationPaths()

    expect(result.userDataChanged).toBe(false)
    expect(result.legacyDataConfirmed).toBe(false)
    expect(result.inaccessibleLegacyPath).toBeNull()
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('entry dataPath equals the current default → no setPath', () => {
    h.normalizedExe.mockReturnValue('/current/exe')
    applyFs({
      dirs: [DEFAULT_USER_DATA],
      contents: {
        [CONFIG_FILE]: JSON.stringify({
          appDataPath: [{ executablePath: '/current/exe', dataPath: DEFAULT_USER_DATA }]
        }),
        [`${DEFAULT_USER_DATA}/version.log`]: GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.userDataChanged).toBe(false)
    expect(result.legacyDataConfirmed).toBe(true)
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('B3: an entry dataPath is inaccessible (not on disk) → inaccessibleLegacyPath, no setPath', () => {
    h.normalizedExe.mockReturnValue('/new/exe')
    applyFs({
      // /custom/gone is neither a dir nor present → not usable.
      dirs: [],
      contents: {
        [CONFIG_FILE]: JSON.stringify({
          appDataPath: [{ executablePath: '/old/exe', dataPath: '/custom/gone' }]
        })
      }
    })

    const result = resolveMigrationPaths()

    expect(result.inaccessibleLegacyPath).toBe('/custom/gone')
    expect(result.userDataChanged).toBe(false)
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('isValidDir tightening: a custom entry pointing at a FILE (not a directory) → inaccessible', () => {
    h.normalizedExe.mockReturnValue('/new/exe')
    applyFs({
      dirs: [],
      // '/custom/file' exists but statSync reports a file → not a usable dir.
      sqlite: { '/custom/file': 10 }, // reuse the file-stat shape (isFile true)
      contents: {
        [CONFIG_FILE]: JSON.stringify({
          appDataPath: [{ executablePath: '/old/exe', dataPath: '/custom/file' }]
        })
      }
    })

    const result = resolveMigrationPaths()

    expect(result.inaccessibleLegacyPath).toBe('/custom/file')
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('A0: current default already holds a non-empty sqlite + stale eligible entry → no redirect', () => {
    h.normalizedExe.mockReturnValue('/new/exe')
    applyFs({
      dirs: [DEFAULT_USER_DATA, '/stale/custom'],
      sqlite: { [`${DEFAULT_USER_DATA}/cherrystudio.sqlite`]: 4096 },
      contents: {
        [CONFIG_FILE]: JSON.stringify({
          appDataPath: [{ executablePath: '/old/exe', dataPath: '/stale/custom' }]
        }),
        '/stale/custom/version.log': GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.userDataChanged).toBe(false)
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('A0 non-empty guard: a 0-byte sqlite does NOT count as V2-ized → still fuzzy-recovers custom', () => {
    h.normalizedExe.mockReturnValue('/new/exe')
    applyFs({
      dirs: [DEFAULT_USER_DATA, '/custom/real'],
      sqlite: { [`${DEFAULT_USER_DATA}/cherrystudio.sqlite`]: 0 }, // 0 bytes → invalid
      contents: {
        [CONFIG_FILE]: JSON.stringify({
          appDataPath: [{ executablePath: '/old/exe', dataPath: '/custom/real' }]
        }),
        '/custom/real/version.log': GOOD_VERSION_LOG
      }
    })

    const result = resolveMigrationPaths()

    expect(result.paths.userData).toBe('/custom/real')
    expect(result.userDataChanged).toBe(true)
    expect(h.setPath).toHaveBeenCalledWith('userData', '/custom/real')
  })

  it('P0 regression: boot-config already points at TARGET with version.log but empty electron-store → legacyDataConfirmed=true', () => {
    // Simulates "redirected on a previous launch, then exited before migrating".
    h.normalizedExe.mockReturnValue('/current/exe')
    h.bootGet.mockReturnValue({ '/current/exe': '/custom/target' })
    h.getPath.mockImplementation((key: string) => (key === 'userData' ? '/custom/target' : '/mock/unknown'))
    applyFs({
      dirs: ['/custom/target'],
      contents: { '/custom/target/version.log': GOOD_VERSION_LOG }
    })

    const result = resolveMigrationPaths()

    // boot-config entry is valid → probing skipped, but legacyDataConfirmed is
    // computed unconditionally from the FINAL userData.
    expect(result.userDataChanged).toBe(false)
    expect(result.legacyDataConfirmed).toBe(true)
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('front-gate P: boot-config points at a custom dir that is now inaccessible → inaccessibleLegacyPath, no lock on default', () => {
    h.normalizedExe.mockReturnValue('/current/exe')
    h.bootGet.mockReturnValue({ '/current/exe': '/unmounted/custom' })
    // resolveUserDataLocation already fell back to the default; userData is default.
    h.getPath.mockImplementation((key: string) => (key === 'userData' ? DEFAULT_USER_DATA : '/mock/unknown'))
    applyFs({
      // /unmounted/custom is not on disk; default is an empty dir.
      dirs: [DEFAULT_USER_DATA]
    })

    const result = resolveMigrationPaths()

    expect(result.inaccessibleLegacyPath).toBe('/unmounted/custom')
    expect(result.userDataChanged).toBe(false)
    expect(h.setPath).not.toHaveBeenCalled()
  })

  it('front-gate P: boot-config points at a valid custom dir → probing skipped, normal', () => {
    h.normalizedExe.mockReturnValue('/current/exe')
    h.bootGet.mockReturnValue({ '/current/exe': '/custom/valid' })
    h.getPath.mockImplementation((key: string) => (key === 'userData' ? '/custom/valid' : '/mock/unknown'))
    applyFs({
      dirs: ['/custom/valid'],
      contents: { '/custom/valid/version.log': GOOD_VERSION_LOG }
    })

    const result = resolveMigrationPaths()

    expect(result.inaccessibleLegacyPath).toBeNull()
    expect(result.userDataChanged).toBe(false)
    expect(result.legacyDataConfirmed).toBe(true)
    expect(h.setPath).not.toHaveBeenCalled()
  })
})
