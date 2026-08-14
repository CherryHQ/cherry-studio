import type * as CryptoModule from 'node:crypto'
import { Readable, Writable } from 'node:stream'

import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import type * as PathModule from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock path module to normalize all paths to POSIX format for cross-platform consistency
// This ensures path operations work the same way regardless of the actual OS
async function posixPathModule() {
  const actual: typeof PathModule = await vi.importActual('path')
  const mocked = {
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
  // `default` for the modules that default-import it (legacyFile.ts), named for the rest.
  return { ...mocked, default: mocked }
}

// `node:path` is a distinct module id to vitest, and resolveAndValidatePath reaches
// path through it — mock both or Windows keeps its drive letters.
vi.mock('path', posixPathModule)
vi.mock('node:path', posixPathModule)

// Use vi.hoisted to define mocks that are available during hoisting
const {
  mockLogger,
  mockDbService,
  mockCacheService,
  mockChannelManager,
  mockChannelHold,
  mockJobManager,
  mockJobHold,
  mockAiStreamManager,
  mockAiStreamHold,
  mockAgentSessionRuntime,
  mockAgentSessionHold,
  mockWindowManager,
  mockRelaunch,
  mockHashDbFile,
  mockReadRestoreJournal,
  mockWriteRestoreJournal,
  mockCheckpointTruncateAssert,
  mockReadAppliedChain,
  mockCreateAtomicWriteStream,
  mockRandomUUID,
  mockZipExtract,
  mockZipClose,
  MockStreamZipAsync
} = vi.hoisted(() => {
  const mockChannelHold = { dispose: vi.fn() }
  const mockJobHold = { dispose: vi.fn() }
  const mockAiStreamHold = { dispose: vi.fn() }
  const mockAgentSessionHold = { dispose: vi.fn() }
  const mockZipExtract = vi.fn()
  const mockZipClose = vi.fn()
  return {
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    mockDbService: { createSnapshot: vi.fn(), checkpointTruncate: vi.fn() },
    mockCacheService: { flushPersistForBackup: vi.fn() },
    mockChannelManager: {
      pause: vi.fn(() => mockChannelHold),
      drainInFlight: vi.fn(async (): Promise<{ stragglerIds: string[] }> => ({ stragglerIds: [] }))
    },
    mockChannelHold,
    mockJobManager: {
      pause: vi.fn(() => mockJobHold),
      drainInFlight: vi.fn(async () => ({ stragglerIds: [], startupRecoveryPending: false }))
    },
    mockJobHold,
    mockAiStreamManager: {
      pause: vi.fn(() => mockAiStreamHold),
      drainInFlight: vi.fn(async (): Promise<{ stragglerIds: string[] }> => ({ stragglerIds: [] })),
      hasLiveStreams: vi.fn(() => false)
    },
    mockAiStreamHold,
    mockAgentSessionRuntime: {
      pause: vi.fn(() => mockAgentSessionHold),
      drainInFlight: vi.fn(async (): Promise<{ stragglerIds: string[] }> => ({ stragglerIds: [] })),
      hasBusySessions: vi.fn(() => false)
    },
    mockAgentSessionHold,
    mockWindowManager: { broadcastToType: vi.fn(), getWindowsByType: vi.fn(() => []) },
    mockRelaunch: vi.fn(),
    mockHashDbFile: vi.fn(),
    mockReadRestoreJournal: vi.fn(),
    mockWriteRestoreJournal: vi.fn(),
    mockCheckpointTruncateAssert: vi.fn(),
    mockReadAppliedChain: vi.fn(),
    mockCreateAtomicWriteStream: vi.fn(),
    mockRandomUUID: vi.fn(),
    mockZipExtract,
    mockZipClose,
    MockStreamZipAsync: vi.fn(function () {
      return { extract: mockZipExtract, close: mockZipClose }
    })
  }
})

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof CryptoModule>('node:crypto')
  return { ...actual, randomUUID: mockRandomUUID }
})

vi.mock('@main/data/db/restore/hashDbFile', () => ({
  hashDbFile: mockHashDbFile
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: mockReadRestoreJournal,
  writeRestoreJournal: mockWriteRestoreJournal
}))

vi.mock('@main/data/db/restore/checkpoint', () => ({
  checkpointTruncateAssert: mockCheckpointTruncateAssert
}))

vi.mock('@main/data/db/restore/appliedChain', () => ({
  readAppliedChain: mockReadAppliedChain
}))

vi.mock('@main/utils/file', () => ({
  createAtomicWriteStream: mockCreateAtomicWriteStream
}))

vi.mock('@main/utils/system', () => ({
  getDeviceType: () => 'mac',
  getHostname: () => 'test-host'
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    pragma: vi.fn(() => 'ok'),
    close: vi.fn()
  }))
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
    getVersion: vi.fn(() => '2.0.0')
  }
}))

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    ensureDir: vi.fn(),
    chmod: vi.fn(),
    emptyDir: vi.fn(),
    copy: vi.fn(),
    readdir: vi.fn(),
    lstat: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    createWriteStream: vi.fn(),
    createReadStream: vi.fn(),
    lstatSync: vi.fn(),
    readdirSync: vi.fn(),
    openSync: vi.fn(),
    fsyncSync: vi.fn(),
    closeSync: vi.fn(),
    existsSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      readFile: vi.fn()
    }
  },
  pathExists: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  ensureDir: vi.fn(),
  chmod: vi.fn(),
  emptyDir: vi.fn(),
  copy: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
  realpath: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readJson: vi.fn(),
  writeJson: vi.fn(),
  createWriteStream: vi.fn(),
  createReadStream: vi.fn(),
  lstatSync: vi.fn(),
  readdirSync: vi.fn(),
  openSync: vi.fn(),
  fsyncSync: vi.fn(),
  closeSync: vi.fn(),
  existsSync: vi.fn(),
  promises: {
    mkdir: vi.fn(),
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
        return mockWindowManager
      }
      if (name === 'DbService') {
        return mockDbService
      }
      if (name === 'CacheService') {
        return mockCacheService
      }
      if (name === 'ChannelManager') {
        return mockChannelManager
      }
      if (name === 'JobManager') {
        return mockJobManager
      }
      if (name === 'AiStreamManager') {
        return mockAiStreamManager
      }
      if (name === 'AgentSessionRuntimeService') {
        return mockAgentSessionRuntime
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
    getPath: vi.fn((key: string, filename?: string) => {
      const paths: Record<string, string> = {
        'app.userdata': '/mock/userData',
        'app.userdata.data': '/mock/userData/Data',
        'app.database.file': '/mock/userData/Data/cherrystudio.sqlite',
        'feature.backup.temp': '/mock/temp/backup',
        'feature.backup.restore.file': '/mock/userData/Data/restore-journal.json',
        'feature.backup.restore.staging': '/mock/userData/restore-staging',
        'feature.agents.claude.root': '/mock/userData/Data/Agents/.claude',
        'feature.lan_transfer.temp': '/tmp/cherry-studio/lan-transfer'
      }
      const base = paths[key] ?? '/mock/unknown'
      return filename ? `${base}/${filename}` : base
    }),
    relaunch: mockRelaunch
  }
}))

vi.mock('../WebDav', () => ({
  default: vi.fn()
}))

vi.mock('../S3Storage', () => ({
  default: vi.fn()
}))

vi.mock('archiver', () => ({
  ZipArchive: vi.fn()
}))

vi.mock('node-stream-zip', () => ({
  default: { async: MockStreamZipAsync }
}))

// Import after mocks
import { ZipArchive } from 'archiver'
import * as fs from 'fs-extra'
import * as path from 'path'

import BackupManager, { BackupOperationBusyError } from '../LegacyBackupManager'

// Helper to construct platform-independent paths for assertions
// The implementation uses path.normalize() which converts to platform separators
const normalizePath = (p: string): string => path.normalize(p)

const createDirent = (name: string, type: 'directory' | 'file' = 'file') => ({
  name,
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file'
})

const createStats = (type: 'directory' | 'file' | 'symlink', size = 0) => ({
  size,
  mode: 0o644,
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file',
  isSymbolicLink: () => type === 'symlink'
})

describe('BackupManager direct v2 data compatibility', () => {
  let backupManager: BackupManager
  const metadata = {
    version: 7,
    appName: 'Cherry Studio',
    appVersion: '2.0.0',
    timestamp: 1,
    platform: process.platform,
    arch: process.arch,
    resources: {
      database: true,
      cache: true,
      indexedDB: true,
      localStorage: true,
      appClaude: true,
      data: false
    }
  }
  const completeDataMetadata = {
    ...metadata,
    resources: {
      database: false,
      cache: true,
      indexedDB: true,
      localStorage: true,
      appClaude: false,
      data: true
    }
  }
  const slimDataMetadata = {
    ...completeDataMetadata,
    resources: {
      ...completeDataMetadata.resources,
      indexedDB: false,
      localStorage: false
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    backupManager = new BackupManager()
    mockRandomUUID.mockReturnValue('operation-id')
    mockHashDbFile.mockResolvedValue('same-fingerprint')
    mockReadRestoreJournal.mockReturnValue({ kind: 'none' })
    mockReadAppliedChain.mockReturnValue([{ folderMillis: 1, hash: 'migration-hash' }])
    mockZipExtract.mockResolvedValue(undefined)
    mockZipClose.mockResolvedValue(undefined)
    vi.mocked(fs.remove).mockResolvedValue(undefined as never)
    vi.mocked(fs.rename).mockResolvedValue(undefined as never)
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
    vi.mocked(fs.copy).mockResolvedValue(undefined as never)
    vi.mocked(fs.writeJson).mockResolvedValue(undefined as never)
    vi.mocked(fs.readdir).mockResolvedValue([] as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('file') as never)
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined as never)
    vi.mocked(fs.pathExists).mockResolvedValue(false as never)
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  const mockArchiveClose = (pipeError?: Error) => {
    let finishOutput: (() => void) | undefined
    const output = {
      destroyed: false,
      abort: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') finishOutput = callback
        return output
      })
    }
    const archive = {
      on: vi.fn().mockReturnThis(),
      pipe: vi.fn(() => {
        if (pipeError) throw pipeError
      }),
      directory: vi.fn(),
      finalize: vi.fn(() => finishOutput?.())
    }
    mockCreateAtomicWriteStream.mockReturnValue(output)
    vi.mocked(ZipArchive).mockReturnValue(archive as never)
    return { archive, output }
  }

  const mockDownloadedFileWrite = () => {
    vi.mocked(fs.createWriteStream).mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        }
      }) as never
    )
  }

  it('removes only stale managed backup temp artifacts', async () => {
    const now = Date.now()
    const staleExtract = 'extract-c3556dcc-5460-420e-b994-a68b89642bd3'
    const freshCreate = 'create-fa46adee-c7e2-4ac4-a73e-9424c4bf2754'
    const staleArchive = '594c6356-638b-45cc-a2ef-242ea29e39bf-cherry-studio.zip'
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)

    vi.mocked(fs.readdir).mockResolvedValue([
      createDirent(staleExtract, 'directory'),
      createDirent(freshCreate, 'directory'),
      createDirent(staleArchive),
      createDirent('extract-not-an-operation', 'directory'),
      createDirent('manual-backup.zip')
    ] as never)
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      const mtimeMs = String(entryPath).includes(freshCreate) ? now - 60 * 60 * 1000 : now - 25 * 60 * 60 * 1000
      return { ...createStats('file'), mtimeMs } as never
    })

    try {
      await backupManager.cleanupStaleTempArtifacts()
    } finally {
      nowSpy.mockRestore()
    }

    expect(fs.remove).toHaveBeenCalledTimes(2)
    expect(fs.remove).toHaveBeenCalledWith(`/mock/temp/backup/${staleExtract}`)
    expect(fs.remove).toHaveBeenCalledWith(`/mock/temp/backup/${staleArchive}`)
    expect(fs.lstat).toHaveBeenCalledTimes(3)
  })

  it('writes a version 7 archive with complete Data, IndexedDB, Local Storage, and cache.json', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => {
      return ['/mock/userData/cache.json', '/mock/userData/Data'].includes(String(entryPath))
    })
    const copyDirectories = vi.spyOn(backupManager as any, 'copyDirectoryOrCreate').mockResolvedValue(undefined)
    vi.spyOn(backupManager as any, 'getDirSize').mockResolvedValue(42)
    vi.spyOn(backupManager as any, 'copyDirWithProgress').mockResolvedValue(undefined)
    const { archive } = mockArchiveClose()

    const result = await backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')

    expect(result).toBe('/backups/backup.zip')
    expect(mockChannelManager.pause).toHaveBeenCalledOnce()
    expect(mockChannelManager.drainInFlight).toHaveBeenCalledWith({ timeoutMs: 30_000 })
    expect(mockChannelManager.drainInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      mockAiStreamManager.pause.mock.invocationCallOrder[0]
    )
    expect(mockAiStreamManager.pause).toHaveBeenCalledOnce()
    expect(mockAiStreamManager.drainInFlight).toHaveBeenCalledWith({ timeoutMs: 30_000 })
    expect(mockAgentSessionRuntime.pause).toHaveBeenCalledOnce()
    expect(mockAgentSessionRuntime.drainInFlight).toHaveBeenCalledWith({ timeoutMs: 30_000 })
    expect(mockJobManager.pause).toHaveBeenCalledOnce()
    expect(mockJobManager.drainInFlight).toHaveBeenCalledWith({ timeoutMs: 30_000 })
    expect(mockDbService.checkpointTruncate).toHaveBeenCalledTimes(2)
    expect(mockDbService.createSnapshot).not.toHaveBeenCalled()
    expect(mockCacheService.flushPersistForBackup).toHaveBeenCalledOnce()
    expect(fs.copy).toHaveBeenCalledWith(
      '/mock/userData/cache.json',
      '/mock/temp/backup/create-operation-id/cache.json'
    )
    expect(copyDirectories).toHaveBeenCalledTimes(2)
    expect(fs.writeJson).toHaveBeenCalledWith(
      '/mock/temp/backup/create-operation-id/metadata.json',
      expect.objectContaining({
        version: 7,
        appName: 'Cherry Studio',
        resources: {
          database: false,
          cache: true,
          indexedDB: true,
          localStorage: true,
          appClaude: false,
          data: true
        }
      }),
      { spaces: 2 }
    )
    expect(fs.copy).not.toHaveBeenCalledWith(
      '/mock/userData/Data/cherrystudio.sqlite',
      '/mock/temp/backup/create-operation-id/cherrystudio.sqlite'
    )
    expect(archive.directory).toHaveBeenCalledWith('/mock/temp/backup/create-operation-id', false)
    expect(mockChannelHold.dispose).toHaveBeenCalledOnce()
    expect(mockAiStreamHold.dispose).toHaveBeenCalledOnce()
    expect(mockAgentSessionHold.dispose).toHaveBeenCalledOnce()
    expect(mockJobHold.dispose).toHaveBeenCalledOnce()
  })

  it('rejects remote backup file names containing path separators', async () => {
    for (const fileName of ['../outside.zip', '..\\outside.zip']) {
      await expect(
        backupManager.backupToWebdav({} as Electron.IpcMainInvokeEvent, {
          webdavHost: 'https://example.com',
          fileName
        })
      ).rejects.toThrow('Backup file name must not contain path separators')
    }

    expect(fs.ensureDir).not.toHaveBeenCalled()
    expect(mockCreateAtomicWriteStream).not.toHaveBeenCalled()
  })

  it('keeps the existing local backup when archive creation fails', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => {
      return ['/mock/userData/cache.json', '/mock/userData/Data'].includes(String(entryPath))
    })
    vi.spyOn(backupManager as any, 'copyDirectoryOrCreate').mockResolvedValue(undefined)
    vi.spyOn(backupManager as any, 'getDirSize').mockResolvedValue(42)
    vi.spyOn(backupManager as any, 'copyDirWithProgress').mockResolvedValue(undefined)
    const archiveError = new Error('Archive failed')
    const { output } = mockArchiveClose(archiveError)

    await expect(backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')).rejects.toBe(
      archiveError
    )

    expect(output.abort).toHaveBeenCalledOnce()
    expect(fs.remove).not.toHaveBeenCalledWith('/backups/backup.zip')
  })

  it('copies Data while excluding transient SQLite sidecars and the restore journal', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => {
      return ['/mock/userData/cache.json', '/mock/userData/Data'].includes(String(entryPath))
    })
    vi.spyOn(backupManager as any, 'copyDirectoryOrCreate').mockResolvedValue(undefined)
    const getDirSize = vi.spyOn(backupManager as any, 'getDirSize').mockResolvedValue(42)
    const copyDirectory = vi.spyOn(backupManager as any, 'copyDirWithProgress').mockResolvedValue(undefined)
    mockArchiveClose()

    await backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')

    const dataCopyCall = copyDirectory.mock.calls.find(([source]) => source === '/mock/userData/Data')
    expect(dataCopyCall).toBeDefined()
    const options = dataCopyCall?.[3] as { excludeRelativePath: (relativePath: string) => boolean }
    expect(getDirSize).toHaveBeenCalledWith('/mock/userData/Data', dataCopyCall?.[3])
    expect(options.excludeRelativePath('cherrystudio.sqlite')).toBe(false)
    expect(options.excludeRelativePath('cherrystudio.sqlite-wal')).toBe(true)
    expect(options.excludeRelativePath('cherrystudio.sqlite-shm')).toBe(true)
    expect(options.excludeRelativePath('restore-journal.json')).toBe(true)
    expect(options.excludeRelativePath('restore-journal.json.tmp')).toBe(true)
    expect(options.excludeRelativePath('Agents/.claude/projects/session.jsonl')).toBe(false)
    expect(options.excludeRelativePath('Files/document.pdf')).toBe(false)
  })

  it('writes a slim archive with only Data/cherrystudio.sqlite and cache.json', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => {
      return ['/mock/userData/cache.json', '/mock/userData/Data'].includes(String(entryPath))
    })
    const copyDirectories = vi.spyOn(backupManager as any, 'copyDirectoryOrCreate').mockResolvedValue(undefined)
    const getDirSize = vi.spyOn(backupManager as any, 'getDirSize').mockResolvedValue(42)
    const copyDirectory = vi.spyOn(backupManager as any, 'copyDirWithProgress').mockResolvedValue(undefined)
    mockArchiveClose()

    await backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups', true)

    expect(copyDirectories).not.toHaveBeenCalled()
    const dataCopyCall = copyDirectory.mock.calls.find(([source]) => source === '/mock/userData/Data')
    expect(dataCopyCall).toBeDefined()
    const options = dataCopyCall?.[3] as { excludeRelativePath: (relativePath: string) => boolean }
    expect(getDirSize).toHaveBeenCalledWith('/mock/userData/Data', dataCopyCall?.[3])
    expect(options.excludeRelativePath('cherrystudio.sqlite')).toBe(false)
    expect(options.excludeRelativePath('cherrystudio.sqlite-wal')).toBe(true)
    expect(options.excludeRelativePath('cherrystudio.sqlite-shm')).toBe(true)
    expect(options.excludeRelativePath('restore-journal.json')).toBe(true)
    expect(options.excludeRelativePath('Agents')).toBe(true)
    expect(options.excludeRelativePath('Files/document.pdf')).toBe(true)
    expect(fs.writeJson).toHaveBeenCalledWith(
      '/mock/temp/backup/create-operation-id/metadata.json',
      expect.objectContaining({
        version: 7,
        resources: {
          database: false,
          cache: true,
          indexedDB: false,
          localStorage: false,
          appClaude: false,
          data: true
        }
      }),
      { spaces: 2 }
    )
  })

  it('fails instead of archiving a stale cache.json when the strict flush fails', async () => {
    vi.spyOn(backupManager as any, 'copyDirectoryOrCreate').mockResolvedValue(undefined)
    mockCacheService.flushPersistForBackup.mockImplementationOnce(() => {
      throw new Error('cache write failed')
    })

    await expect(backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')).rejects.toThrow(
      'cache write failed'
    )

    expect(mockCacheService.flushPersistForBackup).toHaveBeenCalledOnce()
    expect(fs.createWriteStream).not.toHaveBeenCalled()
    expect(mockJobHold.dispose).toHaveBeenCalledOnce()
  })

  it('fails closed when the live database changes while resources are copied', async () => {
    vi.spyOn(backupManager as any, 'copyDirectoryOrCreate').mockResolvedValue(undefined)
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => String(entryPath).endsWith('cache.json'))
    mockHashDbFile.mockResolvedValueOnce('before').mockResolvedValueOnce('before').mockResolvedValueOnce('after')

    await expect(backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')).rejects.toThrow(
      'Data changed while backup resources were being captured'
    )

    expect(fs.createWriteStream).not.toHaveBeenCalled()
    expect(mockJobHold.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    ['AI stream', mockAiStreamManager.hasLiveStreams],
    ['agent session', mockAgentSessionRuntime.hasBusySessions]
  ])('fails immediately when an %s can still write data', async (_, markBusy) => {
    markBusy.mockReturnValue(true)
    mockAiStreamManager.drainInFlight.mockResolvedValue({ stragglerIds: ['should-not-wait'] })

    try {
      await expect(backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')).rejects.toThrow(
        BACKUP_ACTIVE_WRITERS_ERROR_CODE
      )

      expect(mockChannelManager.pause).not.toHaveBeenCalled()
      expect(mockAiStreamManager.drainInFlight).not.toHaveBeenCalled()
      expect(mockAgentSessionRuntime.drainInFlight).not.toHaveBeenCalled()
      expect(fs.ensureDir).not.toHaveBeenCalled()
    } finally {
      markBusy.mockReturnValue(false)
      mockAiStreamManager.drainInFlight.mockResolvedValue({ stragglerIds: [] })
    }
  })

  it('fails closed when an AI writer does not drain before the snapshot', async () => {
    mockAiStreamManager.drainInFlight.mockResolvedValueOnce({ stragglerIds: ['topic-1'] })

    await expect(backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')).rejects.toThrow(
      'Background data writes did not quiesce in time'
    )

    expect(mockDbService.checkpointTruncate).not.toHaveBeenCalled()
    expect(mockChannelHold.dispose).toHaveBeenCalledOnce()
    expect(mockAiStreamHold.dispose).toHaveBeenCalledOnce()
    expect(mockAgentSessionHold.dispose).toHaveBeenCalledOnce()
    expect(mockJobHold.dispose).toHaveBeenCalledOnce()
  })

  it('does not pause AI writers until flushed channel messages finish admission', async () => {
    mockChannelManager.drainInFlight.mockResolvedValueOnce({ stragglerIds: ['channel-admission-1'] })

    await expect(backupManager.backup({} as Electron.IpcMainInvokeEvent, 'backup.zip', '/backups')).rejects.toThrow(
      'Background data writes did not quiesce in time'
    )

    expect(mockAiStreamManager.pause).not.toHaveBeenCalled()
    expect(mockAgentSessionRuntime.pause).not.toHaveBeenCalled()
    expect(mockJobManager.pause).not.toHaveBeenCalled()
    expect(mockChannelHold.dispose).toHaveBeenCalledOnce()
  })

  const arrangeDirectRestore = (restoreMetadata = metadata) => {
    vi.mocked(fs.readJson).mockResolvedValue(restoreMetadata as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('file') as never)
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => String(entryPath).startsWith('/mock/userData/'))
    vi.spyOn(backupManager as any, 'stageArchiveDirectory').mockResolvedValue(undefined)
    vi.spyOn(backupManager as any, 'copyClaudeState').mockResolvedValue(undefined)
    vi.spyOn(backupManager as any, 'validateStagedDatabase').mockReturnValue([
      { folderMillis: 1, hash: 'migration-hash' }
    ])
    vi.spyOn(backupManager as any, 'fsyncTree').mockImplementation(() => {})
  }

  it('opens staged files with write access before fsync on Windows', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.mocked(fs.lstatSync).mockReturnValue(createStats('file') as never)
    vi.mocked(fs.openSync).mockReturnValue(42)

    try {
      ;(backupManager as any).fsyncTree('/mock/userData/restore-staging/work.sqlite')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }

    expect(fs.openSync).toHaveBeenCalledWith('/mock/userData/restore-staging/work.sqlite', 'r+')
    expect(fs.fsyncSync).toHaveBeenCalledWith(42)
    expect(fs.closeSync).toHaveBeenCalledWith(42)
  })

  it('commits one crash-safe restore journal without relaunching inside staging', async () => {
    arrangeDirectRestore()

    await (backupManager as any).restoreDirect('/extract')

    expect(mockWriteRestoreJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        restoreId: 'operation-id',
        state: 'staged',
        db: {
          promote: 'restore-staging/operation-id/work.sqlite',
          aside: 'restore-staging/operation-id/aside/cherrystudio.sqlite',
          fingerprint: 'same-fingerprint',
          chain: [{ folderMillis: 1, hash: 'migration-hash' }]
        },
        fileResources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'overwrite',
            livePath: 'cache.json',
            stagingPath: 'restore-staging/operation-id/resources/cache.json'
          }),
          expect.objectContaining({ kind: 'overwrite', livePath: 'IndexedDB' }),
          expect.objectContaining({ kind: 'overwrite', livePath: 'Local Storage' }),
          expect.objectContaining({
            kind: 'overwrite',
            livePath: 'Data/Agents/.claude',
            asidePath: 'restore-staging/operation-id/aside/Data/Agents/.claude'
          })
        ])
      })
    )
    expect((backupManager as any).fsyncTree).toHaveBeenCalledWith('/mock/userData/restore-staging')
    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(mockJobHold.dispose).not.toHaveBeenCalled()
    expect(fs.remove).not.toHaveBeenCalledWith('/mock/userData/restore-staging/operation-id')
  })

  it('removes the extracted archive before relaunching', async () => {
    arrangeDirectRestore()
    vi.mocked(fs.pathExists).mockImplementation(async (entryPath) => {
      const target = String(entryPath)
      return target.endsWith('/metadata.json') || target.startsWith('/mock/userData/')
    })
    const events: string[] = []
    vi.mocked(fs.remove).mockImplementation(async (entryPath) => {
      events.push(`remove:${String(entryPath)}`)
    })
    mockRelaunch.mockImplementation(() => {
      events.push('relaunch')
    })

    await backupManager.restore({} as Electron.IpcMainInvokeEvent, '/backups/backup.zip')

    expect(events).toContain('remove:/mock/temp/backup/extract-operation-id')
    expect(events.indexOf('remove:/mock/temp/backup/extract-operation-id')).toBeLessThan(events.indexOf('relaunch'))
  })

  it('removes the WebDAV download directory before relaunching', async () => {
    mockDownloadedFileWrite()
    const createReadStream = vi.fn(() => Readable.from(Buffer.from('backup')))
    vi.spyOn(backupManager as any, 'getWebDavInstance').mockReturnValue({
      createReadStream
    })
    const restoreUnlocked = vi.spyOn(backupManager as any, 'restoreUnlocked').mockResolvedValue(undefined)
    const events: string[] = []
    vi.mocked(fs.remove).mockImplementation(async (entryPath) => {
      events.push(`remove:${String(entryPath)}`)
    })
    mockRelaunch.mockImplementation(() => {
      events.push('relaunch')
    })

    await backupManager.restoreFromWebdav({} as Electron.IpcMainInvokeEvent, {
      webdavHost: 'https://example.com',
      fileName: 'backup.zip'
    })

    expect(restoreUnlocked).toHaveBeenCalledWith('/mock/temp/backup/webdav-download-operation-id/backup.zip')
    expect(createReadStream).toHaveBeenCalledWith('backup.zip')
    expect(events).toEqual(['remove:/mock/temp/backup/webdav-download-operation-id', 'relaunch'])
  })

  it('removes the S3 download directory before relaunching', async () => {
    mockDownloadedFileWrite()
    const getFileStream = vi.fn().mockResolvedValue(Readable.from(Buffer.from('backup')))
    vi.spyOn(backupManager as any, 'getS3Storage').mockReturnValue({
      getFileStream
    })
    const restoreUnlocked = vi.spyOn(backupManager as any, 'restoreUnlocked').mockResolvedValue(undefined)
    const events: string[] = []
    vi.mocked(fs.remove).mockImplementation(async (entryPath) => {
      events.push(`remove:${String(entryPath)}`)
    })
    mockRelaunch.mockImplementation(() => {
      events.push('relaunch')
    })

    await backupManager.restoreFromS3({} as Electron.IpcMainInvokeEvent, {
      endpoint: 'https://s3.example.com',
      region: 'test',
      bucket: 'backups',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      fileName: 'backup.zip',
      autoSync: false,
      syncInterval: 0,
      maxBackups: 1
    })

    expect(restoreUnlocked).toHaveBeenCalledWith('/mock/temp/backup/s3-download-operation-id/backup.zip')
    expect(getFileStream).toHaveBeenCalledWith('backup.zip')
    expect(events).toEqual(['remove:/mock/temp/backup/s3-download-operation-id', 'relaunch'])
  })

  it('streams S3 backups with a known content length', async () => {
    const backupPath = '/mock/temp/backup/backup.zip'
    const uploadStream = Readable.from(Buffer.from('backup'))
    const putFileContents = vi.fn().mockResolvedValue({})
    vi.spyOn(backupManager as any, 'backupDirect').mockResolvedValue(backupPath)
    vi.spyOn(backupManager as any, 'getS3Storage').mockReturnValue({ putFileContents })
    vi.mocked(fs.stat).mockResolvedValue(createStats('file', 6) as never)
    vi.mocked(fs.createReadStream).mockReturnValue(uploadStream as never)

    await backupManager.backupToS3({} as Electron.IpcMainInvokeEvent, {
      endpoint: 'https://s3.example.com',
      region: 'test',
      bucket: 'backups',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      fileName: 'backup.zip',
      autoSync: false,
      syncInterval: 0,
      maxBackups: 1
    })

    expect(putFileContents).toHaveBeenCalledWith('backup.zip', uploadStream, 6, { signal: undefined })
    expect(fs.promises.readFile).not.toHaveBeenCalled()
  })

  it('preserves S3 object paths relative to the configured root', async () => {
    vi.spyOn(backupManager as any, 'getS3Storage').mockReturnValue({
      listFiles: vi.fn().mockResolvedValue([
        { key: 'backup.zip', lastModified: '2026-08-04T02:00:00.000Z', size: 1 },
        { key: 'nested/backup.zip', lastModified: '2026-08-04T01:00:00.000Z', size: 2 }
      ])
    })

    await expect(
      backupManager.listS3Files({} as Electron.IpcMainInvokeEvent, {
        endpoint: 'https://s3.example.com',
        region: 'test',
        bucket: 'backups',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        root: 'root',
        autoSync: false,
        syncInterval: 0,
        maxBackups: 1
      })
    ).resolves.toEqual([
      { fileName: 'backup.zip', modifiedTime: '2026-08-04T02:00:00.000Z', size: 1 },
      { fileName: 'nested/backup.zip', modifiedTime: '2026-08-04T01:00:00.000Z', size: 2 }
    ])
  })

  it('keeps an automatic backup out until manual retention cleanup finishes', async () => {
    const backupPath = '/mock/temp/backup/backup.zip'
    let finishCleanup: (files: unknown[]) => void = () => {}
    const getDirectoryContents = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          finishCleanup = resolve
        })
    )
    const putWebdavFile = vi.fn().mockResolvedValue(true)
    const putS3File = vi.fn().mockResolvedValue({})
    vi.spyOn(backupManager as any, 'backupDirect').mockResolvedValue(backupPath)
    vi.spyOn(backupManager as any, 'getWebDavInstance').mockReturnValue({
      putFileContents: putWebdavFile,
      getDirectoryContents
    })
    vi.spyOn(backupManager as any, 'getS3Storage').mockReturnValue({ putFileContents: putS3File })
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('backup') as never)

    const manualBackup = backupManager.backupToWebdav({} as Electron.IpcMainInvokeEvent, {
      webdavHost: 'https://example.com',
      fileName: 'backup.zip',
      maxBackups: 1,
      disableStream: true
    })
    await vi.waitFor(() => expect(getDirectoryContents).toHaveBeenCalledOnce())

    await expect(
      backupManager.backupToS3(null, {
        endpoint: 'https://s3.example.com',
        region: 'test',
        bucket: 'backups',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        fileName: 'backup.zip',
        autoSync: true,
        syncInterval: 1,
        maxBackups: 1
      })
    ).rejects.toBeInstanceOf(BackupOperationBusyError)
    expect(putS3File).not.toHaveBeenCalled()

    finishCleanup([])
    await manualBackup
  })

  it('rejects an automatic backup while restore is in progress', async () => {
    let finishRestore = () => {}
    const restoreUnlocked = vi.spyOn(backupManager as any, 'restoreUnlocked').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRestore = resolve
        })
    )
    const backupDirect = vi.spyOn(backupManager as any, 'backupDirect')
    const restore = backupManager.restore({} as Electron.IpcMainInvokeEvent, '/restore.zip')
    await vi.waitFor(() => expect(restoreUnlocked).toHaveBeenCalledWith('/restore.zip'))

    try {
      await expect(
        backupManager.backupToLocalDir(
          null,
          'auto.zip',
          { localBackupDir: '/backups', maxBackups: 0 },
          new AbortController().signal
        )
      ).rejects.toBeInstanceOf(BackupOperationBusyError)
      expect(backupDirect).not.toHaveBeenCalled()
    } finally {
      finishRestore()
      await restore
    }
  })

  it('limits and cancels WebDAV retention cleanup for the exact current device', async () => {
    const backupPath = '/mock/temp/backup/backup.zip'
    const controller = new AbortController()
    let deleteSignal: AbortSignal | undefined
    const deleteFile = vi.fn(
      (_fileName: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          deleteSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const getDirectoryContents = vi.fn().mockResolvedValue([
      {
        type: 'file',
        basename: 'cherry-studio.20260804020000.test-host.mac.zip',
        lastmod: '2026-08-04T02:00:00.000Z',
        size: 1
      },
      {
        type: 'file',
        basename: 'cherry-studio.20260804015000.other-test-host.mac.zip',
        lastmod: '2026-08-04T01:50:00.000Z',
        size: 1
      },
      {
        type: 'file',
        basename: 'cherry-studio.20260804000000.test-host.mac.zip',
        lastmod: '2026-08-04T00:00:00.000Z',
        size: 1
      }
    ])
    vi.spyOn(backupManager as any, 'backupDirect').mockResolvedValue(backupPath)
    vi.spyOn(backupManager as any, 'getWebDavInstance').mockReturnValue({
      putFileContents: vi.fn().mockResolvedValue(true),
      getDirectoryContents,
      deleteFile
    })
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('backup') as never)

    const backup = backupManager.backupToWebdav(
      null,
      { webdavHost: 'https://example.com', disableStream: true, maxBackups: 1 },
      controller.signal
    )
    await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledOnce())
    controller.abort(new DOMException('Stopped.', 'AbortError'))

    await expect(backup).resolves.toMatchObject({ result: true, cleanupError: { name: 'AbortError' } })
    expect(deleteFile).toHaveBeenCalledWith('cherry-studio.20260804000000.test-host.mac.zip', deleteSignal)
    expect(deleteSignal?.aborted).toBe(true)
    expect(getDirectoryContents).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('aborts a stalled WebDAV upload after the idle timeout', async () => {
    vi.useFakeTimers()
    try {
      const backupPath = '/mock/temp/backup/backup.zip'
      let uploadStarted: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        uploadStarted = resolve
      })
      const putFileContents = vi.fn(
        (_fileName: string, _data: Buffer, options: { signal: AbortSignal }) =>
          new Promise<boolean>((_resolve, reject) => {
            uploadStarted()
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
          })
      )
      vi.spyOn(backupManager as any, 'backupDirect').mockResolvedValue(backupPath)
      vi.spyOn(backupManager as any, 'getWebDavInstance').mockReturnValue({ putFileContents })
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('backup') as never)

      const backup = backupManager.backupToWebdav(null, {
        webdavHost: 'https://example.com',
        fileName: 'backup.zip',
        disableStream: true
      })
      await started
      const rejection = expect(backup).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(5 * 60_000)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores complete-Data version 7 archives without reading standalone SQLite or .claude resources', async () => {
    arrangeDirectRestore(completeDataMetadata)
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      return createStats(String(entryPath) === '/extract/Data' ? 'directory' : 'file') as never
    })
    const createDataResources = vi.spyOn(backupManager as any, 'createDataJournalResources').mockResolvedValue([])

    await (backupManager as any).restoreDirect('/extract')

    expect(fs.copy).toHaveBeenCalledWith(
      '/mock/userData/restore-staging/operation-id/resources/Data/cherrystudio.sqlite',
      '/mock/userData/restore-staging/operation-id/work.sqlite'
    )
    expect(fs.copy).not.toHaveBeenCalledWith(
      '/extract/cherrystudio.sqlite',
      '/mock/userData/restore-staging/operation-id/work.sqlite'
    )
    expect((backupManager as any).copyClaudeState).not.toHaveBeenCalled()
    expect(createDataResources).toHaveBeenCalledWith(
      '/mock/userData/restore-staging/operation-id',
      '/mock/userData/restore-staging/operation-id/resources/Data'
    )

    const dataStageCall = vi
      .mocked((backupManager as any).stageArchiveDirectory)
      .mock.calls.find(([source]: [string]) => source === '/extract/Data')
    expect(dataStageCall?.[3]).toEqual({
      dereferenceSymlinks: false,
      sourceRootPath: '/extract/Data'
    })
    expect(dataStageCall?.[3]?.excludeRelativePath).toBeUndefined()
  })

  it('restores a slim archive without replacing IndexedDB, Local Storage, or non-database Data', async () => {
    arrangeDirectRestore(slimDataMetadata)
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      return createStats(String(entryPath) === '/extract/Data' ? 'directory' : 'file') as never
    })
    const createDataResources = vi.spyOn(backupManager as any, 'createDataJournalResources').mockResolvedValue([])

    await (backupManager as any).restoreDirect('/extract')

    expect((backupManager as any).stageArchiveDirectory).not.toHaveBeenCalledWith(
      '/extract/IndexedDB',
      expect.anything()
    )
    expect((backupManager as any).stageArchiveDirectory).not.toHaveBeenCalledWith(
      '/extract/Local Storage',
      expect.anything()
    )
    expect(createDataResources).not.toHaveBeenCalled()
    expect(mockWriteRestoreJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        fileResources: [
          expect.objectContaining({
            kind: 'overwrite',
            livePath: 'cache.json',
            stagingPath: 'restore-staging/operation-id/resources/cache.json'
          })
        ]
      })
    )
  })

  it('journals Data children without overlapping SQLite, the restore journal, or .claude', async () => {
    arrangeDirectRestore({
      ...metadata,
      resources: { ...metadata.resources, data: true }
    })
    vi.mocked(fs.readdir).mockImplementation(async (entryPath) => {
      const directory = String(entryPath)
      if (directory === '/mock/userData/restore-staging/operation-id/resources/Data') {
        return ['Files', 'Agents'] as never
      }
      if (directory === '/mock/userData/Data') {
        return ['Files', 'Agents', 'KnowledgeBase', 'cherrystudio.sqlite', 'restore-journal.json'] as never
      }
      return [] as never
    })
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      const entry = String(entryPath)
      if (
        entry === '/extract/Data' ||
        entry.startsWith('/mock/userData/restore-staging/operation-id/resources/Data/') ||
        ['/mock/userData/Data/Files', '/mock/userData/Data/Agents', '/mock/userData/Data/KnowledgeBase'].includes(entry)
      ) {
        return createStats('directory') as never
      }
      return createStats('file') as never
    })
    vi.spyOn(backupManager as any, 'getDirSize').mockResolvedValue(0)

    await (backupManager as any).restoreDirect('/extract')

    const journal = mockWriteRestoreJournal.mock.calls[0][0]
    const dataResourcePaths = journal.fileResources
      .map((resource: { livePath: string }) => resource.livePath)
      .filter((livePath: string) => livePath.startsWith('Data/'))
    expect(dataResourcePaths).toEqual(['Data/Agents', 'Data/Files', 'Data/KnowledgeBase'])
    expect(dataResourcePaths).not.toContain('Data/cherrystudio.sqlite')
    expect(dataResourcePaths).not.toContain('Data/restore-journal.json')
    expect(dataResourcePaths).not.toContain('Data/Agents/.claude')
    expect((backupManager as any).copyClaudeState).toHaveBeenCalledWith(
      '/extract/.claude',
      '/mock/userData/restore-staging/operation-id/resources/Data/Agents/.claude'
    )
    expect(fs.ensureDir).toHaveBeenCalledWith(
      '/mock/userData/restore-staging/operation-id/resources/Data/KnowledgeBase'
    )
  })

  it('rejects a version 7 archive that is missing cache.json without committing a journal', async () => {
    vi.mocked(fs.readJson).mockResolvedValue(metadata as never)
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      if (String(entryPath).endsWith('cache.json')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return createStats('file') as never
    })

    await expect((backupManager as any).restoreDirect('/extract')).rejects.toThrow('Backup is missing its cache.json')

    expect(mockWriteRestoreJournal).not.toHaveBeenCalled()
    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(fs.remove).toHaveBeenCalledWith('/mock/userData/restore-staging/operation-id')
  })

  it('rejects a v1 version 6 archive before staging any resources', async () => {
    vi.mocked(fs.readJson).mockResolvedValue({ version: 6, appName: 'Cherry Studio' } as never)

    await expect((backupManager as any).restoreDirect('/extract')).rejects.toThrow(
      'Unsupported backup version 6. Cherry Studio v2 can only restore backup version 7.'
    )

    expect(fs.copy).not.toHaveBeenCalled()
    expect(mockWriteRestoreJournal).not.toHaveBeenCalled()
    expect(mockRelaunch).not.toHaveBeenCalled()
  })

  it('rejects version 7 metadata with mixed resource layouts', async () => {
    vi.mocked(fs.readJson).mockResolvedValue({
      ...completeDataMetadata,
      resources: {
        ...completeDataMetadata.resources,
        database: false,
        appClaude: true
      }
    } as never)

    await expect((backupManager as any).restoreDirect('/extract')).rejects.toThrow(
      'Backup version 7 metadata is incomplete'
    )

    expect(fs.copy).not.toHaveBeenCalled()
    expect(mockWriteRestoreJournal).not.toHaveBeenCalled()
  })

  it('rejects metadata-less v1 ZIP backups', async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as never)

    await expect(backupManager.restore({} as Electron.IpcMainInvokeEvent, '/backup/v1.zip')).rejects.toThrow(
      'Unsupported v1 backup'
    )

    expect(mockZipExtract).toHaveBeenCalledOnce()
    expect(mockZipClose).toHaveBeenCalledOnce()
    expect(mockWriteRestoreJournal).not.toHaveBeenCalled()
  })

  it('does not clobber a pending restore journal', async () => {
    mockReadRestoreJournal.mockReturnValue({
      kind: 'ok',
      journal: { state: 'staged' }
    })

    await expect((backupManager as any).restoreDirect('/extract')).rejects.toThrow('Another restore is already pending')

    expect(fs.remove).not.toHaveBeenCalledWith('/mock/userData/restore-staging')
    expect(mockWriteRestoreJournal).not.toHaveBeenCalled()
  })

  it('cleans incomplete staging and releases the write hold when journal commit fails', async () => {
    arrangeDirectRestore()
    mockWriteRestoreJournal.mockImplementationOnce(() => {
      throw new Error('journal fsync failed')
    })

    await expect((backupManager as any).restoreDirect('/extract')).rejects.toThrow('journal fsync failed')

    expect(fs.remove).toHaveBeenCalledWith('/mock/userData/restore-staging/operation-id')
    expect(mockJobHold.dispose).toHaveBeenCalledOnce()
    expect(mockRelaunch).not.toHaveBeenCalled()
  })

  it('rejects overlapping backup operations', async () => {
    let releaseFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const direct = vi.spyOn(backupManager as any, 'backupDirect').mockImplementation(async () => {
      await firstDone
      return '/backups/first.zip'
    })

    const first = backupManager.backup({} as Electron.IpcMainInvokeEvent, 'first.zip', '/backups')
    await Promise.resolve()
    const second = backupManager.backup({} as Electron.IpcMainInvokeEvent, 'second.zip', '/backups')

    await expect(second).rejects.toBeInstanceOf(BackupOperationBusyError)
    expect(direct).toHaveBeenCalledTimes(1)
    releaseFirst()
    await expect(first).resolves.toBe('/backups/first.zip')
  })

  it('restores legacy standalone .claude state but excludes the generated skills mirror', async () => {
    vi.mocked(fs.lstat).mockImplementation(async (entryPath) => {
      return createStats(String(entryPath).endsWith('settings.json') ? 'file' : 'directory') as never
    })
    vi.mocked(fs.readdir).mockResolvedValue([
      createDirent('skills'),
      createDirent('projects'),
      createDirent('settings.json')
    ] as never)
    const copyDirectory = vi.spyOn(backupManager as any, 'copyDirWithProgress').mockResolvedValue(undefined)

    await (backupManager as any).copyClaudeState('/mock/userData/Data/Agents/.claude', '/archive/.claude')

    expect(copyDirectory).toHaveBeenCalledWith(
      '/mock/userData/Data/Agents/.claude/projects',
      '/archive/.claude/projects',
      expect.any(Function),
      { dereferenceSymlinks: false }
    )
    expect(fs.copy).toHaveBeenCalledWith(
      '/mock/userData/Data/Agents/.claude/settings.json',
      '/archive/.claude/settings.json'
    )
    expect(copyDirectory).not.toHaveBeenCalledWith(
      expect.stringContaining('/skills'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})

describe('BackupManager.copyDirWithProgress', () => {
  let backupManager: BackupManager

  beforeEach(() => {
    vi.clearAllMocks()
    backupManager = new BackupManager()
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
    vi.mocked(fs.chmod).mockResolvedValue(undefined as never)
    vi.mocked(fs.copy).mockResolvedValue(undefined as never)
    vi.mocked(fs.remove).mockResolvedValue(undefined as never)
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

  it('should abort an in-progress file copy', async () => {
    const controller = new AbortController()
    const onProgress = vi.fn()
    vi.mocked(fs.readdir).mockResolvedValue([createDirent('large.bin')] as never)
    vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 1024) as never)
    vi.mocked(fs.createReadStream).mockReturnValue(new Readable({ read() {} }) as never)
    vi.mocked(fs.createWriteStream).mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        }
      }) as never
    )

    const result = (backupManager as any)
      .copyDirWithProgress('/src', '/dest', onProgress, {
        dereferenceSymlinks: true,
        signal: controller.signal
      })
      .catch((error: unknown) => error)

    await vi.waitFor(() => expect(fs.createReadStream).toHaveBeenCalledWith('/src/large.bin'))
    controller.abort()

    await expect(result).resolves.toMatchObject({ name: 'AbortError' })
    expect(fs.remove).toHaveBeenCalledWith('/dest/large.bin')
    expect(fs.chmod).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
  })

  describe('LevelDB Lock Handling', () => {
    const createBusyFileError = () =>
      Object.assign(new Error('resource busy or locked, read'), {
        code: 'EBUSY',
        errno: -4082
      })

    const mockAutomaticCopyError = (error: Error) => {
      vi.mocked(fs.createReadStream).mockReturnValue(
        new Readable({
          read() {
            this.destroy(error)
          }
        }) as never
      )
      vi.mocked(fs.createWriteStream).mockReturnValue(
        new Writable({
          write(_chunk, _encoding, callback) {
            callback()
          }
        }) as never
      )
    }

    it.each(['leveldb', 'indexeddb.leveldb'])(
      'should skip a locked file in %s during an automatic backup copy',
      async (parentDirectory) => {
        const lockedFileError = createBusyFileError()
        const sourceDirectory = `/src/${parentDirectory}`
        const destinationDirectory = `/dest/${parentDirectory}`
        const onProgress = vi.fn()
        vi.mocked(fs.readdir).mockResolvedValue([createDirent('LOCK')] as never)
        vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 0) as never)
        mockAutomaticCopyError(lockedFileError)

        await expect(
          (backupManager as any).copyDirWithProgress(sourceDirectory, destinationDirectory, onProgress, {
            dereferenceSymlinks: false,
            signal: new AbortController().signal
          })
        ).resolves.toBeUndefined()

        expect(fs.remove).toHaveBeenCalledWith(`${destinationDirectory}/LOCK`)
        expect(onProgress).not.toHaveBeenCalled()
        expect(mockLogger.warn).toHaveBeenCalledWith('[BackupManager] Skipping locked file', {
          path: `${sourceDirectory}/LOCK`
        })
      }
    )

    it('should reject a locked file error when removing the partial automatic backup copy fails', async () => {
      const lockedFileError = createBusyFileError()
      vi.mocked(fs.readdir).mockResolvedValue([createDirent('LOCK')] as never)
      vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 0) as never)
      vi.mocked(fs.remove).mockRejectedValueOnce(new Error('cleanup failed') as never)
      mockAutomaticCopyError(lockedFileError)

      await expect(
        (backupManager as any).copyDirWithProgress('/src/leveldb', '/dest/leveldb', vi.fn(), {
          dereferenceSymlinks: false,
          signal: new AbortController().signal
        })
      ).rejects.toBe(lockedFileError)

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        '[BackupManager] Skipping locked file',
        expect.objectContaining({ path: '/src/leveldb/LOCK' })
      )
    })

    it.each(['.claude', 'notleveldb'])(
      'should reject EBUSY for a LOCK file in non-LevelDB directory %s during an automatic backup copy',
      async (parentDirectory) => {
        const busyFileError = createBusyFileError()
        const sourceDirectory = `/src/${parentDirectory}`
        const destinationDirectory = `/dest/${parentDirectory}`
        vi.mocked(fs.readdir).mockResolvedValue([createDirent('LOCK')] as never)
        vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 0) as never)
        mockAutomaticCopyError(busyFileError)

        await expect(
          (backupManager as any).copyDirWithProgress(sourceDirectory, destinationDirectory, vi.fn(), {
            dereferenceSymlinks: false,
            signal: new AbortController().signal
          })
        ).rejects.toBe(busyFileError)

        expect(fs.remove).toHaveBeenCalledWith(`${destinationDirectory}/LOCK`)
      }
    )

    it('should skip a LevelDB LOCK file during a backup copy without a signal', async () => {
      const lockedFileError = createBusyFileError()
      const onProgress = vi.fn()
      vi.mocked(fs.readdir).mockResolvedValue([createDirent('LOCK')] as never)
      vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 0) as never)
      vi.mocked(fs.copy).mockRejectedValueOnce(lockedFileError as never)

      await expect(
        (backupManager as any).copyDirWithProgress('/src/leveldb', '/dest/leveldb', onProgress, {
          dereferenceSymlinks: false
        })
      ).resolves.toBeUndefined()

      expect(onProgress).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith('[BackupManager] Skipping locked file', {
        path: '/src/leveldb/LOCK'
      })
    })

    it('should reject EBUSY for a non-LevelDB LOCK file during a backup copy without a signal', async () => {
      const busyFileError = createBusyFileError()
      vi.mocked(fs.readdir).mockResolvedValue([createDirent('LOCK')] as never)
      vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 0) as never)
      vi.mocked(fs.copy).mockRejectedValueOnce(busyFileError as never)

      await expect(
        (backupManager as any).copyDirWithProgress('/src/.claude', '/dest/.claude', vi.fn(), {
          dereferenceSymlinks: false
        })
      ).rejects.toBe(busyFileError)
    })

    it('should reject EBUSY for a case-variant LevelDB lock filename', async () => {
      const busyFileError = createBusyFileError()
      vi.mocked(fs.readdir).mockResolvedValue([createDirent('lock')] as never)
      vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 0) as never)
      mockAutomaticCopyError(busyFileError)

      await expect(
        (backupManager as any).copyDirWithProgress('/src/leveldb', '/dest/leveldb', vi.fn(), {
          dereferenceSymlinks: false,
          signal: new AbortController().signal
        })
      ).rejects.toBe(busyFileError)

      expect(fs.remove).toHaveBeenCalledWith('/dest/leveldb/lock')
    })

    it('should reject EBUSY for a non-lock file during an automatic backup copy', async () => {
      const busyFileError = createBusyFileError()
      vi.mocked(fs.readdir).mockResolvedValue([createDirent('messages.json')] as never)
      vi.mocked(fs.lstat).mockResolvedValue(createStats('file', 42) as never)
      mockAutomaticCopyError(busyFileError)

      await expect(
        (backupManager as any).copyDirWithProgress('/src', '/dest', vi.fn(), {
          dereferenceSymlinks: false,
          signal: new AbortController().signal
        })
      ).rejects.toBe(busyFileError)

      expect(fs.remove).toHaveBeenCalledWith('/dest/messages.json')
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        '[BackupManager] Skipping locked file',
        expect.objectContaining({ path: '/src/messages.json' })
      )
    })
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
