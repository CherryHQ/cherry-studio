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
const { mockLogger, mockApp } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  mockApp: {
    getPath: vi.fn((key: string) => {
      if (key === 'temp') return '/tmp'
      if (key === 'userData') return '/mock/userData'
      return '/mock/unknown'
    }),
    getVersion: vi.fn(() => '1.9.1'),
    relaunch: vi.fn(),
    exit: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('electron', () => ({
  app: mockApp
}))

vi.mock('../../utils/fileOperations', () => ({
  copyDirectoryRecursive: vi.fn()
}))

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    remove: vi.fn(),
    ensureDir: vi.fn(),
    copy: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    writeFile: vi.fn(),
    createWriteStream: vi.fn(),
    createReadStream: vi.fn(),
    promises: {
      mkdir: vi.fn()
    }
  },
  pathExists: vi.fn(),
  remove: vi.fn(),
  ensureDir: vi.fn(),
  copy: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  readJson: vi.fn(),
  writeJson: vi.fn(),
  writeFile: vi.fn(),
  createWriteStream: vi.fn(() => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

    const stream = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] ??= []
        listeners[event].push(handler)
        return stream
      }),
      emit: vi.fn((event: string, ...args: unknown[]) => {
        for (const handler of listeners[event] ?? []) {
          handler(...args)
        }
        return true
      }),
      write: vi.fn(() => true),
      end: vi.fn(() => {
        stream.emit('finish')
        stream.emit('close')
      })
    }

    return stream
  }),
  createReadStream: vi.fn()
}))

vi.mock('../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn()
  }
}))

vi.mock('../WebDav', () => ({
  default: vi.fn()
}))

vi.mock('../S3Storage', () => ({
  default: vi.fn()
}))

vi.mock('../../utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

vi.mock('archiver', () => ({
  default: vi.fn(() => {
    let pipedOutput: { emit?: (event: string, ...args: unknown[]) => void } | null = null

    return {
      on: vi.fn(),
      pipe: vi.fn((output: { emit?: (event: string, ...args: unknown[]) => void }) => {
        pipedOutput = output
        return output
      }),
      directory: vi.fn(),
      finalize: vi.fn(async () => {
        pipedOutput?.emit?.('close')
      })
    }
  })
}))

vi.mock('node-stream-zip', () => ({
  default: vi.fn()
}))

// Import after mocks
import * as fs from 'fs-extra'

import { copyDirectoryRecursive } from '../../utils/fileOperations'
import BackupManager from '../BackupManager'

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
      expect(fs.remove).toHaveBeenCalledWith(validPath)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted temp backup'))
    })

    it('should delete file in nested subdirectory', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)

      const nestedPath = '/tmp/cherry-studio/lan-transfer/sub/dir/file.zip'
      const result = await backupManager.deleteLanTransferBackup({} as Electron.IpcMainInvokeEvent, nestedPath)

      expect(result).toBe(true)
      expect(fs.remove).toHaveBeenCalledWith(nestedPath)
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
      expect(fs.remove).toHaveBeenCalledWith(tempDir)
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

  describe('Directory Copy Helpers', () => {
    it('should skip broken symlinks while copying directories with progress', async () => {
      const entries = [
        {
          name: 'broken-link',
          isDirectory: () => false,
          isSymbolicLink: () => true,
          isFile: () => false
        },
        {
          name: 'settings.json',
          isDirectory: () => false,
          isSymbolicLink: () => false,
          isFile: () => true
        }
      ]

      vi.mocked(fs.readdir).mockResolvedValue(entries as never)
      vi.mocked(fs.stat).mockImplementation((filePath) => {
        const file = String(filePath)
        if (file.includes('broken-link')) {
          throw new Error('ENOENT: no such file or directory')
        }

        const size = file.includes('settings.json') ? 32 : 999
        return { size } as never
      })
      vi.mocked(fs.copy).mockResolvedValue(undefined as never)

      const progressUpdates: number[] = []
      await (backupManager as any).copyDirWithProgress('/source', '/dest', (size: number) => {
        progressUpdates.push(size)
      })

      expect(fs.copy).toHaveBeenCalledTimes(1)
      expect(fs.copy).toHaveBeenCalledWith('/source/settings.json', '/dest/settings.json')
      expect(fs.copy).not.toHaveBeenCalledWith('/source/broken-link', '/dest/broken-link')
      expect(progressUpdates).toEqual([32])
    })

    it('should ignore symlinks when calculating directory size', async () => {
      const entries = [
        {
          name: 'broken-link',
          isDirectory: () => false,
          isSymbolicLink: () => true,
          isFile: () => false
        },
        {
          name: 'settings.json',
          isDirectory: () => false,
          isSymbolicLink: () => false,
          isFile: () => true
        }
      ]

      vi.mocked(fs.readdir).mockResolvedValue(entries as never)
      vi.mocked(fs.stat).mockImplementation((filePath) => {
        const file = String(filePath)
        if (file.includes('broken-link')) {
          throw new Error('ENOENT: no such file or directory')
        }

        if (file.includes('settings.json')) {
          return { size: 32 } as never
        }

        return { size: 999 } as never
      })

      const totalSize = await (backupManager as any).getDirSize('/source')

      expect(totalSize).toBe(32)
      expect(fs.stat).toHaveBeenCalledTimes(1)
    })
  })

  describe('Direct Backup Flow', () => {
    it('should use symlink-safe directory copies for local backup databases', async () => {
      vi.mocked(fs.ensureDir).mockResolvedValue(undefined as never)
      vi.mocked(fs.pathExists).mockImplementation(async (targetPath) => {
        return String(targetPath).includes('IndexedDB') || String(targetPath).includes('Local Storage')
      })
      vi.mocked(fs.writeJson).mockResolvedValue(undefined as never)
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)
      vi.mocked(copyDirectoryRecursive).mockResolvedValue(undefined as never)

      const backupPath = await backupManager.backupToLocalDir({} as Electron.IpcMainInvokeEvent, 'backup.zip', {
        localBackupDir: '/mock/backup'
      })

      expect(backupPath).toBe('/mock/backup/backup.zip')
      expect(copyDirectoryRecursive).toHaveBeenCalledTimes(2)
      expect(copyDirectoryRecursive).toHaveBeenCalledWith(
        '/mock/userData/IndexedDB',
        '/tmp/cherry-studio/backup/temp/IndexedDB'
      )
      expect(copyDirectoryRecursive).toHaveBeenCalledWith(
        '/mock/userData/Local Storage',
        '/tmp/cherry-studio/backup/temp/Local Storage'
      )
      expect(fs.copy).not.toHaveBeenCalled()
    })

    it('should use symlink-safe directory copies when restoring database directories', async () => {
      const restoreSuffix = process.platform === 'win32' ? '.restore' : ''

      vi.mocked(fs.readJson).mockResolvedValue({
        version: 6,
        timestamp: Date.now(),
        appName: 'Cherry Studio',
        appVersion: '1.9.1',
        platform: process.platform,
        arch: process.arch
      } as never)
      vi.mocked(fs.pathExists).mockImplementation(async (targetPath) => {
        const target = String(targetPath)
        return target.includes('IndexedDB') || target.includes('Local Storage')
      })
      vi.mocked(fs.remove).mockResolvedValue(undefined as never)
      vi.mocked(copyDirectoryRecursive).mockResolvedValue(undefined as never)

      await (backupManager as any).restoreDirect()

      expect(copyDirectoryRecursive).toHaveBeenCalledTimes(2)
      expect(copyDirectoryRecursive).toHaveBeenCalledWith(
        '/tmp/cherry-studio/backup/temp/IndexedDB',
        `/mock/userData/IndexedDB${restoreSuffix}`
      )
      expect(copyDirectoryRecursive).toHaveBeenCalledWith(
        '/tmp/cherry-studio/backup/temp/Local Storage',
        `/mock/userData/Local Storage${restoreSuffix}`
      )
      expect(mockApp.relaunch).toHaveBeenCalled()
      expect(mockApp.exit).toHaveBeenCalledWith(0)
      expect(fs.copy).not.toHaveBeenCalled()
    })
  })
})
