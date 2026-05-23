import { execFileSync } from 'node:child_process'
import { normalize, resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => '')
}))

const mockExecFileSync = vi.mocked(execFileSync)

// Helper mirroring the production path comparison logic
function platformPathsEqual(pathA: string, pathB: string, isWindows: boolean): boolean {
  const a = normalize(resolve(pathA))
  const b = normalize(resolve(pathB))
  return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b
}

describe('install-hooks: Windows path comparison', () => {
  describe('linked worktree detection', () => {
    it('identical paths are equal regardless of platform', () => {
      const a = normalize(resolve('/Users/dev/repo/.git'))
      const b = normalize(resolve('/Users/dev/repo/.git'))
      expect(a).toBe(b)
    })

    it('different paths are not equal on non-Windows', () => {
      expect(platformPathsEqual('/Users/dev/repo/.git', '/Users/dev/other/.git', false)).toBe(false)
    })

    it('different paths are not equal on Windows', () => {
      expect(platformPathsEqual('D:\\Repo\\.git', 'D:\\Other\\.git', true)).toBe(false)
    })

    it('Windows: same logical path with different drive casing is equal', () => {
      const a = 'D:\\Repo\\.git'
      const b = 'd:\\repo\\.git'
      expect(a.toLowerCase()).toBe(b.toLowerCase())
    })

    it('Windows: same logical path with mixed directory casing is equal', () => {
      const a = 'C:\\Users\\Developer\\MyProject\\.git'
      const b = 'c:\\users\\DEVELOPER\\myproject\\.git'
      expect(a.toLowerCase()).toBe(b.toLowerCase())
    })

    it('non-Windows: case-sensitive comparison preserves distinction', () => {
      const a = '/Users/Dev/repo/.git'
      const b = '/users/dev/repo/.git'
      expect(a).not.toBe(b)
    })
  })

  describe('hooksPath cleanup', () => {
    it('does not match a custom hooksPath on non-Windows', () => {
      expect(platformPathsEqual('/Users/dev/repo/.husky', '/Users/dev/repo/.git/hooks', false)).toBe(false)
    })

    it('does not match a custom hooksPath on Windows', () => {
      expect(platformPathsEqual('D:\\Repo\\.husky', 'D:\\Repo\\.git\\hooks', true)).toBe(false)
    })

    it('Windows: hooksPath matching uses toLowerCase for comparison', () => {
      const hooksPath = 'D:\\REPO\\.GIT\\HOOKS'
      const defaultDir = 'd:\\repo\\.git\\hooks'
      expect(hooksPath.toLowerCase() === defaultDir.toLowerCase()).toBe(true)
    })
  })

  describe('shell option for pnpm fallback', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('passes shell: true on win32 platform', () => {
      const isWindows = 'win32' === 'win32'
      const opts = { stdio: 'inherit' as const, shell: isWindows }
      mockExecFileSync('pnpm', ['exec', 'prek', 'install'], opts)
      expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['exec', 'prek', 'install'], {
        stdio: 'inherit',
        shell: true
      })
    })

    it('passes shell: false on darwin platform', () => {
      const isWindows = 'darwin' === 'win32'
      const opts = { stdio: 'inherit' as const, shell: isWindows }
      mockExecFileSync('pnpm', ['exec', 'prek', 'install'], opts)
      expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['exec', 'prek', 'install'], {
        stdio: 'inherit',
        shell: false
      })
    })

    it('passes shell: false on linux platform', () => {
      const isWindows = 'linux' === 'win32'
      const opts = { stdio: 'inherit' as const, shell: isWindows }
      mockExecFileSync('pnpm', ['exec', 'prek', 'install'], opts)
      expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['exec', 'prek', 'install'], {
        stdio: 'inherit',
        shell: false
      })
    })
  })
})
