import type * as UtilModule from 'node:util'

import { execFile, execFileSync, spawn } from 'child_process'
import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import which from 'which'

const asyncExec = vi.hoisted(() => vi.fn())
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilModule>()
  return { ...actual, promisify: (fn: typeof execFile) => (fn === execFile ? asyncExec : actual.promisify(fn)) }
})

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
    asyncExec.mockReset()
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
      pathExt: '.exe;.cmd'
    })
  })

  it('prefers an executable when PATH contains both .cmd and .exe candidates', async () => {
    vi.mocked(which).mockResolvedValue(['C:\\Tools\\tool.cmd', 'C:\\Tools\\tool.exe'] as never)

    const result = findCommandInShellEnv('tool', { PATH: 'C:\\Tools' })

    await expect(result).resolves.toBe('C:\\Tools\\tool.exe')
  })

  it('reports a query failure when PATH lookup exceeds the command timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(which).mockReturnValue(new Promise<never>(() => {}))
    const pending = findCommandInShellEnv('npx', { PATH: '\\\\offline-server\\tools' })
    const rejected = expect(pending).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
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
      pathExt: '.bat'
    })
  })

  it('finds mise at a Unicode path through bounded asynchronous PATH lookup', async () => {
    const misePath = 'D:\\开发工具\\mise\\mise.exe'
    const nodePath = 'D:\\开发工具\\mise\\installs\\node\\node.exe'
    vi.mocked(which).mockResolvedValue([misePath] as never)
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === nodePath)
    asyncExec.mockImplementation(async (command, args) => {
      if (command === misePath && (args as string[])[0] === 'which') {
        return { stdout: nodePath, stderr: '' }
      }
      throw new Error('unexpected command')
    })

    const result = await findViaMise('node', { Path: 'D:\\开发工具\\mise' })

    expect(result).toBe(nodePath)
    expect(asyncExec).toHaveBeenCalledTimes(1)
    expect(which.sync).not.toHaveBeenCalled()
  })
})

describe('Windows mise lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(which).mockResolvedValue(['C:\\tools\\mise.exe'] as never)
  })
  it('uses the asynchronous child API and preserves the lookup environment', async () => {
    asyncExec.mockImplementation(async (_file, _args, options) => {
      expect(options.env).toEqual({ PATH: 'C:\\tools' })
      return { stdout: 'C:\\tools\\node.exe\n', stderr: '' }
    })
    await expect(findViaMise('node', { PATH: 'C:\\tools' })).resolves.toBe('C:\\tools\\node.exe')
    expect(fs.existsSync).toHaveBeenCalledWith('C:\\tools\\node.exe')
  })

  it('propagates cancellation into the pending mise process', async () => {
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    asyncExec.mockImplementation((_file, _args, options) => {
      const result = new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      )
      started()
      return result
    })
    const pending = findViaMise('node', { PATH: 'C:\\tools' }, controller.signal)
    await ready
    const rejected = expect(pending).rejects.toThrow()
    controller.abort()
    await rejected
  })
})
