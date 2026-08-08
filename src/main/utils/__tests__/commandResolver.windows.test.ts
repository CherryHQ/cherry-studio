import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import which from 'which'

vi.mock('child_process')
vi.mock('fs')
vi.mock('which')
vi.mock('@main/core/platform', () => ({ isWin: true }))

const { findCommandInShellEnv, findExecutable, findViaMise } = await import('../commandResolver')

describe('findCommandInShellEnv on Windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(which).mockReset()
    vi.mocked(which.sync).mockReset()
    vi.mocked(execFileSync).mockReset()
    vi.mocked(fs.existsSync).mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves the npx.cmd launcher installed by Node.js', async () => {
    const expected = 'C:\\Program Files\\nodejs\\npx.cmd'
    vi.mocked(which).mockResolvedValue([expected] as never)

    const result = findCommandInShellEnv('npx', { PATH: 'C:\\Program Files\\nodejs' })

    await expect(result).resolves.toBe(expected)
  })

  it('returns a Unicode npx.cmd path directly from PATH lookup', async () => {
    const expected = 'D:\\开发工具\\nodejs\\npx.cmd'
    vi.mocked(which).mockResolvedValue([expected] as never)

    const result = findCommandInShellEnv('npx', { Path: 'D:\\开发工具\\nodejs' })

    await expect(result).resolves.toBe(expected)
    expect(spawn).not.toHaveBeenCalled()
    expect(which).toHaveBeenCalledWith('npx', {
      all: true,
      delimiter: ';',
      nothrow: true,
      path: 'D:\\开发工具\\nodejs',
      pathExt: '.EXE;.CMD'
    })
  })

  it('prefers an executable when PATH contains both .cmd and .exe candidates', async () => {
    vi.mocked(which).mockResolvedValue(['C:\\Tools\\tool.cmd', 'C:\\Tools\\tool.exe'] as never)

    const result = findCommandInShellEnv('tool', { PATH: 'C:\\Tools' })

    await expect(result).resolves.toBe('C:\\Tools\\tool.exe')
  })

  it('returns null when PATH lookup exceeds the command timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(which).mockReturnValue(new Promise<never>(() => {}))
    const settled = vi.fn()

    void findCommandInShellEnv('npx', { PATH: '\\\\offline-server\\tools' }).then(settled)
    await vi.advanceTimersByTimeAsync(5000)

    expect(settled).toHaveBeenCalledWith(null)
  })

  it('finds a Unicode executable synchronously through PATH lookup', () => {
    const expected = 'D:\\开发工具\\nodejs\\node.exe'
    vi.mocked(which.sync).mockReturnValue([expected] as never)

    const result = findExecutable('node', { env: { Path: 'D:\\开发工具\\nodejs' } })

    expect(result).toBe(expected)
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('skips executables in the current directory and its descendants', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('C:\\workspace')
    vi.mocked(which.sync).mockReturnValue([
      'C:\\workspace\\node.exe',
      'C:\\workspace\\tools\\node.exe',
      'D:\\Node.js\\node.exe'
    ] as never)

    const result = findExecutable('node', { env: { Path: 'C:\\workspace;D:\\Node.js' } })

    expect(result).toBe('D:\\Node.js\\node.exe')
  })

  it('enforces a caller-supplied executable extension allowlist', () => {
    const expected = 'D:\\Tools\\runner.bat'
    vi.mocked(which.sync).mockReturnValue(['D:\\Tools\\runner.ps1', expected] as never)

    const result = findExecutable('runner', { env: { PATH: 'D:\\Tools' }, extensions: ['.bat'] })

    expect(result).toBe(expected)
    expect(which.sync).toHaveBeenCalledWith('runner', {
      all: true,
      delimiter: ';',
      nothrow: true,
      path: 'D:\\Tools',
      pathExt: '.BAT'
    })
  })

  it('finds mise at a Unicode path through bounded asynchronous PATH lookup', async () => {
    const misePath = 'D:\\开发工具\\mise\\mise.exe'
    const nodePath = 'D:\\开发工具\\mise\\installs\\node\\node.exe'
    vi.mocked(which).mockResolvedValue([misePath] as never)
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === nodePath)
    vi.mocked(execFileSync).mockImplementation((command, args) => {
      if (command === misePath && (args as string[])[0] === 'which') {
        return nodePath
      }
      throw new Error('unexpected command')
    })

    const result = await findViaMise('node', { Path: 'D:\\开发工具\\mise' })

    expect(result).toBe(nodePath)
    expect(execFileSync).toHaveBeenCalledTimes(1)
    expect(which.sync).not.toHaveBeenCalled()
  })
})
