import { execFile } from 'child_process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { classifyClaudeStartupError, describeClaudeStartupFailure, probeClaudeExecutable } from '../claudeHealthProbe'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('util', () => ({ promisify: (fn: unknown) => fn }))

const shellEnvMock = vi.hoisted(() => ({ getRawShellEnv: vi.fn() }))

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: shellEnvMock.getRawShellEnv }))

const execFileMock = vi.mocked(execFile as unknown as (...args: never[]) => Promise<{ stdout: string; stderr: string }>)
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
    execFileMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\Tools\\claude.exe')).resolves.toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith('C:\\Tools\\claude.exe', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
      killSignal: 'SIGKILL',
      shell: false,
      env: loginShellEnv
    })
  })

  it('probes with the login-shell env that discovery and the terminal launch use', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await probeClaudeExecutable('C:\\Tools\\claude.exe')
    expect(shellEnvMock.getRawShellEnv).toHaveBeenCalledOnce()
    expect(execFileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ env: loginShellEnv })
    )
  })

  it('runs .cmd shims through a shell', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\Tools\\claude.cmd')).resolves.toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith(
      '"C:\\Tools\\claude.cmd"',
      ['--version'],
      expect.objectContaining({ shell: true, env: loginShellEnv })
    )
  })

  it('quotes a spaced .cmd shim path so the shell probe still resolves it', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' })
    await expect(probeClaudeExecutable('C:\\My Tools\\claude.cmd')).resolves.toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith(
      '"C:\\My Tools\\claude.cmd"',
      ['--version'],
      expect.objectContaining({ shell: true })
    )
  })

  it('maps a hung binary to a timeout failure', async () => {
    execFileMock.mockRejectedValueOnce(Object.assign(new Error('Command failed'), { killed: true }))
    const result = await probeClaudeExecutable('C:\\Tools\\claude.exe')
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ reason: 'timeout' }) })
  })
})
