import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import which from 'which'

import { getBundledGitPath } from '../bundledGit'
import { findExecutableInEnv } from '../commandResolver'
import { getShellEnv } from '../shellEnv'

vi.mock('child_process')
vi.mock('fs')
vi.mock('path')
vi.mock('which')
vi.mock('@main/core/platform', () => ({ isWin: true }))
vi.mock('../shellEnv', () => ({
  getShellEnv: vi.fn()
}))
vi.mock('../bundledGit', () => ({
  getBundledGitPath: vi.fn(() => null)
}))

const BUNDLED_GIT = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd\\git.exe'
const UNICODE_BUNDLED_GIT =
  'D:\\常用软件\\Cherry Studio\\resources\\app.asar.unpacked\\resources\\binaries\\win32-x64\\git\\cmd\\git.exe'
const MISE_SHIM = 'C:\\mise\\shims\\git.cmd'
const SYSTEM_GIT = 'C:\\Git\\cmd\\git.exe'
const originalProgramFiles = process.env.ProgramFiles

function mockWhichCandidates(candidates: string[]) {
  vi.mocked(which).mockImplementation(async (command) => (command === 'git' ? candidates : null) as never)
  vi.mocked(which.sync).mockImplementation((command) => (command === 'git' ? candidates : null) as never)
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
    vi.mocked(path.win32.resolve).mockImplementation((...args) => args[args.length - 1])
    vi.mocked(path.win32.extname).mockImplementation((p) => p.match(/\.[^\\/.]+$/)?.[0] ?? '')
    vi.mocked(path.win32.relative).mockImplementation((from, to) => {
      const lowerFrom = from.toLowerCase()
      const lowerTo = to.toLowerCase()
      return lowerTo.startsWith(`${lowerFrom}\\`) ? to.slice(from.length + 1) : to
    })
    vi.mocked(path.win32.isAbsolute).mockImplementation((p) => /^[A-Z]:/i.test(p))
    Object.defineProperty(path.win32, 'sep', { value: '\\', writable: true })
    vi.spyOn(process, 'cwd').mockReturnValue('C:\\cwd')
    vi.mocked(getShellEnv).mockResolvedValue({ Path: 'C:\\Windows;C:\\mise\\shims;C:\\Cherry\\git\\cmd' })
    vi.mocked(which).mockReset()
    vi.mocked(which.sync).mockReset()

    // No git at the common install roots and no PATH hits by default.
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

  it('resolves the mise .cmd shim ahead of the bundled git when both are available', async () => {
    // Regression (PR #16402 review A1): with the bundled dir on the PATH tail,
    // command lookup yields the shim first and the bundled .exe last; the
    // .exe-only filter used to grab the bundled path and short-circuit mise.
    mockWhichCandidates([MISE_SHIM, BUNDLED_GIT])

    await expect(findExecutableInEnv('git')).resolves.toBe(MISE_SHIM)
  })

  it('prefers system git on PATH over the bundled git', async () => {
    mockWhichCandidates([SYSTEM_GIT, BUNDLED_GIT])

    await expect(findExecutableInEnv('git')).resolves.toBe(SYSTEM_GIT)
  })

  it('prefers git at a common install root over the bundled git', async () => {
    // PATH only surfaces the bundled .exe, but Program Files has a real git.
    mockWhichCandidates([BUNDLED_GIT])
    process.env.ProgramFiles = 'C:\\Program Files'
    const commonGit = 'C:\\Program Files\\Git\\cmd\\git.exe'
    vi.mocked(fs.existsSync).mockImplementation((p) => p === commonGit)

    await expect(findExecutableInEnv('git')).resolves.toBe(commonGit)
  })

  it('preserves a mise shim ahead of a Git installation outside PATH', async () => {
    mockWhichCandidates([MISE_SHIM])
    process.env.ProgramFiles = 'C:\\Program Files'
    const commonGit = 'C:\\Program Files\\Git\\cmd\\git.exe'
    vi.mocked(fs.existsSync).mockImplementation((p) => p === commonGit)

    await expect(findExecutableInEnv('git')).resolves.toBe(MISE_SHIM)
  })

  it('falls back to the bundled git only when every other lookup misses', async () => {
    mockWhichCandidates([BUNDLED_GIT])

    await expect(findExecutableInEnv('git')).resolves.toBe(BUNDLED_GIT)
  })

  it('uses the original bundled git path when Cherry Studio is installed under a Unicode directory', async () => {
    const bundledGitDir = path.dirname(UNICODE_BUNDLED_GIT)
    const shellEnv = { Path: `C:\\Windows;${bundledGitDir}` }
    vi.mocked(getShellEnv).mockResolvedValue(shellEnv)
    vi.mocked(getBundledGitPath).mockReturnValue(UNICODE_BUNDLED_GIT)
    mockWhichCandidates([UNICODE_BUNDLED_GIT])

    await expect(findExecutableInEnv('git')).resolves.toBe(UNICODE_BUNDLED_GIT)
    expect(which).toHaveBeenCalledWith('git', expect.objectContaining({ path: shellEnv.Path }))
    expect(which.sync).toHaveBeenCalledWith('git', expect.objectContaining({ path: shellEnv.Path }))
  })

  it('returns null for git when nothing is found and no bundle is present', async () => {
    vi.mocked(getBundledGitPath).mockReturnValue(null)
    mockWhichCandidates([])

    await expect(findExecutableInEnv('git')).resolves.toBeNull()
  })
})
