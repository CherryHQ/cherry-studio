import type * as PathModule from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    error: vi.fn()
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
    })
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
    createWriteStream: vi.fn(),
    createReadStream: vi.fn()
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
  createWriteStream: vi.fn(),
  createReadStream: vi.fn()
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
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
    // Mirrors tests/__mocks__/main/application.ts so that BackupManager methods
    // calling application.getPath('app.userdata.data') still work in this test
    // (this file overrides the global application mock from main.setup.ts).
    getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`))
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
  default: vi.fn()
}))

// Import after mocks
import * as fs from 'fs-extra'
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
