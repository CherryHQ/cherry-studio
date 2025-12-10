import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findExecutable, findGitBash, validateGitBashPath } from '../process'

// Mock dependencies
vi.mock('child_process')
vi.mock('fs')
vi.mock('path')

// These tests only run on Windows since the functions have platform guards
describe.skipIf(process.platform !== 'win32')('process utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock path.join to concatenate paths with backslashes (Windows-style)
    vi.mocked(path.join).mockImplementation((...args) => args.join('\\'))

    // Mock path.resolve to handle path resolution with .. support
    vi.mocked(path.resolve).mockImplementation((...args) => {
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
    })

    // Mock path.dirname
    vi.mocked(path.dirname).mockImplementation((p) => {
      const parts = p.split('\\')
      parts.pop()
      return parts.join('\\')
    })

    // Mock path.sep
    Object.defineProperty(path, 'sep', { value: '\\', writable: true })

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

    describe('where.exe PATH lookup', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
        // Common paths don't exist
        vi.mocked(fs.existsSync).mockReturnValue(false)
      })

      it('should find executable via where.exe', () => {
        const gitPath = 'C:\\Git\\bin\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(gitPath)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
        expect(execFileSync).toHaveBeenCalledWith('where.exe', ['git.exe'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        })
      })

      it('should add .exe extension when calling where.exe', () => {
        vi.mocked(execFileSync).mockImplementation(() => {
          throw new Error('Not found')
        })

        findExecutable('node')

        expect(execFileSync).toHaveBeenCalledWith('where.exe', ['node.exe'], expect.any(Object))
      })

      it('should handle Windows line endings (CRLF)', () => {
        const gitPath1 = 'C:\\Git\\bin\\git.exe'
        const gitPath2 = 'C:\\Program Files\\Git\\cmd\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(`${gitPath1}\r\n${gitPath2}\r\n`)

        const result = findExecutable('git')

        // Should return the first valid path
        expect(result).toBe(gitPath1)
      })

      it('should handle Unix line endings (LF)', () => {
        const gitPath1 = 'C:\\Git\\bin\\git.exe'
        const gitPath2 = 'C:\\Program Files\\Git\\cmd\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(`${gitPath1}\n${gitPath2}\n`)

        const result = findExecutable('git')

        expect(result).toBe(gitPath1)
      })

      it('should handle mixed line endings', () => {
        const gitPath1 = 'C:\\Git\\bin\\git.exe'
        const gitPath2 = 'C:\\Program Files\\Git\\cmd\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(`${gitPath1}\r\n${gitPath2}\n`)

        const result = findExecutable('git')

        expect(result).toBe(gitPath1)
      })

      it('should trim whitespace from paths', () => {
        const gitPath = 'C:\\Git\\bin\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(`  ${gitPath}  \n`)

        const result = findExecutable('git')

        expect(result).toBe(gitPath)
      })

      it('should filter empty lines', () => {
        const gitPath = 'C:\\Git\\bin\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(`\n\n${gitPath}\n\n`)

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

        vi.mocked(execFileSync).mockReturnValue(`${maliciousPath}\n${safePath}`)

        vi.mocked(path.resolve).mockImplementation((p) => {
          if (p.includes('cwd\\git.exe')) return 'c:\\cwd\\git.exe'
          return 'c:\\git\\bin\\git.exe'
        })

        vi.mocked(path.dirname).mockImplementation((p) => {
          if (p.includes('cwd\\git.exe')) return 'c:\\cwd'
          return 'c:\\git\\bin'
        })

        const result = findExecutable('git')

        // Should skip malicious path and return safe path
        expect(result).toBe(safePath)
      })

      it('should skip executables in current directory subdirectories', () => {
        const maliciousPath = 'C:\\cwd\\subdir\\git.exe'
        const safePath = 'C:\\Git\\bin\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(`${maliciousPath}\n${safePath}`)

        vi.mocked(path.resolve).mockImplementation((p) => {
          if (p.includes('cwd\\subdir')) return 'c:\\cwd\\subdir\\git.exe'
          return 'c:\\git\\bin\\git.exe'
        })

        vi.mocked(path.dirname).mockImplementation((p) => {
          if (p.includes('cwd\\subdir')) return 'c:\\cwd\\subdir'
          return 'c:\\git\\bin'
        })

        const result = findExecutable('git')

        expect(result).toBe(safePath)
      })

      it('should return null when only malicious executables are found', () => {
        const maliciousPath = 'C:\\cwd\\git.exe'

        vi.mocked(execFileSync).mockReturnValue(maliciousPath)

        vi.mocked(path.resolve).mockReturnValue('c:\\cwd\\git.exe')
        vi.mocked(path.dirname).mockReturnValue('c:\\cwd')

        const result = findExecutable('git')

        expect(result).toBeNull()
      })
    })

    describe('error handling', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
        vi.mocked(fs.existsSync).mockReturnValue(false)
      })

      it('should return null when where.exe fails', () => {
        vi.mocked(execFileSync).mockImplementation(() => {
          throw new Error('Command failed')
        })

        const result = findExecutable('nonexistent')

        expect(result).toBeNull()
      })

      it('should return null when where.exe returns empty output', () => {
        vi.mocked(execFileSync).mockReturnValue('')

        const result = findExecutable('git')

        expect(result).toBeNull()
      })

      it('should return null when where.exe returns only whitespace', () => {
        vi.mocked(execFileSync).mockReturnValue('   \n\n  ')

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

        vi.mocked(execFileSync).mockReturnValue(nodePath)

        const result = findExecutable('node')

        expect(result).toBe(nodePath)
        // Should not check common Git paths
        expect(fs.existsSync).not.toHaveBeenCalledWith(expect.stringContaining('Git\\cmd\\node.exe'))
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

        vi.mocked(execFileSync).mockReturnValue(gitPath)

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

        // Mock: common git paths don't exist, but where.exe finds portable git
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = p?.toString() || ''
          // Common git paths don't exist
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Portable bash.exe exists at Git/bin/bash.exe (second path in possibleBashPaths)
          if (pathStr === bashPath) return true
          return false
        })

        // where.exe returns portable git path
        vi.mocked(execFileSync).mockReturnValue(gitPath)

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

        vi.mocked(execFileSync).mockReturnValue(gitPath)

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

        vi.mocked(execFileSync).mockReturnValue(gitPath)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })

      it('should handle when git.exe is found but bash.exe is not at any derived location', () => {
        const gitPath = 'C:\\Git\\cmd\\git.exe'

        // git.exe exists via where.exe, but bash.exe doesn't exist at any derived location
        vi.mocked(fs.existsSync).mockImplementation(() => {
          // Only return false for all bash.exe checks
          return false
        })

        vi.mocked(execFileSync).mockReturnValue(gitPath)

        const result = findGitBash()

        // Should fall back to common paths check
        expect(result).toBeNull()
      })
    })

    describe('common paths fallback', () => {
      beforeEach(() => {
        // git.exe not found
        vi.mocked(execFileSync).mockImplementation(() => {
          throw new Error('Not found')
        })
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
          // Common git paths don't exist (so findExecutable uses where.exe)
          if (pathStr.includes('Program Files\\Git\\cmd\\git.exe')) return false
          if (pathStr.includes('Program Files (x86)\\Git\\cmd\\git.exe')) return false
          // Both bash paths exist, but derived should be checked first
          if (pathStr === derivedBashPath) return true
          if (pathStr === commonBashPath) return true
          return false
        })

        vi.mocked(execFileSync).mockReturnValue(gitPath)

        const result = findGitBash()

        // Should return derived path, not common path
        expect(result).toBe(derivedBashPath)
      })
    })

    describe('error scenarios', () => {
      it('should return null when Git is not installed anywhere', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)
        vi.mocked(execFileSync).mockImplementation(() => {
          throw new Error('Not found')
        })

        const result = findGitBash()

        expect(result).toBeNull()
      })

      it('should return null when git.exe exists but bash.exe does not', () => {
        const gitPath = 'C:\\Git\\cmd\\git.exe'

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          // git.exe exists, but no bash.exe anywhere
          return p === gitPath
        })

        vi.mocked(execFileSync).mockReturnValue(gitPath)

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

        vi.mocked(execFileSync).mockReturnValue(gitPath)

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

        vi.mocked(execFileSync).mockReturnValue(gitPath)

        const result = findGitBash()

        expect(result).toBe(bashPath)
      })
    })
  })
})
