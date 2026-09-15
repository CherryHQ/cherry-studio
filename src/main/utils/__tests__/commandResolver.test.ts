import { execFileSync, spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import which from 'which'

import {
  autoDiscoverGitBash,
  findCommandInShellEnv,
  findExecutable,
  findExecutableInEnv,
  findGitBash,
  findViaMise,
  validateGitBashPath
} from '../commandResolver'

// Mock dependencies
vi.mock('child_process')
vi.mock('fs')
vi.mock('path')
vi.mock('../shellEnv', () => ({
  getShellEnv: vi.fn(),
  getPathFromEnvironment: (env: Record<string, string | undefined>) =>
    Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]
}))
vi.mock('which')

// On win32 `path` and `path.win32` are the same object, so a mock installed on one is
// visible through the other — both must share this implementation or they clobber it.
function resolveWindowsPath(...args: string[]): string {
  let result = args.join('\\')

  // Handle .. navigation
  while (result.includes('\\..')) {
    result = result.replace(/\\[^\\]+\\\.\./g, '')
  }

  // Ensure absolute path
  if (!result.match(/^[A-Z]:/)) {
    result = `C:\\cwd\\${result}`
  }

  return result
}

// These tests only run on Windows since the functions have platform guards
describe.skipIf(process.platform !== 'win32')('process utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(which)
      .mockReset()
      .mockResolvedValue(null as never)
    vi.mocked(which.sync)
      .mockReset()
      .mockReturnValue(null as never)

    // Mock path.join to concatenate paths with backslashes (Windows-style)
    vi.mocked(path.join).mockImplementation((...args) => args.join('\\'))

    // Mock path.resolve to handle path resolution with .. support
    vi.mocked(path.resolve).mockImplementation(resolveWindowsPath)

    // Mock path.dirname
    vi.mocked(path.dirname).mockImplementation((p) => {
      const parts = p.split('\\')
      parts.pop()
      return parts.join('\\')
    })

    vi.mocked(path.basename).mockImplementation((p) => p.split('\\').at(-1) ?? p)

    // Mock path.sep
    Object.defineProperty(path, 'sep', { value: '\\', writable: true })
    vi.mocked(path.win32.resolve).mockImplementation(resolveWindowsPath)
    vi.mocked(path.win32.extname).mockImplementation((p) => p.match(/\.[^\\/.]+$/)?.[0] ?? '')
    vi.mocked(path.win32.relative).mockImplementation((from, to) => {
      const lowerFrom = from.toLowerCase()
      const lowerTo = to.toLowerCase()
      return lowerTo.startsWith(`${lowerFrom}\\`) ? to.slice(from.length + 1) : to
    })
    vi.mocked(path.win32.isAbsolute).mockImplementation((p) => /^[A-Z]:/i.test(p))
    Object.defineProperty(path.win32, 'sep', { value: '\\', writable: true })

    // Mock process.cwd()
    vi.spyOn(process, 'cwd').mockReturnValue('C:\\cwd')
  })

  describe('findExecutable', () => {
    describe('git common paths', () => {
      it('should find git at Program Files path', () => {
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
        process.env.ProgramFiles = 'C:\\Program Files'

        vi.mocked(fs.existsSync).mockImplementation((p) => p === gitPath)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
        expect(fs.existsSync).toHaveBeenCalledWith(gitPath)
      })

      it('should find git at Program Files (x86) path', () => {
        const gitPath = 'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
        process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)'

        vi.mocked(fs.existsSync).mockImplementation((p) => p === gitPath)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
        expect(fs.existsSync).toHaveBeenCalledWith(gitPath)
      })

      it('should use fallback paths when environment variables are not set', () => {
        delete process.env.ProgramFiles
        delete process.env['ProgramFiles(x86)']

        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
        vi.mocked(fs.existsSync).mockImplementation((p) => p === gitPath)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
      })
    })

    describe('PATH lookup', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
        // Common paths don't exist
        vi.mocked(fs.existsSync).mockReturnValue(false)
      })

      it('should find executable through the supplied PATH', () => {
        const gitPath = 'C:\\Git\\bin\\git.exe'
        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
        expect(which.sync).toHaveBeenCalledWith(
          'git',
          expect.objectContaining({ all: true, nothrow: true, pathExt: '.exe;.cmd' })
        )
        expect(execFileSync).not.toHaveBeenCalled()
      })

      it('should return the first safe candidate', () => {
        const gitPath1 = 'C:\\Git\\bin\\git.exe'
        const gitPath2 = 'C:\\Tools\\Git\\cmd\\git.exe'
        vi.mocked(which.sync).mockReturnValue([gitPath1, gitPath2] as never)

        const result = findExecutable('git')

        expect(result).toBe(gitPath1)
      })

      it('should trim candidate paths', () => {
        const gitPath = 'C:\\Git\\bin\\git.exe'
        vi.mocked(which.sync).mockReturnValue([`  ${gitPath}  `] as never)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
      })
    })

    describe('security checks', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
        vi.mocked(fs.existsSync).mockReturnValue(false)
      })

      it('should skip executables in current directory', () => {
        const maliciousPath = 'C:\\cwd\\git.exe'
        const safePath = 'C:\\Git\\bin\\git.exe'

        vi.mocked(which.sync).mockReturnValue([maliciousPath, safePath] as never)

        const result = findExecutable('git')

        // Should skip malicious path and return safe path
        expect(result).toBe(safePath)
      })

      it('should skip executables in current directory subdirectories', () => {
        const maliciousPath = 'C:\\cwd\\subdir\\git.exe'
        const safePath = 'C:\\Git\\bin\\git.exe'

        vi.mocked(which.sync).mockReturnValue([maliciousPath, safePath] as never)

        const result = findExecutable('git')

        expect(result).toBe(safePath)
      })

      it('should return null when only malicious executables are found', () => {
        const maliciousPath = 'C:\\cwd\\git.exe'

        vi.mocked(which.sync).mockReturnValue([maliciousPath] as never)

        const result = findExecutable('git')

        expect(result).toBeNull()
      })
    })

    describe('error handling', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
        vi.mocked(fs.existsSync).mockReturnValue(false)
      })

      it('should return null when PATH lookup fails', () => {
        vi.mocked(which.sync).mockImplementation(() => {
          throw new Error('Command failed')
        })

        const result = findExecutable('nonexistent')

        expect(result).toBeNull()
      })

      it('should return null when PATH lookup has no candidates', () => {
        vi.mocked(which.sync).mockReturnValue(null as never)

        const result = findExecutable('git')

        expect(result).toBeNull()
      })
    })

    describe('non-git executables', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
      })

      it('should skip common paths check for non-git executables', () => {
        const nodePath = 'C:\\Program Files\\nodejs\\node.exe'

        vi.mocked(which.sync).mockReturnValue([nodePath] as never)

        const result = findExecutable('node')

        expect(result).toBe(nodePath)
        // Should not check common Git paths
        expect(fs.existsSync).not.toHaveBeenCalledWith(expect.stringContaining('Git\\cmd\\node.exe'))
      })
    })

    describe('options parameter', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
        vi.mocked(fs.existsSync).mockReturnValue(false)
      })

      it('should filter results by custom extensions', () => {
        vi.mocked(which.sync).mockReturnValue(['C:\\nodejs\\npm.cmd'] as never)

        const result = findExecutable('npm', { extensions: ['.cmd'] })

        expect(result).toBe('C:\\nodejs\\npm.cmd')
      })

      it('should accept multiple extensions', () => {
        vi.mocked(which.sync).mockReturnValue(['C:\\nodejs\\npm.cmd', 'C:\\nodejs\\npm.exe'] as never)

        const result = findExecutable('npm', { extensions: ['.cmd', '.exe'] })

        // Should return first matching extension
        expect(result).toBe('C:\\nodejs\\npm.cmd')
      })

      it('should return null when no results match allowed extensions', () => {
        vi.mocked(which.sync).mockReturnValue(['C:\\nodejs\\npm.ps1'] as never)

        const result = findExecutable('npm', { extensions: ['.cmd', '.exe'] })

        expect(result).toBeNull()
      })

      it('should match both .exe and .cmd by default', () => {
        vi.mocked(which.sync).mockReturnValue(['C:\\nodejs\\node.cmd', 'C:\\nodejs\\node.exe'] as never)

        const result = findExecutable('node')

        // Default extensions include both .exe and .cmd, returns first match
        expect(result).toBe('C:\\nodejs\\node.cmd')
      })

      it('should handle case-insensitive extension matching', () => {
        vi.mocked(which.sync).mockReturnValue(['C:\\nodejs\\npm.CMD'] as never)

        const result = findExecutable('npm', { extensions: ['.cmd'] })

        expect(result).toBe('C:\\nodejs\\npm.CMD')
      })
    })
  })

  describe('validateGitBashPath', () => {
    it('returns null when path is null', () => {
      const result = validateGitBashPath(null)

      expect(result).toBeNull()
    })

    it('returns null when path is undefined', () => {
      const result = validateGitBashPath(undefined)

      expect(result).toBeNull()
    })

    it('returns normalized path when valid bash.exe exists', () => {
      const customPath = 'C:\\PortableGit\\bin\\bash.exe'
      vi.mocked(fs.existsSync).mockImplementation((p) => p === 'C:\\PortableGit\\bin\\bash.exe')

      const result = validateGitBashPath(customPath)

      expect(result).toBe('C:\\PortableGit\\bin\\bash.exe')
    })

    it('returns null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = validateGitBashPath('C:\\missing\\bash.exe')

      expect(result).toBeNull()
    })

    it('returns null when path is not bash.exe', () => {
      const customPath = 'C:\\PortableGit\\bin\\git.exe'
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const result = validateGitBashPath(customPath)

      expect(result).toBeNull()
    })
  })

  describe('findGitBash', () => {
    describe('customPath parameter', () => {
      beforeEach(() => {
        delete process.env.CLAUDE_CODE_GIT_BASH_PATH
      })

      it('uses customPath when valid', () => {
        const customPath = 'C:\\CustomGit\\bin\\bash.exe'
        vi.mocked(fs.existsSync).mockImplementation((p) => p === customPath)

        const result = findGitBash(customPath)

        expect(result).toBe(customPath)
        expect(execFileSync).not.toHaveBeenCalled()
      })

      it('falls back when customPath is invalid', () => {
        const customPath = 'C:\\Invalid\\bash.exe'
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
        const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          if (p === customPath) return false
          if (p === gitPath) return true
          if (p === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash(customPath)

        expect(result).toBe(bashPath)
      })

      it('prioritizes customPath over env override', () => {
        const customPath = 'C:\\CustomGit\\bin\\bash.exe'
        const envPath = 'C:\\EnvGit\\bin\\bash.exe'
        process.env.CLAUDE_CODE_GIT_BASH_PATH = envPath

        vi.mocked(fs.existsSync).mockImplementation((p) => p === customPath || p === envPath)

        const result = findGitBash(customPath)

        expect(result).toBe(customPath)
      })
    })

    describe('env override', () => {
      beforeEach(() => {
        delete process.env.CLAUDE_CODE_GIT_BASH_PATH
      })

      it('uses CLAUDE_CODE_GIT_BASH_PATH when valid', () => {
        const envPath = 'C:\\OverrideGit\\bin\\bash.exe'
        process.env.CLAUDE_CODE_GIT_BASH_PATH = envPath

        vi.mocked(fs.existsSync).mockImplementation((p) => p === envPath)

        const result = findGitBash()

        expect(result).toBe(envPath)
        expect(execFileSync).not.toHaveBeenCalled()
      })

      it('falls back when CLAUDE_CODE_GIT_BASH_PATH is invalid', () => {
        const envPath = 'C:\\Invalid\\bash.exe'
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
        const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

        process.env.CLAUDE_CODE_GIT_BASH_PATH = envPath

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          if (p === envPath) return false
          if (p === gitPath) return true
          if (p === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })
    })

    describe('git.exe path derivation', () => {
      it('should derive bash.exe from standard Git installation (Git/cmd/git.exe)', () => {
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
        const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

        // findExecutable will find git at common path
        process.env.ProgramFiles = 'C:\\Program Files'
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          return p === gitPath || p === bashPath
        })

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should derive bash.exe from portable Git installation (Git/bin/git.exe)', () => {
        const gitPath = 'C:\\PortableGit\\bin\\git.exe'
        const bashPath = 'C:\\PortableGit\\bin\\bash.exe'

        // Common Git paths do not exist, but PATH contains portable Git.
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common git paths don't exist
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Portable bash.exe exists at Git/bin/bash.exe (second path in possibleBashPaths)
          if (pathStr === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should derive bash.exe from MSYS2 Git installation (Git/usr/bin/bash.exe)', () => {
        const gitPath = 'C:\\msys64\\usr\\bin\\git.exe'
        const bashPath = 'C:\\msys64\\usr\\bin\\bash.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common git paths don't exist
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // MSYS2 bash.exe exists at usr/bin/bash.exe (third path in possibleBashPaths)
          if (pathStr === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should try multiple bash.exe locations in order', () => {
        const gitPath = 'C:\\Git\\cmd\\git.exe'
        const bashPath = 'C:\\Git\\bin\\bash.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common git paths don't exist
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Standard path exists (first in possibleBashPaths)
          if (pathStr === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should handle when git.exe is found but bash.exe is not at any derived location', () => {
        const gitPath = 'C:\\Git\\cmd\\git.exe'

        // git.exe exists on PATH, but bash.exe does not exist at any derived location.
        vi.mocked(fs.existsSync).mockImplementation(() => {
          // Only return false for all bash.exe checks
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        // Should fall back to common paths check
        expect(result).toBeNull()
      })
    })

    describe('common paths fallback', () => {
      beforeEach(() => {
        vi.mocked(which.sync).mockReturnValue(null as never)
      })

      it('should check Program Files path', () => {
        const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'
        process.env.ProgramFiles = 'C:\\Program Files'

        vi.mocked(fs.existsSync).mockImplementation((p) => p === bashPath)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should check Program Files (x86) path', () => {
        const bashPath = 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
        process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)'

        vi.mocked(fs.existsSync).mockImplementation((p) => p === bashPath)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should check LOCALAPPDATA path', () => {
        const bashPath = 'C:\\Users\\User\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
        process.env.LOCALAPPDATA = 'C:\\Users\\User\\AppData\\Local'

        vi.mocked(fs.existsSync).mockImplementation((p) => p === bashPath)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should skip LOCALAPPDATA check when environment variable is not set', () => {
        delete process.env.LOCALAPPDATA

        vi.mocked(fs.existsSync).mockReturnValue(false)

        const result = findGitBash()

        expect(result).toBeNull()
        // Should not check invalid path with empty LOCALAPPDATA
        expect(fs.existsSync).not.toHaveBeenCalledWith(expect.stringContaining('undefined'))
      })

      it('should use fallback values when environment variables are not set', () => {
        delete process.env.ProgramFiles
        delete process.env['ProgramFiles(x86)']

        const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'
        vi.mocked(fs.existsSync).mockImplementation((p) => p === bashPath)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })
    })

    describe('priority order', () => {
      it('should prioritize git.exe derivation over common paths', () => {
        const gitPath = 'C:\\CustomPath\\Git\\cmd\\git.exe'
        const derivedBashPath = 'C:\\CustomPath\\Git\\bin\\bash.exe'
        const commonBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

        // Both exist
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common Git paths do not exist, so findExecutable uses PATH.
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Both bash paths exist, but derived should be checked first
          if (pathStr === derivedBashPath) return true
          if (pathStr === commonBashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        // Should return derived path, not common path
        expect(result).toBe(derivedBashPath)
      })
    })

    describe('error scenarios', () => {
      it('should return null when Git is not installed anywhere', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)
        vi.mocked(which.sync).mockReturnValue(null as never)

        const result = findGitBash()

        expect(result).toBeNull()
      })

      it('should return null when git.exe exists but bash.exe does not', () => {
        const gitPath = 'C:\\Git\\cmd\\git.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          // git.exe exists, but no bash.exe anywhere
          return p === gitPath
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBeNull()
      })
    })

    describe('real-world scenarios', () => {
      it('should handle official Git for Windows installer', () => {
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
        const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

        process.env.ProgramFiles = 'C:\\Program Files'
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          return p === gitPath || p === bashPath
        })

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should handle portable Git installation in custom directory', () => {
        const gitPath = 'D:\\DevTools\\PortableGit\\bin\\git.exe'
        const bashPath = 'D:\\DevTools\\PortableGit\\bin\\bash.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common paths don't exist
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Portable Git paths exist (portable uses second path: Git/bin/bash.exe)
          if (pathStr === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should handle Git installed via Scoop', () => {
        // Scoop typically installs to %USERPROFILE%\scoop\apps\git\current
        const gitPath = 'C:\\Users\\User\\scoop\\apps\\git\\current\\cmd\\git.exe'
        const bashPath = 'C:\\Users\\User\\scoop\\apps\\git\\current\\bin\\bash.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common paths don't exist
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Scoop bash path exists (standard structure: cmd -> bin)
          if (pathStr === bashPath) return true
          return false
        })

        vi.mocked(which.sync).mockReturnValue([gitPath] as never)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })
    })
  })

  describe('autoDiscoverGitBash', () => {
    const originalEnvVar = process.env.CLAUDE_CODE_GIT_BASH_PATH

    beforeEach(() => {
      delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    })

    afterEach(() => {
      if (originalEnvVar !== undefined) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = originalEnvVar
      } else {
        delete process.env.CLAUDE_CODE_GIT_BASH_PATH
      }
    })

    const mockExistingPaths = (...validPaths: string[]) => {
      vi.mocked(fs.existsSync).mockImplementation((p) => validPaths.includes(p as string))
    }

    it('returns the CLAUDE_CODE_GIT_BASH_PATH override when it is valid', () => {
      const envPath = 'C:\\EnvGit\\bin\\bash.exe'
      process.env.CLAUDE_CODE_GIT_BASH_PATH = envPath
      mockExistingPaths(envPath)

      expect(autoDiscoverGitBash()).toBe(envPath)
    })

    it('falls back to auto-discovery when the env override is invalid', () => {
      const envPath = 'C:\\Invalid\\bash.exe'
      const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
      const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

      process.env.CLAUDE_CODE_GIT_BASH_PATH = envPath
      process.env.ProgramFiles = 'C:\\Program Files'
      // env path does not exist; the standard Git install does
      mockExistingPaths(gitPath, bashPath)

      expect(autoDiscoverGitBash()).toBe(bashPath)
    })

    it('discovers Git Bash from a standard Git for Windows install', () => {
      const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'
      const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'

      process.env.ProgramFiles = 'C:\\Program Files'
      mockExistingPaths(gitPath, bashPath)

      expect(autoDiscoverGitBash()).toBe(bashPath)
    })

    it('returns null when Git Bash cannot be found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('Not found')
      })

      expect(autoDiscoverGitBash()).toBeNull()
    })
  })
})

describe('validateGitBashPath filename validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(path.resolve).mockImplementation((input) => input)
    vi.mocked(path.basename).mockImplementation((input) => input.split('\\').at(-1) ?? input)
  })

  it('rejects the Git Bash terminal launcher', () => {
    const launcherPath = 'C:\\PortableGit\\git-bash.exe'
    vi.mocked(fs.existsSync).mockReturnValue(true)

    expect(validateGitBashPath(launcherPath)).toBeNull()
  })
})

describe.skipIf(process.platform !== 'win32')('findViaMise', () => {
  const misePath = 'C:\\Users\\User\\AppData\\Local\\mise\\bin\\mise.exe'
  const env = { PATH: 'C:\\Windows\\system32' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(which)
      .mockReset()
      .mockResolvedValue(null as never)
    vi.mocked(path.win32.resolve).mockImplementation(resolveWindowsPath)
    vi.mocked(path.win32.extname).mockImplementation((p) => p.match(/\.[^\\/.]+$/)?.[0] ?? '')
    vi.mocked(path.win32.relative).mockImplementation((_from, to) => to)
    vi.mocked(path.win32.isAbsolute).mockImplementation((p) => /^[A-Z]:/i.test(p))
  })

  it('returns null when mise is not installed', async () => {
    vi.mocked(which).mockResolvedValue(null as never)

    const result = await findViaMise('node', env)

    expect(result).toBeNull()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('returns null when mise is installed but tool is not managed', async () => {
    vi.mocked(which).mockResolvedValue([misePath] as never)
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('No runtime found for node')
    })

    const result = await findViaMise('node', env)

    expect(result).toBeNull()
  })

  it('returns the resolved path when mise manages the tool', async () => {
    const nodePath = 'C:\\Users\\User\\AppData\\Local\\mise\\installs\\node\\22.0.0\\node.exe'

    vi.mocked(which).mockResolvedValue([misePath] as never)
    vi.mocked(execFileSync).mockReturnValue(`${nodePath}\n`)
    vi.mocked(fs.existsSync).mockImplementation((p) => p === nodePath)

    const result = await findViaMise('node', env)

    expect(result).toBe(nodePath)
  })

  it('returns null when mise which times out', async () => {
    vi.mocked(which).mockResolvedValue([misePath] as never)
    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error('ETIMEDOUT') as NodeJS.ErrnoException
      err.code = 'ETIMEDOUT'
      throw err
    })

    const result = await findViaMise('node', env)

    expect(result).toBeNull()
  })

  it('returns null when mise which returns a non-existent path', async () => {
    const ghostPath = 'C:\\Users\\User\\AppData\\Local\\mise\\installs\\node\\22.0.0\\node.exe'

    vi.mocked(which).mockResolvedValue([misePath] as never)
    vi.mocked(execFileSync).mockReturnValue(`${ghostPath}\n`)
    // The resolved path does not exist on disk
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = await findViaMise('node', env)

    expect(result).toBeNull()
  })
})

/**
 * Helper to create a mock child process for spawn
 */
function createMockChildProcess() {
  const mockChild = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  }
  mockChild.stdout = new EventEmitter()
  mockChild.stderr = new EventEmitter()
  mockChild.kill = vi.fn()
  return mockChild
}

describe('findCommandInShellEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(which)
      .mockReset()
      .mockResolvedValue(null as never)
    vi.mocked(which.sync)
      .mockReset()
      .mockReturnValue(null as never)
    // Reset path.isAbsolute to real implementation for these tests
    vi.mocked(path.isAbsolute).mockImplementation((p) => p.startsWith('/') || /^[A-Z]:/i.test(p))
    vi.mocked(path.resolve).mockImplementation((p: string) => p)
    vi.mocked(path.win32.resolve).mockImplementation(resolveWindowsPath)
    vi.mocked(path.win32.extname).mockImplementation((p) => p.match(/\.[^\\/.]+$/)?.[0] ?? '')
    vi.mocked(path.win32.relative).mockImplementation((from, to) => {
      const lowerFrom = from.toLowerCase()
      const lowerTo = to.toLowerCase()
      return lowerTo.startsWith(`${lowerFrom}\\`) ? to.slice(from.length + 1) : to
    })
    vi.mocked(path.win32.isAbsolute).mockImplementation((p) => /^[A-Z]:/i.test(p))
    Object.defineProperty(path.win32, 'sep', { value: '\\', writable: true })
  })

  describe('command name validation', () => {
    // Clearing validation means the platform lookup ran: `which` on Windows,
    // `sh -c 'command -v'` everywhere else.
    const commandLookup = () => (process.platform === 'win32' ? which : spawn)

    it('should reject empty command name', async () => {
      const result = await findCommandInShellEnv('', {})
      expect(result).toBeNull()
      expect(commandLookup()).not.toHaveBeenCalled()
    })

    it('should reject command names with shell metacharacters', async () => {
      const maliciousCommands = [
        'npx; rm -rf /',
        'npx && malicious',
        'npx | cat /etc/passwd',
        'npx`whoami`',
        '$(whoami)',
        'npx\nmalicious'
      ]

      for (const cmd of maliciousCommands) {
        const result = await findCommandInShellEnv(cmd, {})
        expect(result).toBeNull()
        expect(commandLookup()).not.toHaveBeenCalled()
      }
    })

    it('should reject command names starting with hyphen', async () => {
      const result = await findCommandInShellEnv('-npx', {})
      expect(result).toBeNull()
      expect(commandLookup()).not.toHaveBeenCalled()
    })

    it('should reject path traversal attempts', async () => {
      const pathTraversalCommands = ['../npx', '../../malicious', 'foo/bar', 'foo\\bar']

      for (const cmd of pathTraversalCommands) {
        const result = await findCommandInShellEnv(cmd, {})
        expect(result).toBeNull()
        expect(commandLookup()).not.toHaveBeenCalled()
      }
    })

    it('should return an existing absolute executable without shell lookup', async () => {
      const absolute = 'C:\\Program Files\\nodejs\\npx.cmd'
      vi.mocked(path.isAbsolute).mockReturnValue(true)
      vi.mocked(path.resolve).mockReturnValue(absolute)
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats)

      await expect(findCommandInShellEnv(absolute, {})).resolves.toBe(absolute)
      expect(commandLookup()).not.toHaveBeenCalled()
    })

    it('should reject an absolute path that does not exist', async () => {
      const absolute = 'C:\\missing\\uvx.exe'
      vi.mocked(path.isAbsolute).mockReturnValue(true)
      vi.mocked(path.resolve).mockReturnValue(absolute)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await expect(findCommandInShellEnv(absolute, {})).resolves.toBeNull()
      expect(commandLookup()).not.toHaveBeenCalled()
    })

    it('should reject an absolute path that is a directory', async () => {
      const absolute = '/usr/local/bin'
      vi.mocked(path.isAbsolute).mockReturnValue(true)
      vi.mocked(path.resolve).mockReturnValue(absolute)
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as fs.Stats)

      await expect(findCommandInShellEnv(absolute, {})).resolves.toBeNull()
      expect(commandLookup()).not.toHaveBeenCalled()
    })

    it('should reject command names exceeding max length', async () => {
      const longCommand = 'a'.repeat(129)
      const result = await findCommandInShellEnv(longCommand, {})
      expect(result).toBeNull()
      expect(commandLookup()).not.toHaveBeenCalled()
    })

    it('should accept valid command names', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      // Don't await - just start the call
      const resultPromise = findCommandInShellEnv('npx', { PATH: '/usr/bin' })

      // Simulate command not found
      mockChild.emit('close', 1)

      const result = await resultPromise
      expect(result).toBeNull()
      expect(commandLookup()).toHaveBeenCalled()
    })

    it('should accept command names with underscores and hyphens', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const resultPromise = findCommandInShellEnv('my_command-name', { PATH: '/usr/bin' })
      mockChild.emit('close', 1)

      await resultPromise
      expect(commandLookup()).toHaveBeenCalled()
    })

    it('should accept command names at max length (128 chars)', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const maxLengthCommand = 'a'.repeat(128)
      const resultPromise = findCommandInShellEnv(maxLengthCommand, { PATH: '/usr/bin' })
      mockChild.emit('close', 1)

      await resultPromise
      expect(commandLookup()).toHaveBeenCalled()
    })
  })

  describe.skipIf(process.platform === 'win32')('Unix/macOS behavior', () => {
    it('should find command and return absolute path', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const resultPromise = findCommandInShellEnv('npx', { PATH: '/usr/bin' })

      // Simulate successful command -v output
      mockChild.stdout.emit('data', '/usr/local/bin/npx\n')
      mockChild.emit('close', 0)

      const result = await resultPromise
      expect(result).toBe('/usr/local/bin/npx')
      expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'command -v "$1"', '--', 'npx'], expect.any(Object))
    })

    it('should return null for non-absolute paths (aliases/builtins)', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const resultPromise = findCommandInShellEnv('cd', { PATH: '/usr/bin' })

      // Simulate builtin output (just command name)
      mockChild.stdout.emit('data', 'cd\n')
      mockChild.emit('close', 0)

      const result = await resultPromise
      expect(result).toBeNull()
    })

    it('should return null when command not found', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const resultPromise = findCommandInShellEnv('nonexistent', { PATH: '/usr/bin' })

      // Simulate command not found (exit code 1)
      mockChild.emit('close', 1)

      const result = await resultPromise
      expect(result).toBeNull()
    })

    it('should handle spawn errors gracefully', async () => {
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const resultPromise = findCommandInShellEnv('npx', { PATH: '/usr/bin' })

      // Simulate spawn error
      mockChild.emit('error', new Error('spawn failed'))

      const result = await resultPromise
      expect(result).toBeNull()
    })

    it('should handle timeout gracefully', async () => {
      vi.useFakeTimers()
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      const resultPromise = findCommandInShellEnv('npx', { PATH: '/usr/bin' })

      // Fast-forward past timeout (5000ms)
      vi.advanceTimersByTime(6000)

      const result = await resultPromise
      expect(result).toBeNull()
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')

      vi.useRealTimers()
    })
  })

  describe.skipIf(process.platform !== 'win32')('Windows behavior', () => {
    it('should find .exe files through PATH lookup', async () => {
      vi.mocked(which).mockResolvedValue(['C:\\Program Files\\nodejs\\npx.exe'] as never)

      const result = await findCommandInShellEnv('npx', { PATH: 'C:\\nodejs' })

      expect(result).toBe('C:\\Program Files\\nodejs\\npx.exe')
      expect(which).toHaveBeenCalledWith('npx', {
        all: true,
        delimiter: ';',
        nothrow: true,
        path: 'C:\\nodejs',
        pathExt: '.exe;.cmd'
      })
      expect(spawn).not.toHaveBeenCalled()
    })

    it('should find .cmd launchers on Windows', async () => {
      vi.mocked(which).mockResolvedValue(['C:\\Program Files\\nodejs\\npx.cmd'] as never)

      const result = await findCommandInShellEnv('npx', { PATH: 'C:\\nodejs' })
      expect(result).toBe('C:\\Program Files\\nodejs\\npx.cmd')
    })

    it('should prefer .exe over .cmd when both exist', async () => {
      vi.mocked(which).mockResolvedValue([
        'C:\\Program Files\\nodejs\\npx.cmd',
        'C:\\Program Files\\nodejs\\npx.exe'
      ] as never)

      const result = await findCommandInShellEnv('npx', { PATH: 'C:\\nodejs' })
      expect(result).toBe('C:\\Program Files\\nodejs\\npx.exe')
    })

    it('should handle lookup errors gracefully', async () => {
      vi.mocked(which).mockRejectedValue(new Error('lookup failed'))

      const result = await findCommandInShellEnv('npx', { PATH: 'C:\\nodejs' })
      expect(result).toBeNull()
    })

    it('findExecutableInEnv should resolve npx.cmd through the shell PATH', async () => {
      const { getShellEnv } = await import('../shellEnv')
      vi.mocked(getShellEnv).mockResolvedValue({ PATH: 'C:\\nodejs' })
      vi.mocked(which).mockResolvedValue(['C:\\Program Files\\nodejs\\npx.cmd'] as never)

      const result = await findExecutableInEnv('npx')
      expect(result).toBe('C:\\Program Files\\nodejs\\npx.cmd')
    })
  })
})
