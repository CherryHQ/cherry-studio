import { execFileSync } from 'node:child_process'
import { normalize, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getDefaultHooksDir,
  getLocalHooksPath,
  isDefaultGitHooksPath,
  isLinkedWorktree,
  main,
  runPrekInstall,
  unsetHooksPath
} from '../install-hooks'

// Mock child_process so git/pnpm calls are intercepted
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => '')
}))

const mockExec = vi.mocked(execFileSync)

// Helper: configure mock to respond to specific git commands
function mockGitResponses(responses: Record<string, string | null>): void {
  mockExec.mockImplementation(((cmd: string, args: string[]) => {
    if (cmd !== 'git') throw new Error(`unexpected command: ${cmd}`)
    const key = args.join(' ')
    const val = responses[key]
    if (val === null) {
      throw new Error(`ENOENT: git ${key}`)
    }
    return val
  }) as never)
}

// Suppress console output during main() tests
let logSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`)
  }) as never)
  delete process.env.npm_execpath
})

afterEach(() => {
  vi.restoreAllMocks()
  mockExec.mockReset()
})

describe('isLinkedWorktree', () => {
  it('returns false when git-dir equals git-common-dir (primary worktree)', () => {
    mockGitResponses({
      'rev-parse --absolute-git-dir': '/repo/.git',
      'rev-parse --git-common-dir': '/repo/.git'
    })
    expect(isLinkedWorktree()).toBe(false)
  })

  it('returns true when git-dir differs from git-common-dir (linked worktree)', () => {
    mockGitResponses({
      'rev-parse --absolute-git-dir': '/repo/.git/worktrees/wt1',
      'rev-parse --git-common-dir': '/repo/.git'
    })
    expect(isLinkedWorktree()).toBe(true)
  })

  it('returns null when git commands fail (detection failure)', () => {
    mockGitResponses({})
    expect(isLinkedWorktree()).toBeNull()
  })
})

describe('isDefaultGitHooksPath', () => {
  it('returns true when hooksPath matches default hooks dir', () => {
    mockGitResponses({
      'rev-parse --git-common-dir': '/repo/.git'
    })
    expect(isDefaultGitHooksPath(normalize(resolve('/repo/.git/hooks')))).toBe(true)
  })

  it('returns false when hooksPath is a custom path', () => {
    mockGitResponses({
      'rev-parse --git-common-dir': '/repo/.git'
    })
    expect(isDefaultGitHooksPath('/repo/.husky')).toBe(false)
  })

  it('returns false when git-common-dir is unavailable', () => {
    mockGitResponses({})
    expect(isDefaultGitHooksPath('/repo/.git/hooks')).toBe(false)
  })
})

describe('getDefaultHooksDir', () => {
  it('computes hooks dir from git-common-dir', () => {
    mockGitResponses({
      'rev-parse --git-common-dir': '/repo/.git'
    })
    expect(getDefaultHooksDir()).toBe(normalize(resolve('/repo/.git/hooks')))
  })

  it('returns null when git-common-dir fails', () => {
    mockGitResponses({})
    expect(getDefaultHooksDir()).toBeNull()
  })
})

describe('getLocalHooksPath', () => {
  it('returns hooksPath value when set', () => {
    mockGitResponses({
      'config --local --get core.hooksPath': '.husky'
    })
    expect(getLocalHooksPath()).toBe('.husky')
  })

  it('returns null when not set', () => {
    mockGitResponses({})
    expect(getLocalHooksPath()).toBeNull()
  })
})

describe('unsetHooksPath', () => {
  it('returns true when unset succeeds', () => {
    mockGitResponses({
      'config --local --unset-all core.hooksPath': ''
    })
    expect(unsetHooksPath()).toBe(true)
  })

  it('returns false when unset fails', () => {
    mockGitResponses({})
    expect(unsetHooksPath()).toBe(false)
  })
})

describe('runPrekInstall', () => {
  it('uses npm_execpath when set', () => {
    process.env.npm_execpath = '/path/to/pnpm.cjs'
    mockExec.mockReturnValue('')
    expect(runPrekInstall()).toBe(true)
    expect(mockExec).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([expect.stringContaining('pnpm'), 'exec', 'prek', 'install']),
      { stdio: 'inherit' }
    )
  })

  it('falls back to pnpm when npm_execpath is not set', () => {
    mockExec.mockReturnValue('')
    expect(runPrekInstall()).toBe(true)
    // On non-Windows, shell should be false
    expect(mockExec).toHaveBeenCalledWith('pnpm', ['exec', 'prek', 'install'], {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
  })

  it('returns false on exec failure', () => {
    mockExec.mockImplementation(() => {
      throw new Error('prek refused')
    })
    expect(runPrekInstall()).toBe(false)
  })
})

describe('main', () => {
  it('skips setup when not a git repo', () => {
    mockGitResponses({})
    main()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not a git repository'))
  })

  it('aborts when worktree detection fails', () => {
    mockGitResponses({
      'rev-parse --git-dir': '.git',
      'config blame.ignoreRevsFile .git-blame-ignore-revs': ''
    })
    // git-dir and git-common-dir commands will fail (not in responses)
    mockExec.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'pnpm') return ''
      const key = args.join(' ')
      const responses: Record<string, string> = {
        'rev-parse --git-dir': '.git',
        'config blame.ignoreRevsFile .git-blame-ignore-revs': ''
      }
      const val = responses[key]
      if (val === undefined) throw new Error(`ENOENT: git ${key}`)
      return val
    }) as never)

    expect(() => main()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('could not determine worktree status'))
  })

  it('skips prek install in linked worktree', () => {
    mockGitResponses({
      'rev-parse --git-dir': '.git',
      'config blame.ignoreRevsFile .git-blame-ignore-revs': '',
      'rev-parse --absolute-git-dir': '/repo/.git/worktrees/wt1',
      'rev-parse --git-common-dir': '/repo/.git'
    })
    main()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('linked worktree detected'))
  })

  it('cleans default hooksPath and proceeds with install', () => {
    const hooksDir = normalize(resolve('/repo/.git/hooks'))
    mockExec.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'pnpm') return ''
      const key = args.join(' ')
      const responses: Record<string, string | null> = {
        'rev-parse --git-dir': '.git',
        'config blame.ignoreRevsFile .git-blame-ignore-revs': '',
        'rev-parse --absolute-git-dir': '/repo/.git',
        'rev-parse --git-common-dir': '/repo/.git',
        'config --local --get core.hooksPath': hooksDir,
        'config --local --unset-all core.hooksPath': ''
      }
      const val = responses[key]
      if (val === undefined) throw new Error(`ENOENT: git ${key}`)
      if (val === null) throw new Error(`ENOENT: git ${key}`)
      return val
    }) as never)

    main()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('cleaned default core.hooksPath'))
  })

  it('aborts when unsetHooksPath fails', () => {
    const hooksDir = normalize(resolve('/repo/.git/hooks'))
    mockExec.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'pnpm') return ''
      const key = args.join(' ')
      const responses: Record<string, string | null> = {
        'rev-parse --git-dir': '.git',
        'config blame.ignoreRevsFile .git-blame-ignore-revs': '',
        'rev-parse --absolute-git-dir': '/repo/.git',
        'rev-parse --git-common-dir': '/repo/.git',
        'config --local --get core.hooksPath': hooksDir
        // unset intentionally missing — will fail
      }
      const val = responses[key]
      if (val === undefined) throw new Error(`ENOENT: git ${key}`)
      if (val === null) throw new Error(`ENOENT: git ${key}`)
      return val
    }) as never)

    expect(() => main()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed to unset core.hooksPath'))
  })

  it('preserves custom hooksPath and accepts prek refusal', () => {
    mockExec.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'pnpm') throw new Error('prek refused')
      const key = args.join(' ')
      const responses: Record<string, string | null> = {
        'rev-parse --git-dir': '.git',
        'config blame.ignoreRevsFile .git-blame-ignore-revs': '',
        'rev-parse --absolute-git-dir': '/repo/.git',
        'rev-parse --git-common-dir': '/repo/.git',
        'config --local --get core.hooksPath': '.husky'
      }
      const val = responses[key]
      if (val === undefined) throw new Error(`ENOENT: git ${key}`)
      if (val === null) throw new Error(`ENOENT: git ${key}`)
      return val
    }) as never)

    // prek refusal with custom hooksPath is acceptable
    main()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('prek skipped'))
  })

  it('exits non-zero when prek fails without custom hooksPath', () => {
    mockExec.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'pnpm') throw new Error('prek crashed')
      const key = args.join(' ')
      const responses: Record<string, string | null> = {
        'rev-parse --git-dir': '.git',
        'config blame.ignoreRevsFile .git-blame-ignore-revs': '',
        'rev-parse --absolute-git-dir': '/repo/.git',
        'rev-parse --git-common-dir': '/repo/.git',
        'config --local --get core.hooksPath': null
      }
      const val = responses[key]
      if (val === undefined) throw new Error(`ENOENT: git ${key}`)
      if (val === null) throw new Error(`ENOENT: git ${key}`)
      return val
    }) as never)

    expect(() => main()).toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('prek install failed unexpectedly'))
  })
})
