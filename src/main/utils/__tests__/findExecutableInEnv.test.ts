import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Force the Windows code path regardless of host — findExecutableInEnv's
// bundled-git fallback chain is Windows-only, and commandResolver.test.ts
// skips its Windows suites on other hosts, so this file covers the resolver
// ordering (system > mise shim > bundled MinGit) on every platform.
vi.mock('@main/core/platform', () => ({
  isWin: true,
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

vi.mock('child_process')
vi.mock('fs')
vi.mock('path')

// Canned shell env — the PATH content is irrelevant here because every lookup
// (`where` / `where.exe`) is mocked; only the object must exist.
vi.mock('../shellEnv', () => ({
  getShellEnv: vi.fn(async () => ({ Path: 'C:\\Windows;C:\\mise\\shims;C:\\Cherry\\git\\cmd' }))
}))

vi.mock('../bundledGit', () => ({
  getBundledGitPath: vi.fn(() => null),
  getBundledGitDir: vi.fn(() => null)
}))

import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getBundledGitPath } from '../bundledGit'
import { findExecutableInEnv } from '../commandResolver'

const BUNDLED_GIT = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd\\git.exe'
const MISE_SHIM = 'C:\\mise\\shims\\git.cmd'
const SYSTEM_GIT = 'C:\\Git\\cmd\\git.exe'

/** Mock the `where <name>` spawn used by findCommandInShellEnv to emit `lines`. */
function mockWhereSpawn(lines: string[]) {
  vi.mocked(spawn).mockImplementation(() => {
    const mockChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    mockChild.stdout = new EventEmitter()
    mockChild.stderr = new EventEmitter()
    mockChild.kill = vi.fn()
    setImmediate(() => {
      if (lines.length > 0) {
        mockChild.stdout.emit('data', lines.join('\r\n') + '\r\n')
        mockChild.emit('close', 0)
      } else {
        mockChild.emit('close', 1)
      }
    })
    return mockChild as never
  })
}

describe('findExecutableInEnv – bundled MinGit resolver ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Windows-style path mocks (mirrors commandResolver.test.ts) so
    // findExecutable's security checks work with C:\ paths on any host.
    vi.mocked(path.join).mockImplementation((...args) => args.join('\\'))
    vi.mocked(path.resolve).mockImplementation((...args) => args.join('\\'))
    vi.mocked(path.dirname).mockImplementation((p) => p.split('\\').slice(0, -1).join('\\'))
    Object.defineProperty(path, 'sep', { value: '\\', writable: true })
    vi.spyOn(process, 'cwd').mockReturnValue('C:\\cwd')

    // No git at the common install roots unless a test says otherwise.
    vi.mocked(fs.existsSync).mockReturnValue(false)
    // `where.exe` lookups (findExecutable / findViaMise) find nothing by default.
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not found')
    })
    vi.mocked(getBundledGitPath).mockReturnValue(BUNDLED_GIT)
  })

  it('resolves the mise .cmd shim ahead of the bundled git when `where` returns both', async () => {
    // Regression (PR #16402 review A1): with the bundled dir on the PATH tail,
    // `where git` yields the shim first and the bundled .exe last; the .exe-only
    // filter used to grab the bundled path and short-circuit mise resolution.
    mockWhereSpawn([MISE_SHIM, BUNDLED_GIT])
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'where.exe' && (args as string[])[0] === 'git') {
        return Buffer.from(`${MISE_SHIM}\r\n${BUNDLED_GIT}\r\n`)
      }
      throw new Error('not found')
    })

    await expect(findExecutableInEnv('git')).resolves.toBe(MISE_SHIM)
  })

  it('prefers system git on PATH over the bundled git', async () => {
    mockWhereSpawn([SYSTEM_GIT, BUNDLED_GIT])

    await expect(findExecutableInEnv('git')).resolves.toBe(SYSTEM_GIT)
  })

  it('prefers git at a common install root over the bundled git', async () => {
    // PATH only surfaces the bundled .exe, but Program Files has a real git.
    mockWhereSpawn([BUNDLED_GIT])
    process.env.ProgramFiles = 'C:\\Program Files'
    const commonGit = 'C:\\Program Files\\Git\\cmd\\git.exe'
    vi.mocked(fs.existsSync).mockImplementation((p) => p === commonGit)

    await expect(findExecutableInEnv('git')).resolves.toBe(commonGit)
  })

  it('falls back to the bundled git only when every other lookup misses', async () => {
    mockWhereSpawn([BUNDLED_GIT])
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'where.exe' && (args as string[])[0] === 'git') {
        return Buffer.from(`${BUNDLED_GIT}\r\n`)
      }
      throw new Error('not found') // no mise either
    })

    await expect(findExecutableInEnv('git')).resolves.toBe(BUNDLED_GIT)
  })

  it('returns null for git when nothing is found and no bundle is present', async () => {
    vi.mocked(getBundledGitPath).mockReturnValue(null)
    mockWhereSpawn([])

    await expect(findExecutableInEnv('git')).resolves.toBeNull()
  })
})
