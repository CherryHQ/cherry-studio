import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn()
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

vi.mock('@main/utils/process', () => ({
  getBinaryPath: vi.fn().mockResolvedValue('/home/testuser/.cherrystudio/mise/shims/rtk')
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

import { getBinaryPath } from '@main/utils/process'

const mockExecFile = vi.mocked(execFile)
const mockFs = vi.mocked(fs)
const mockGetBinaryPath = vi.mocked(getBinaryPath)

describe('rtk utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module-level cache between tests by re-importing
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rtkRewrite', () => {
    it('should return null when rtk binary is not found', async () => {
      mockGetBinaryPath.mockResolvedValue('rtk')
      mockFs.existsSync.mockReturnValue(false)

      const { rtkRewrite: freshRtkRewrite } = await import('../rtk')
      const result = await freshRtkRewrite('ls -la')

      expect(result).toBeNull()
    })

    it('should return null when rewritten command equals original', async () => {
      mockGetBinaryPath.mockResolvedValue('/home/testuser/.cherrystudio/mise/shims/rtk')
      mockFs.existsSync.mockReturnValue(true)

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

      const { rtkRewrite: freshRtkRewrite } = await import('../rtk')
      const result = await freshRtkRewrite('ls -la')

      expect(result).toBeNull()
    })

    it('should return null when rtk exits with error (no rewrite available)', async () => {
      mockGetBinaryPath.mockResolvedValue('/home/testuser/.cherrystudio/mise/shims/rtk')
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

      const { rtkRewrite: freshRtkRewrite } = await import('../rtk')
      const result = await freshRtkRewrite('some-command')

      expect(result).toBeNull()
    })
  })
})
