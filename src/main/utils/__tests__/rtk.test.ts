import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  }
}))

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/home/testuser'
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@shared/config/constant', () => ({
  HOME_CHERRY_DIR: '.cherrystudio'
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

vi.mock('../../constant', () => ({
  isWin: false
}))

vi.mock('..', () => ({
  getResourcePath: () => '/app/resources',
  toAsarUnpackedPath: (filePath: string) => filePath
}))

vi.mock('semver', () => ({
  gte: (version: string, range: string) => {
    const [aMaj, aMin, aPat] = version.split('.').map(Number)
    const [bMaj, bMin, bPat] = range.split('.').map(Number)
    if (aMaj !== bMaj) return aMaj > bMaj
    if (aMin !== bMin) return aMin > bMin
    return aPat >= bPat
  }
}))

import { execFile } from 'node:child_process'
import fs from 'node:fs'

import { extractRtkBinaries, rtkRewrite } from '../rtk'

const mockExecFile = vi.mocked(execFile)
const mockFs = vi.mocked(fs)

describe('rtk utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('extractRtkBinaries', () => {
    it('should skip when bundled dir does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)

      await extractRtkBinaries()

      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
    })

    it('should copy binary when destination does not exist', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const filePath = String(p)
        if (filePath.includes('resources/binaries')) return true
        if (filePath.includes('rtk') && filePath.includes('.cherrystudio')) return false
        if (filePath.includes('.rtk-version') && filePath.includes('resources')) return true
        if (filePath.includes('.rtk-version') && filePath.includes('.cherrystudio')) return false
        return true
      })
      mockFs.readFileSync.mockReturnValue('0.30.1')

      await extractRtkBinaries()

      expect(mockFs.copyFileSync).toHaveBeenCalled()
      expect(mockFs.chmodSync).toHaveBeenCalledWith(expect.any(String), 0o755)
    })

    it('should skip copy when version matches', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('0.30.1')

      await extractRtkBinaries()

      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
    })
  })

  describe('rtkRewrite', () => {
    it('should return null when rtk binary is not found', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const result = await rtkRewrite('ls -la')

      expect(result).toBeNull()
    })

    it('should return null when rewritten command equals original', async () => {
      mockFs.existsSync.mockReturnValue(true)

      // First call: version check, second call: rewrite
      let callCount = 0
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback?) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        callCount++
        if (callCount === 1) {
          ;(cb as (...args: unknown[]) => void)(null, 'rtk 0.30.1', '')
        } else {
          ;(cb as (...args: unknown[]) => void)(null, 'ls -la', '')
        }
        return {} as ReturnType<typeof execFile>
      })

      const result = await rtkRewrite('ls -la')

      expect(result).toBeNull()
    })

    it('should return null when rtk exits with error (no rewrite available)', async () => {
      mockFs.existsSync.mockReturnValue(true)

      let callCount = 0
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback?) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        callCount++
        if (callCount === 1) {
          ;(cb as (...args: unknown[]) => void)(null, 'rtk 0.30.1', '')
        } else {
          ;(cb as (...args: unknown[]) => void)(new Error('exit code 1'), '', '')
        }
        return {} as ReturnType<typeof execFile>
      })

      const result = await rtkRewrite('some-command')

      expect(result).toBeNull()
    })
  })
})
