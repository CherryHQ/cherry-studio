import { execFileSync, spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getBundledGitPath } from '../bundledGit'
import { findExecutableInEnv } from '../commandResolver'

vi.mock('child_process')
vi.mock('fs')
vi.mock('path')
vi.mock('@main/core/platform', () => ({ isWin: true }))
vi.mock('../shellEnv', () => ({
  getShellEnv: vi.fn(async () => ({ Path: 'C:\\Windows;C:\\mise\\shims;C:\\Cherry\\git\\cmd' }))
}))
vi.mock('../bundledGit', () => ({
  getBundledGitPath: vi.fn(() => null)
}))

const BUNDLED_GIT = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd\\git.exe'
const MISE_SHIM = 'C:\\mise\\shims\\git.cmd'
const SYSTEM_GIT = 'C:\\Git\\cmd\\git.exe'
const originalProgramFiles = process.env.ProgramFiles

function createMockChildProcess() {
  const mockChild = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  mockChild.stdout = new EventEmitter()
  mockChild.stderr = new EventEmitter()
  mockChild.kill = vi.fn()
  return mockChild
}

/** Mock the `where <name>` spawn used by findCommandInShellEnv to emit `lines`. */
function mockWhereSpawn(lines: string[]) {
  vi.mocked(spawn).mockImplementation(() => {
    const mockChild = createMockChildProcess()
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
    delete process.env.ProgramFiles

    vi.mocked(path.join).mockImplementation((...args) => args.join('\\'))
    vi.mocked(path.resolve).mockImplementation((...args) => args.join('\\'))
    vi.mocked(path.dirname).mockImplementation((p) => p.split('\\').slice(0, -1).join('\\'))
    vi.mocked(path.isAbsolute).mockImplementation((p) => /^[A-Z]:/i.test(p))
    Object.defineProperty(path, 'sep', { value: '\\', writable: true })
    vi.spyOn(process, 'cwd').mockReturnValue('C:\\cwd')

    // No git at the common install roots and no `where.exe` hits by default.
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not found')
    })
    vi.mocked(getBundledGitPath).mockReturnValue(BUNDLED_GIT)
  })

  afterEach(() => {
    if (originalProgramFiles === undefined) {
      delete process.env.ProgramFiles
    } else {
      process.env.ProgramFiles = originalProgramFiles
    }
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
