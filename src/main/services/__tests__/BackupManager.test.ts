import type * as PathModule from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// -------------------------------------------------------------------------
// Hoisted mock factories shared across all describe blocks in this file.
// -------------------------------------------------------------------------
const { mockCheckpoint } = vi.hoisted(() => ({
  mockCheckpoint: vi.fn().mockResolvedValue(undefined)
}))

// Mock path module to normalize all paths to POSIX format for cross-platform consistency
// This ensures path operations work the same way regardless of the actual OS
vi.mock('path', async () => {
  const actual: typeof PathModule = await vi.importActual('path')
  return {
    ...actual,
    sep: '/', // Always use forward slash for consistency
    delimiter: ':',
    join: (...args: string[]) => {
      // Join with forward slashes, normalizing away backslashes
      return actual.join(...args).replace(/\\/g, '/')
    },
    normalize: (p: string) => {
      // Normalize path separators and remove redundant slashes
      return actual.normalize(p).replace(/\\/g, '/')
    },
    resolve: (...args: string[]) => {
      // For paths starting with / (Unix-style), use posix.resolve to avoid drive letter prefix
      if (args.some((arg) => typeof arg === 'string' && arg.startsWith('/'))) {
        return actual.posix.resolve(...args.map((a) => String(a).replace(/\\/g, '/')))
      }
      // For relative or Windows paths, use native resolve
      return actual.resolve(...args).replace(/\\/g, '/')
    },
    isAbsolute: (p: string) => actual.isAbsolute(p) || String(p).startsWith('/'),
    dirname: (p: string) => actual.dirname(p).replace(/\\/g, '/'),
    basename: actual.basename,
    extname: actual.extname,
    relative: (from: string, to: string) =>
      actual.relative(from.replace(/\\/g, '/'), to.replace(/\\/g, '/')).replace(/\\/g, '/'),
    // Keep native POSIX and win32 for direct use if needed
    posix: actual.posix,
    win32: actual.win32
  }
})

// Use vi.hoisted to define mocks that are available during hoisting
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'temp') return '/tmp'
      if (key === 'userData') return '/mock/userData'
      return '/mock/unknown'
    }),
    getVersion: vi.fn(() => '1.0.0')
  }
}))

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    remove: vi.fn(),
    ensureDir: vi.fn(),
    copy: vi.fn(),
    readdir: vi.fn(),
    lstat: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn(),
    renameSync: vi.fn(),
    createWriteStream: vi.fn(),
    createReadStream: vi.fn(),
    existsSync: vi.fn(),
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn()
    }
  },
  pathExists: vi.fn(),
  remove: vi.fn(),
  ensureDir: vi.fn(),
  copy: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
  realpath: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeJson: vi.fn().mockResolvedValue(undefined),
  readJson: vi.fn(),
  renameSync: vi.fn(),
  createWriteStream: vi.fn(),
  createReadStream: vi.fn(),
  existsSync: vi.fn(),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') {
        return { getMainWindow: vi.fn() }
      }
      if (name === 'WindowManager') {
        return { broadcastToType: vi.fn(), getWindowsByType: vi.fn(() => []), getAllWindows: vi.fn(() => []) }
      }
      if (name === 'DbService') {
        return { checkpoint: mockCheckpoint }
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
    // Mirrors tests/__mocks__/main/application.ts so that BackupManager methods
    // calling application.getPath('app.userdata.data') still work in this test
    // (this file overrides the global application mock from main.setup.ts).
    getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`)),
    relaunch: vi.fn()
  }
}))

vi.mock('../WebDav', () => ({
  default: vi.fn()
}))

vi.mock('../S3Storage', () => ({
  default: vi.fn()
}))

vi.mock('archiver', () => ({
  default: vi.fn()
}))

vi.mock('node-stream-zip', () => ({
  default: {
    async: vi.fn(() => ({
      extract: vi.fn().mockResolvedValue(undefined),
      close: vi.fn()
    }))
  }
}))

// Import after mocks
import archiver from 'archiver'
import * as fs from 'fs-extra'
import StreamZip from 'node-stream-zip'
import * as path from 'path'

import BackupManager from '../BackupManager'

// Helper to construct platform-independent paths for assertions
// The implementation uses path.normalize() which converts to platform separators
const normalizePath = (p: string): string => path.normalize(p)

const createDirent = (name: string) => ({ name })

const createStats = (type: 'directory' | 'file' | 'symlink', size = 0) => ({
  size,
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file',
  isSymbolicLink: () => type === 'symlink'
})

describe('BackupManager.copyDirWithProgress - Symlink Handling', () => {
  let backupManager: BackupManager

  beforeEach(() => {
    vi.clearAllMocks()
    backupManager = new BackupManager()
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
    vi.mocked(fs.copy).mockResolvedValue(undefined as never)
    vi.mocked(fs.realpath).mockImplementation(async (entryPath) => String(entryPath) as never)
  })

  it('should copy the real file when a valid symlink points to a file', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([createDirent('skill-link')] as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('symlink') as never)
    vi.mocked(fs.stat).mockResolvedValue(createStats('file', 42) as never)

    const onProgress = vi.fn()

    await (backupManager as any).copyDirWithProgress('/src', '/dest', onProgress, { dereferenceSymlinks: true })

    expect(fs.copy).toHaveBeenCalledWith('/src/skill-link', '/dest/skill-link', { dereference: true })
    expect(onProgress).toHaveBeenCalledWith(42)
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Dereferencing symlink during backup copy'),
      expect.objectContaining({
        path: '/src/skill-link',
        sourceRootRealPath: '/src',
        targetRealPath: '/src/skill-link'
      })
    )
  })

  it('should warn when dereferencing a symlink target outside the source root', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([createDirent('external-link')] as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('symlink') as never)
    vi.mocked(fs.stat).mockResolvedValue(createStats('file', 8) as never)
    vi.mocked(fs.realpath).mockImplementation(async (entryPath) => {
      const sourcePath = String(entryPath)
      return (sourcePath === '/src/external-link' ? '/external/file.txt' : sourcePath) as never
    })

    await (backupManager as any).copyDirWithProgress('/src', '/dest', vi.fn(), { dereferenceSymlinks: true })

    expect(fs.copy).toHaveBeenCalledWith('/src/external-link', '/dest/external-link', { dereference: true })
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Dereferencing symlink outside source root'),
      expect.objectContaining({
        path: '/src/external-link',
        sourceRootRealPath: '/src',
        targetRealPath: '/external/file.txt'
      })
    )
  })

  it('should copy the real directory contents when a valid symlink points to a directory', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const dirPath = String(dir)
      if (dirPath === '/src') {
        return [createDirent('skill-link')] as never
      }
      if (dirPath === '/src/skill-link') {
        return [createDirent('SKILL.md')] as never
      }
      return [] as never
    })
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      const sourcePath = String(entryPath)
      if (sourcePath === '/src/skill-link') {
        return createStats('symlink') as never
      }
      if (sourcePath === '/src/skill-link/SKILL.md') {
        return createStats('file', 12) as never
      }
      return createStats('directory') as never
    })
    vi.mocked(fs.stat).mockResolvedValue(createStats('directory') as never)

    const onProgress = vi.fn()

    await (backupManager as any).copyDirWithProgress('/src', '/dest', onProgress, { dereferenceSymlinks: true })

    expect(fs.ensureDir).toHaveBeenCalledWith('/dest/skill-link')
    expect(fs.copy).toHaveBeenCalledWith('/src/skill-link/SKILL.md', '/dest/skill-link/SKILL.md')
    expect(onProgress).toHaveBeenCalledWith(12)
  })

  it('should skip a broken symlink without failing backup copy', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([createDirent('missing-skill')] as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('symlink') as never)
    vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as never)

    await expect(
      (backupManager as any).copyDirWithProgress('/src', '/dest', vi.fn(), { dereferenceSymlinks: true })
    ).resolves.toBeUndefined()

    expect(fs.copy).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping broken or unreadable symlink'),
      expect.objectContaining({ path: '/src/missing-skill' })
    )
  })

  it('should preserve normal file and directory copy behavior', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const dirPath = String(dir)
      if (dirPath === '/src') {
        return [createDirent('file.txt'), createDirent('nested')] as never
      }
      if (dirPath === '/src/nested') {
        return [createDirent('child.txt')] as never
      }
      return [] as never
    })
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      const sourcePath = String(entryPath)
      if (sourcePath === '/src/nested') {
        return createStats('directory') as never
      }
      return createStats('file', 5) as never
    })

    const onProgress = vi.fn()

    await (backupManager as any).copyDirWithProgress('/src', '/dest', onProgress, { dereferenceSymlinks: true })

    expect(fs.copy).toHaveBeenCalledWith('/src/file.txt', '/dest/file.txt')
    expect(fs.ensureDir).toHaveBeenCalledWith('/dest/nested')
    expect(fs.copy).toHaveBeenCalledWith('/src/nested/child.txt', '/dest/nested/child.txt')
    expect(onProgress).toHaveBeenCalledWith(5)
  })

  it('should skip symlinks during restore copy', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([createDirent('restore-link')] as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('symlink') as never)

    await (backupManager as any).copyDirWithProgress('/restore-src', '/restore-dest', vi.fn(), {
      dereferenceSymlinks: false
    })

    expect(fs.stat).not.toHaveBeenCalled()
    expect(fs.copy).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping symlink (dereferenceSymlinks=false)'),
      expect.objectContaining({ path: '/restore-src/restore-link' })
    )
  })

  it('should throttle copy progress to integer progress changes and completion', () => {
    const onProgress = vi.fn()
    const handleProgress = (backupManager as any).createCopyProgressHandler(100, 0, 50, 'copying_files', onProgress)

    handleProgress(1)
    handleProgress(1)
    handleProgress(98)

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, { stage: 'copying_files', progress: 1, total: 100 })
    expect(onProgress).toHaveBeenNthCalledWith(2, { stage: 'copying_files', progress: 50, total: 100 })
  })

  it('should not recurse forever when a symlinked directory points to an ancestor during size calculation', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const dirPath = String(dir)
      if (dirPath === '/src') {
        return [createDirent('self-link')] as never
      }
      throw new Error(`Unexpected readdir: ${dirPath}`)
    })
    vi.mocked(fs.lstat).mockResolvedValue(createStats('symlink') as never)
    vi.mocked(fs.stat).mockResolvedValue(createStats('directory') as never)
    vi.mocked(fs.realpath).mockImplementation(async (entryPath) => {
      const sourcePath = String(entryPath)
      return (sourcePath === '/src/self-link' ? '/src' : sourcePath) as never
    })

    await expect((backupManager as any).getDirSize('/src', { dereferenceSymlinks: true })).resolves.toBe(0)

    expect(fs.readdir).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping circular symlink directory'),
      expect.objectContaining({ path: '/src/self-link', realPath: '/src' })
    )
  })

  it('should not recurse forever when copying a symlinked directory that points to an ancestor', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const dirPath = String(dir)
      if (dirPath === '/src') {
        return [createDirent('self-link')] as never
      }
      throw new Error(`Unexpected readdir: ${dirPath}`)
    })
    vi.mocked(fs.lstat).mockResolvedValue(createStats('symlink') as never)
    vi.mocked(fs.stat).mockResolvedValue(createStats('directory') as never)
    vi.mocked(fs.realpath).mockImplementation(async (entryPath) => {
      const sourcePath = String(entryPath)
      return (sourcePath === '/src/self-link' ? '/src' : sourcePath) as never
    })

    await expect(
      (backupManager as any).copyDirWithProgress('/src', '/dest', vi.fn(), { dereferenceSymlinks: true })
    ).resolves.toBeUndefined()

    expect(fs.readdir).toHaveBeenCalledTimes(1)
    expect(fs.ensureDir).toHaveBeenCalledWith('/dest')
    expect(fs.ensureDir).not.toHaveBeenCalledWith('/dest/self-link')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping circular symlink directory'),
      expect.objectContaining({ path: '/src/self-link', realPath: '/src' })
    )
  })
})

// -------------------------------------------------------------------------
// Helper: create a minimal mock archiver that resolves the backup promise
// -------------------------------------------------------------------------
function makeMockArchiver() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const archive: Record<string, unknown> = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
      return archive
    }),
    pipe: vi.fn(),
    directory: vi.fn(),
    finalize: vi.fn(() => {
      // Simulate successful archive completion — emit close on the writable stream
      setImmediate(() => handlers['close']?.forEach((h) => h()))
    }),
    emit: (event: string, ...args: unknown[]) => handlers[event]?.forEach((h) => h(...args))
  }
  return archive
}

function makeMockWriteStream() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
      // If close listener is added after finalize already fired, fire immediately
    }),
    _handlers: handlers,
    // Called by archive.pipe(output): make output.on('close', ...) resolvable
    __triggerClose: () => handlers['close']?.forEach((h) => h())
  }
}

describe('BackupManager — B1: SQLite included in backup product', () => {
  let backupManager: BackupManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckpoint.mockResolvedValue(undefined)
    backupManager = new BackupManager()
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
    vi.mocked(fs.remove).mockResolvedValue(undefined as never)
    vi.mocked(fs.pathExists).mockResolvedValue(false as never)
    vi.mocked(fs.writeJson).mockResolvedValue(undefined as never)
  })

  it('calls DbService.checkpoint() before archiving', async () => {
    const mockWriteStream = makeMockWriteStream()
    const mockArchive = makeMockArchiver()

    vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any)
    vi.mocked(archiver).mockReturnValue(mockArchive as any)

    // Trigger close on the writeStream after pipe is called
    vi.mocked(mockArchive.pipe as ReturnType<typeof vi.fn>).mockImplementation(() => {
      setImmediate(() => mockWriteStream.__triggerClose())
    })

    await backupManager.backup({} as Electron.IpcMainInvokeEvent, 'test.zip', '/tmp/dest')

    expect(mockCheckpoint).toHaveBeenCalled()
  })

  it('copies sqlite db file to sqlite/ subdirectory of staging dir', async () => {
    const mockWriteStream = makeMockWriteStream()
    const mockArchive = makeMockArchiver()

    vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any)
    vi.mocked(archiver).mockReturnValue(mockArchive as any)
    vi.mocked(mockArchive.pipe as ReturnType<typeof vi.fn>).mockImplementation(() => {
      setImmediate(() => mockWriteStream.__triggerClose())
    })

    // application.getPath('app.database.file') returns '/mock/app.database.file'
    // basename is 'app.database.file' — actual path from mock is '/mock/app.database.file'
    // The staging dir is this.tempDir = /tmp/cherry-studio/backup/temp

    await backupManager.backup({} as Electron.IpcMainInvokeEvent, 'test.zip', '/tmp/dest')

    // Expect copy to have been called for the sqlite file
    // Source: application.getPath('app.database.file') = '/mock/app.database.file'
    // Dest:   <tempDir>/sqlite/<basename> = '/tmp/cherry-studio/backup/temp/sqlite/app.database.file'
    expect(fs.copy).toHaveBeenCalledWith(
      '/mock/app.database.file',
      '/tmp/cherry-studio/backup/temp/sqlite/app.database.file'
    )
  })
})

// -------------------------------------------------------------------------
// Helper: make a StreamZip.async mock that simulates successful extraction
// -------------------------------------------------------------------------
function makeZipMock() {
  return {
    extract: vi.fn().mockResolvedValue(undefined),
    close: vi.fn()
  }
}

// Valid v2 backup metadata
const V2_METADATA = {
  version: 6,
  dataFormatVersion: 2,
  timestamp: 1700000000000,
  appName: 'Cherry Studio',
  appVersion: '1.0.0',
  platform: process.platform,
  arch: process.arch
}

// Valid v1 backup metadata (no dataFormatVersion, no sqlite/ dir)
const V1_METADATA = {
  version: 6,
  timestamp: 1600000000000,
  appName: 'Cherry Studio',
  appVersion: '0.9.0',
  platform: process.platform,
  arch: process.arch
}

describe('BackupManager — B5: dataFormatVersion marker', () => {
  let backupManager: BackupManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckpoint.mockResolvedValue(undefined)
    backupManager = new BackupManager()
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
    vi.mocked(fs.remove).mockResolvedValue(undefined as never)
    vi.mocked(fs.pathExists).mockResolvedValue(false as never)
    vi.mocked(fs.writeJson).mockResolvedValue(undefined as never)
  })

  it('backup() writes dataFormatVersion: 2 in metadata.json', async () => {
    const mockWriteStream = makeMockWriteStream()
    const mockArchive = makeMockArchiver()
    vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any)
    vi.mocked(archiver).mockReturnValue(mockArchive as any)
    vi.mocked(mockArchive.pipe as ReturnType<typeof vi.fn>).mockImplementation(() => {
      setImmediate(() => mockWriteStream.__triggerClose())
    })

    await backupManager.backup({} as Electron.IpcMainInvokeEvent, 'test.zip', '/tmp/dest')

    // metadata.json should include dataFormatVersion: 2
    expect(fs.writeJson).toHaveBeenCalledWith(
      expect.stringContaining('metadata.json'),
      expect.objectContaining({ dataFormatVersion: 2 }),
      expect.anything()
    )
  })

  it('restore() throws when dataFormatVersion > 2 (future format)', async () => {
    const zipMock = makeZipMock()
    vi.mocked(StreamZip.async).mockReturnValue(zipMock as any)

    const TEMP_DIR = '/tmp/cherry-studio/backup/temp'
    vi.mocked(fs.pathExists).mockImplementation(async (p) => {
      if (String(p) === `${TEMP_DIR}/metadata.json`) return true as never
      return false as never
    })
    vi.mocked(fs.readJson).mockResolvedValue({
      version: 6,
      dataFormatVersion: 3, // future, unsupported
      appName: 'Cherry Studio',
      appVersion: '1.0.0',
      platform: process.platform,
      arch: process.arch
    } as never)

    await expect(
      backupManager.restore({} as Electron.IpcMainInvokeEvent, '/path/to/future-backup.zip')
    ).rejects.toThrow()
  })
})

// -------------------------------------------------------------------------
// B4: Skip-once after restore (implicit via Task 4 marker comparison)
//
// The full end-to-end integration test (BackupManager.restore →
// FileManager.runStartupSweeps) would require Electron APIs (BrowserWindow,
// app.relaunch), zip extraction, and cross-service wiring that is not
// feasible in Vitest without significant Electron runtime mocking.
//
// Instead, we verify the building block: B2 correctly places the backup's
// `app_state` (containing `migration_v2_status.completedAt`) into the target
// SQLite path. The skip-once logic in FileManager reads that value on next
// startup and compares it against the BootConfig marker (preserved outside the
// backup product). This is exercised in detail by FileManager.migrationMarker.test.ts
// SKIP-4: "after v2 backup restore (marker=1800000000000, completedAt rewound to
// 1700000000000) — DB sweep skipped, marker updated".
// -------------------------------------------------------------------------

describe('BackupManager — B2/B3: SQLite atomic restore', () => {
  let backupManager: BackupManager
  // tempDir for BackupManager is /tmp/cherry-studio/backup/temp
  const TEMP_DIR = '/tmp/cherry-studio/backup/temp'

  beforeEach(() => {
    vi.clearAllMocks()
    backupManager = new BackupManager()
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
    vi.mocked(fs.remove).mockResolvedValue(undefined as never)
    vi.mocked(fs.copy).mockResolvedValue(undefined as never)
    // Default: no files/dirs exist
    vi.mocked(fs.pathExists).mockResolvedValue(false as never)
    vi.mocked(fs.readdir).mockResolvedValue([] as never)
  })

  it('B2: renames staged sqlite file to target db path on v2 restore', async () => {
    const zipMock = makeZipMock()
    vi.mocked(StreamZip.async).mockReturnValue(zipMock as any)

    // metadata.json exists (direct backup)
    vi.mocked(fs.pathExists).mockImplementation(async (p) => {
      const ps = String(p)
      if (ps === `${TEMP_DIR}/metadata.json`) return true as never
      if (ps === `${TEMP_DIR}/sqlite`) return true as never
      return false as never
    })
    vi.mocked(fs.readJson).mockResolvedValue(V2_METADATA as never)

    await backupManager.restore({} as Electron.IpcMainInvokeEvent, '/path/to/backup.zip')

    // application.getPath('app.database.file') returns '/mock/app.database.file'
    // staged file: TEMP_DIR/sqlite/app.database.file
    expect(fs.renameSync).toHaveBeenCalledWith(`${TEMP_DIR}/sqlite/app.database.file`, '/mock/app.database.file')
  })

  it('B3: skips sqlite rename on v1 restore (no sqlite/ dir)', async () => {
    const zipMock = makeZipMock()
    vi.mocked(StreamZip.async).mockReturnValue(zipMock as any)

    // metadata.json exists but no sqlite/ dir
    vi.mocked(fs.pathExists).mockImplementation(async (p) => {
      const ps = String(p)
      if (ps === `${TEMP_DIR}/metadata.json`) return true as never
      return false as never
    })
    vi.mocked(fs.readJson).mockResolvedValue(V1_METADATA as never)

    await backupManager.restore({} as Electron.IpcMainInvokeEvent, '/path/to/v1-backup.zip')

    // Should NOT have renamed any sqlite file
    expect(fs.renameSync).not.toHaveBeenCalled()
  })
})

describe('BackupManager.deleteLanTransferBackup - Security Tests', () => {
  let backupManager: BackupManager

  beforeEach(() => {
    vi.clearAllMocks()
    backupManager = new BackupManager()
  })

  describe('Normal Operations', () => {
    it('should delete valid file in allowed directory', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const validPath = '/tmp/cherry-studio/lan-transfer/backup.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, validPath)

      expect(result).toBe(true)
      expect(fs.remove).toHaveBeenCalledWith(normalizePath(validPath))
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted temp backup'))
    })

    it('should delete file in nested subdirectory', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const nestedPath = '/tmp/cherry-studio/lan-transfer/sub/dir/file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, nestedPath)

      expect(result).toBe(true)
      expect(fs.remove).toHaveBeenCalledWith(normalizePath(nestedPath))
    })

    it('should return false when file does not exist', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never)

      const missingPath = '/tmp/cherry-studio/lan-transfer/missing.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, missingPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })
  })

  describe('Path Traversal Attacks', () => {
    it('should block basic directory traversal attack (../../../../etc/passwd)', async () => {
      const attackPath = '/tmp/cherry-studio/lan-transfer/../../../../etc/passwd'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.pathExists).not.toHaveBeenCalled()
      expect(fs.remove).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('outside temp directory'))
    })

    it('should block absolute path escape (/etc/passwd)', async () => {
      const attackPath = '/etc/passwd'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should block traversal with multiple slashes', async () => {
      const attackPath = '/tmp/cherry-studio/lan-transfer/../../../etc/passwd'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })

    it('should block relative path traversal from current directory', async () => {
      const attackPath = '../../../etc/passwd'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })

    it('should block traversal to parent directory', async () => {
      const attackPath = '/tmp/cherry-studio/lan-transfer/../backup/secret.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })
  })

  describe('Prefix Attacks', () => {
    it('should block similar prefix attack (lan-transfer-evil)', async () => {
      const attackPath = '/tmp/cherry-studio/lan-transfer-evil/file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should block path without separator (lan-transferx)', async () => {
      const attackPath = '/tmp/cherry-studio/lan-transferx'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })

    it('should block different temp directory prefix', async () => {
      const attackPath = '/tmp-evil/cherry-studio/lan-transfer/file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, attackPath)

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should return false and log error on permission denied', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockRejectedValue(new Error('EACCES: permission denied') as never)

      const validPath = '/tmp/cherry-studio/lan-transfer/file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, validPath)

      expect(result).toBe(false)
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to delete'), expect.any(Error))
    })

    it('should return false on fs.pathExists error', async () => {
      vi.mocked(fs.pathExists).mockRejectedValue(new Error('ENOENT') as never)

      const validPath = '/tmp/cherry-studio/lan-transfer/file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, validPath)

      expect(result).toBe(false)
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should handle empty path string', async () => {
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, '')

      expect(result).toBe(false)
      expect(fs.remove).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should allow deletion of the temp directory itself', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const tempDir = '/tmp/cherry-studio/lan-transfer'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, tempDir)

      expect(result).toBe(true)
      expect(fs.remove).toHaveBeenCalledWith(normalizePath(tempDir))
    })

    it('should handle path with trailing slash', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const pathWithSlash = '/tmp/cherry-studio/lan-transfer/sub/'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, pathWithSlash)

      // path.normalize removes trailing slash
      expect(result).toBe(true)
    })

    it('should handle file with special characters in name', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const specialPath = '/tmp/cherry-studio/lan-transfer/file with spaces & (special).zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, specialPath)

      expect(result).toBe(true)
      expect(fs.remove).toHaveBeenCalled()
    })

    it('should handle path with double slashes', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const doubleSlashPath = '/tmp/cherry-studio//lan-transfer//file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, doubleSlashPath)

      // path.normalize handles double slashes
      expect(result).toBe(true)
    })
  })
})
