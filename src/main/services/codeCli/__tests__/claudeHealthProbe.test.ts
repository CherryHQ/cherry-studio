import { spawn } from 'child_process'
import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { classifyClaudeStartupError, describeClaudeStartupFailure, probeClaudeExecutable } from '../claudeHealthProbe'

vi.mock('child_process', () => ({ spawn: vi.fn() }))

const shellEnvMock = vi.hoisted(() => ({ getRawShellEnv: vi.fn(), terminateProcessTree: vi.fn() }))
vi.mock('@main/utils/processRunner', () => ({ terminateProcessTree: shellEnvMock.terminateProcessTree }))

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: shellEnvMock.getRawShellEnv }))

const executionMock = vi.fn()
const execFileMock = vi.mocked(spawn)
execFileMock.mockImplementation((...args: any[]) => {
  const execution = executionMock(...args)
  const child = Object.assign(new EventEmitter(), { pid: 1234, stdout: new EventEmitter(), stderr: new EventEmitter() })
  if (execution?.then)
    execution.then(
      (result: any) => {
        child.stdout.emit('data', Buffer.from(result.stdout))
        child.stderr.emit('data', Buffer.from(result.stderr))
        child.emit('close', 0, null)
      },
      (error: any) => {
        child.emit('error', error)
      }
    )
  return child as any
})
const loginShellEnv = { PATH: '/login/shell/bin:/usr/bin' }

describe('classifyClaudeStartupError', () => {
  it('treats a signal termination as a startup crash', () => {
    expect(classifyClaudeStartupError(Object.assign(new Error('boom'), { signal: 'SIGSEGV' })).reason).toBe(
      'startup-crash'
    )
  })

  it('treats crash markers in stderr as a startup crash even without a signal', () => {
    const error = Object.assign(new Error('command failed'), { stderr: 'Segmentation fault (Bun 1.4.0)' })
    expect(classifyClaudeStartupError(error).reason).toBe('startup-crash')
  })

  it('treats a Windows NTSTATUS exit code as a startup crash with empty output', () => {
    const error = Object.assign(new Error('Command failed with exit code 3221225477'), {
      code: 3221225477,
      signal: null,
      stdout: '',
      stderr: ''
    })
    expect(classifyClaudeStartupError(error).reason).toBe('startup-crash')
  })

  it('keeps an ordinary non-zero exit distinct from a crash', () => {
    const error = Object.assign(new Error('Command failed with exit code 1'), { code: 1 })
    expect(classifyClaudeStartupError(error).reason).toBe('exit')
  })

  it('keeps an auth-shaped failure distinct from a crash', () => {
    const error = Object.assign(new Error('Not logged in, run /login'), { code: 1 })
    expect(classifyClaudeStartupError(error).reason).toBe('exit')
  })

  it('ignores crash tokens that only appear in the install path', () => {
    const error = Object.assign(new Error('Command failed: C:\\tools\\panic-adapter\\claude.exe --version'), {
      code: 1,
      stdout: '',
      stderr: 'Not logged in'
    })
    expect(classifyClaudeStartupError(error).reason).toBe('exit')
  })

  it('ignores a mere Bun runtime mention in the output', () => {
    const error = Object.assign(new Error('command failed'), {
      code: 1,
      stderr: 'Update available (built with bun 1.4.0)'
    })
    expect(classifyClaudeStartupError(error).reason).toBe('exit')
  })

  it('ignores timeout wording when the process was never killed', () => {
    const error = Object.assign(new Error('Command failed'), {
      code: 1,
      killed: false,
      stderr: 'network timeout, run /login'
    })
    expect(classifyClaudeStartupError(error).reason).toBe('exit')
  })

  it('classifies a missing binary as a spawn failure', () => {
    expect(classifyClaudeStartupError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })).reason).toBe(
      'spawn'
    )
  })

  it('classifies a non-executable binary as a spawn failure', () => {
    expect(classifyClaudeStartupError(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })).reason).toBe(
      'spawn'
    )
  })

  it('classifies a hung binary as a timeout', () => {
    const error = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })
    expect(classifyClaudeStartupError(error).reason).toBe('timeout')
  })
})

describe('describeClaudeStartupFailure', () => {
  it('names the binary and offers the managed-binary recovery path', () => {
    const message = describeClaudeStartupFailure('C:\\Tools\\claude.exe', {
      reason: 'startup-crash',
      detail: 'Segmentation fault'
    })
    expect(message).toContain('C:\\Tools\\claude.exe')
    expect(message).toContain('crashed during startup')
    expect(message).toContain('managed Claude binary')
  })

  it('truncates an unbounded failure detail', () => {
    const message = describeClaudeStartupFailure('C:\\Tools\\claude.exe', {
      reason: 'exit',
      detail: 'x'.repeat(2000)
    })
    expect(message.length).toBeLessThan(2000)
    expect(message).toContain('managed Claude binary')
  })
})

describe('probeClaudeExecutable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shellEnvMock.getRawShellEnv.mockResolvedValue(loginShellEnv)
  })

  it('returns ok with a bounded hidden probe when the binary answers', async () => {
    executionMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\Tools\\claude.exe')).resolves.toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith('C:\\Tools\\claude.exe', ['--version'], {
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: loginShellEnv
    })
  })

  it('probes with the login-shell env that discovery and the terminal launch use', async () => {
    executionMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await probeClaudeExecutable('C:\\Tools\\claude.exe')
    expect(shellEnvMock.getRawShellEnv).toHaveBeenCalledOnce()
    expect(execFileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ env: loginShellEnv })
    )
  })

  it('runs .cmd shims through a shell', async () => {
    executionMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\Tools\\claude.cmd')).resolves.toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith(
      '"C:\\Tools\\claude.cmd"',
      ['--version'],
      expect.objectContaining({ shell: true, env: loginShellEnv })
    )
  })

  it('quotes a spaced .cmd shim path so the shell probe still resolves it', async () => {
    executionMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\My Tools\\claude.cmd')).resolves.toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith(
      '"C:\\My Tools\\claude.cmd"',
      ['--version'],
      expect.objectContaining({ shell: true })
    )
  })

  it('probes in the launch directory so a project-scoped shim resolves', async () => {
    executionMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\Tools\\claude.exe', 'C:\\Users\\me\\proj')).resolves.toEqual({
      ok: true
    })
    expect(execFileMock).toHaveBeenCalledWith(
      'C:\\Tools\\claude.exe',
      ['--version'],
      expect.objectContaining({ cwd: 'C:\\Users\\me\\proj' })
    )
  })

  it('doubles percent signs in a .cmd shim path on Windows so cmd.exe keeps them literal', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      executionMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
      await expect(probeClaudeExecutable('C:\\100% Tools\\claude.cmd')).resolves.toEqual({ ok: true })
      expect(execFileMock).toHaveBeenCalledWith(
        '"C:\\100%% Tools\\claude.cmd"',
        ['--version'],
        expect.objectContaining({ shell: true })
      )
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('owns a detached probe and awaits forced tree termination before reporting timeout', async () => {
    vi.useFakeTimers()
    try {
      const child = { pid: 1234 }
      let finishTermination!: () => void
      shellEnvMock.terminateProcessTree.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishTermination = resolve
        })
      )
      executionMock.mockReturnValueOnce(new Promise(() => {}))
      let settled = false
      const result = probeClaudeExecutable('/fixture/claude.cmd').then((value) => {
        settled = true
        return value
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(shellEnvMock.terminateProcessTree).toHaveBeenCalledWith(
        expect.objectContaining(child),
        true,
        'Claude Code startup probe'
      )
      expect(settled).toBe(false)
      finishTermination()
      await expect(result).resolves.toEqual({ ok: false, failure: expect.objectContaining({ reason: 'timeout' }) })
      expect(execFileMock).toHaveBeenCalledWith(
        expect.anything(),
        ['--version'],
        expect.objectContaining({ detached: process.platform !== 'win32' })
      )
      expect(execFileMock.mock.calls.at(-1)?.[2]).not.toHaveProperty('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['resolve', 'reject'])('bounds a hung cleanup and handles its late %s', async (late) => {
    vi.useFakeTimers()
    try {
      let resolveCleanup!: () => void
      let rejectCleanup!: (error: Error) => void
      executionMock.mockReturnValueOnce(new Promise(() => {}))
      shellEnvMock.terminateProcessTree.mockReturnValueOnce(
        new Promise<void>((resolve, reject) => {
          resolveCleanup = resolve
          rejectCleanup = reject
        })
      )
      let settled = false
      const result = probeClaudeExecutable('/fixture/claude.cmd').then((value) => {
        settled = true
        return value
      })
      await vi.advanceTimersByTimeAsync(11_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toMatchObject({
        ok: false,
        failure: { reason: 'timeout', detail: expect.stringContaining('descendants may still be running') }
      })
      if (late === 'resolve') resolveCleanup()
      else rejectCleanup(new Error('late cleanup failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports forced cleanup failure rather than claiming the tree stopped', async () => {
    vi.useFakeTimers()
    try {
      executionMock.mockReturnValueOnce(new Promise(() => {}))
      shellEnvMock.terminateProcessTree.mockRejectedValueOnce(new Error('taskkill denied'))
      const result = probeClaudeExecutable('/fixture/claude.cmd')
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(result).resolves.toMatchObject({
        ok: false,
        failure: {
          reason: 'timeout',
          detail: expect.stringContaining('process cleanup failed: Error: taskkill denied')
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('terminates the owned tree when output exceeds the bounded probe budget', async () => {
    executionMock.mockResolvedValueOnce({ stdout: 'x'.repeat(1024 * 1024 + 1), stderr: '' })
    shellEnvMock.terminateProcessTree.mockResolvedValueOnce(undefined)
    await expect(probeClaudeExecutable('/fixture/claude')).resolves.toMatchObject({
      ok: false,
      failure: { reason: 'exit', detail: expect.stringContaining('output limit') }
    })
    expect(shellEnvMock.terminateProcessTree).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 1234 }),
      true,
      'Claude Code startup probe'
    )
  })

  it('maps a hung binary to a timeout failure', async () => {
    executionMock.mockRejectedValueOnce(Object.assign(new Error('Command failed'), { killed: true }))
    const result = await probeClaudeExecutable('C:\\Tools\\claude.exe')
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ reason: 'timeout' }) })
  })
})

it('returns an actionable failure when login-shell environment discovery rejects', async () => {
  shellEnvMock.getRawShellEnv.mockRejectedValueOnce(new Error('login shell unavailable'))
  execFileMock.mockClear()
  const result = await probeClaudeExecutable('/custom/bin/claude')
  expect(result).toEqual({ ok: false, failure: { reason: 'exit', detail: 'login shell unavailable' } })
  expect(execFileMock).not.toHaveBeenCalled()
  if (result.ok) throw new Error('Expected an environment discovery failure')
  expect(describeClaudeStartupFailure('/custom/bin/claude', result.failure)).toContain('/custom/bin/claude')
  expect(describeClaudeStartupFailure('/custom/bin/claude', result.failure)).toContain('login shell unavailable')
  expect(describeClaudeStartupFailure('/custom/bin/claude', result.failure)).toContain('managed Claude binary')
})
