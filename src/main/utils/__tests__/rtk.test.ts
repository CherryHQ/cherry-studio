import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BinaryManager } from '@main/services/binaryManager/BinaryManager'
import type * as ProcessRunnerModule from '@main/utils/processRunner'

type Resolution = Awaited<ReturnType<BinaryManager['resolveToolExecution']>>
const platformRef = vi.hoisted(() => ({ isWin: false }))
const binaryManagerMock = vi.hoisted(() => ({ resolveToolExecution: vi.fn() }))
const executeCommandMock = vi.hoisted(() => vi.fn())
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Keep the real module (CommandFailedError) and override only executeCommand
vi.mock('@main/utils/processRunner', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessRunnerModule>()),
  executeCommand: executeCommandMock
}))

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/home/testuser'
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platformRef.isWin
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  mock.application.get.mockImplementation(() => binaryManagerMock)
  return mock
})

import { CommandFailedError } from '@main/utils/processRunner'

import { rtkRewrite } from '../rtk'

const rawEnv = { PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' }
const available = (overrides: Partial<Extract<Resolution, { status: 'available' }>> = {}): Resolution => ({
  status: 'available',
  source: 'system',
  path: '/usr/local/bin/rtk',
  resolvedPath: '/usr/local/bin/rtk',
  env: rawEnv,
  ...overrides
})
const failed = (phase: 'mise_which' | 'system_env'): Resolution => ({
  status: 'failed',
  phase,
  reason: 'timeout',
  elapsedMs: 8_000,
  stepElapsedMs: 8_000,
  stepBudgetMs: 8_000,
  message: 'Tool execution resolution timeout'
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('rtk utils', () => {
  let now = 0
  beforeEach(() => {
    vi.clearAllMocks()
    platformRef.isWin = false
    now += 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    binaryManagerMock.resolveToolExecution.mockReset().mockResolvedValue({ status: 'unavailable' })
    executeCommandMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const advance = async (ms: number) => {
    now += ms
    await vi.advanceTimersByTimeAsync(ms)
  }
  const enable = () => {
    binaryManagerMock.resolveToolExecution.mockResolvedValue(available())
    executeCommandMock.mockImplementation(async (_path: string, args: string[]) =>
      args[0] === '--version' ? 'rtk 0.44.2' : `rewritten:${args[1]}`
    )
  }

  it('returns null when all sources are unavailable', async () => {
    await expect(rtkRewrite('ls')).resolves.toBeNull()
    expect(executeCommandMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins'
    )
  })

  it('treats unexpected resolution rejection as transient', async () => {
    binaryManagerMock.resolveToolExecution.mockRejectedValueOnce(new Error('private stderr'))
    await expect(rtkRewrite('ls')).resolves.toBeNull()
    expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain('private stderr')
    now += 15_000
    enable()
    await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
  })

  it.each(['mise_which', 'system_env'] as const)(
    'attributes %s timeout within the resolution budget and honors the short TTL',
    async (phase) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const gate = deferred<Resolution>()
      binaryManagerMock.resolveToolExecution.mockReturnValueOnce(gate.promise)
      const pending = rtkRewrite('ls')
      setTimeout(() => gate.resolve(failed(phase)), 8_000)
      await advance(8_000)
      await expect(pending).resolves.toBeNull()
      expect(loggerMock.warn).toHaveBeenCalledExactlyOnceWith(
        `rtk probe failed at ${phase}`,
        expect.objectContaining({
          tool: 'rtk',
          phase,
          reason: 'timeout',
          budgetMs: 10_000,
          transient: true
        })
      )
      expect(executeCommandMock).not.toHaveBeenCalled()
      enable()
      await advance(14_999)
      await expect(rtkRewrite('ls')).resolves.toBeNull()
      expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledTimes(1)
      await advance(1)
      await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
      expect(executeCommandMock.mock.calls.every(([candidate]) => candidate === '/usr/local/bin/rtk')).toBe(true)
    }
  )

  it('rewrites with a resolved rtk despite unrelated slow tools', async () => {
    enable()
    await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
    expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledExactlyOnceWith('rtk', {
      signal: expect.any(AbortSignal),
      deadline: now + 10_000
    })
    expect(executeCommandMock.mock.calls.map(([, args]) => args)).toEqual([['--version'], ['rewrite', 'ls']])
  })

  it.each(['', 'garbage', 'rtk 0.23', 'rtk 0.22.9', 'rtk 0.23.0-beta.1'])(
    'rejects version output %j and caches the definitive failure for 60 seconds',
    async (stdout) => {
      enable()
      executeCommandMock.mockResolvedValueOnce(stdout)
      await expect(rtkRewrite('ls')).resolves.toBeNull()
      expect(loggerMock.warn).toHaveBeenCalledWith(
        'rtk probe failed at version',
        expect.objectContaining({
          phase: 'version',
          reason: stdout.includes('0.22') || stdout.includes('beta') ? 'unsupported_version' : 'malformed_version',
          budgetMs: 10_000,
          transient: false
        })
      )
      expect(executeCommandMock).toHaveBeenCalledTimes(1)
      now += 59_999
      await expect(rtkRewrite('ls')).resolves.toBeNull()
      expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledTimes(1)
      now += 1
      await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
    }
  )

  it.each(['rtk 0.23.0', 'rtk 0.23.0+build.1', 'rtk 1.0.0-beta.1'])(
    'accepts a complete qualified semver %s',
    async (stdout) => {
      enable()
      executeCommandMock.mockResolvedValueOnce(stdout)
      await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
    }
  )

  it.each([
    ['/bin/rtk.exe', '/bin/rtk.CMD'],
    ['/bin/rtk.BAT', '/bin/rtk.exe'],
    ['C:\\tools\\rtk.CMD', 'C:\\tools\\rtk.exe'],
    ['/bin/rtk.exe', '/bin/rtk.bat']
  ])('rejects batch wrappers in either path: %s / %s', async (candidate, resolvedPath) => {
    platformRef.isWin = candidate.startsWith('C:')
    binaryManagerMock.resolveToolExecution.mockResolvedValue(available({ path: candidate, resolvedPath }))
    await expect(rtkRewrite('ls')).resolves.toBeNull()
    expect(executeCommandMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'rtk probe failed at version',
      expect.objectContaining({ reason: 'batch_wrapper' })
    )
    now += 59_999
    await expect(rtkRewrite('ls')).resolves.toBeNull()
    expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledTimes(1)
  })

  it.each(['system', 'mise'] as const)('uses the resolved %s environment for version and rewrite', async (source) => {
    enable()
    const env = source === 'system' ? rawEnv : { HOME: '/real/home', MISE_DATA_DIR: '/cherry/mise' }
    binaryManagerMock.resolveToolExecution.mockResolvedValue(available({ source, env }))
    await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
    for (const call of executeCommandMock.mock.calls)
      expect(call[2]).toEqual(expect.objectContaining({ env, timeout: 10_000 }))
  })

  it('shares one atomic probe across concurrent rewrites and starts the TTL at completion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    enable()
    const gate = deferred<string>()
    executeCommandMock.mockImplementationOnce(() => gate.promise)
    const first = rtkRewrite('first')
    const second = rtkRewrite('second')
    await advance(5_000)
    gate.resolve('rtk 0.30.1')
    await expect(Promise.all([first, second])).resolves.toEqual(['rewritten:first', 'rewritten:second'])
    await advance(59_999)
    await expect(rtkRewrite('third')).resolves.toBe('rewritten:third')
    expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledTimes(1)
    await advance(1)
    await expect(rtkRewrite('fourth')).resolves.toBe('rewritten:fourth')
    expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledTimes(2)
  })

  it('caches absence until the full TTL expires', async () => {
    await expect(rtkRewrite('ls')).resolves.toBeNull()
    enable()
    now += 59_999
    await expect(rtkRewrite('ls')).resolves.toBeNull()
    now += 1
    await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
  })

  it.each(['resolution', 'version', 'version timeout'])(
    'invalidates an available cache after %s failure and retries after 15 seconds',
    async (failure) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      enable()
      await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
      await advance(60_000)
      if (failure === 'resolution') binaryManagerMock.resolveToolExecution.mockResolvedValueOnce(failed('mise_which'))
      else if (failure === 'version') executeCommandMock.mockRejectedValueOnce(new Error('private version error'))
      else
        executeCommandMock.mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('timeout')), 10_000)
            })
        )
      const pending = rtkRewrite('ls')
      await advance(10_000)
      await expect(pending).resolves.toBeNull()
      await advance(14_999)
      await expect(rtkRewrite('ls')).resolves.toBeNull()
      expect(binaryManagerMock.resolveToolExecution).toHaveBeenCalledTimes(2)
      await advance(1)
      await expect(rtkRewrite('ls')).resolves.toBe('rewritten:ls')
    }
  )

  it.each(['', 'ls'])('returns null for unusable rewrite output %j', async (stdout) => {
    enable()
    executeCommandMock.mockResolvedValueOnce('rtk 0.30.1').mockResolvedValueOnce(stdout)
    await expect(rtkRewrite('ls')).resolves.toBeNull()
  })

  it.each([
    { code: 3, stdout: 'rtk ls\n', expected: 'rtk ls', warn: true },
    { code: 3, stdout: '  \n', expected: null, warn: false },
    { code: 3, stdout: 'ls', expected: null, warn: false },
    { code: 1, stdout: '', expected: null, warn: false },
    { code: 2, stdout: '', expected: null, warn: true }
  ])('handles rewrite exit $code with output $stdout', async ({ code, stdout, expected, warn }) => {
    enable()
    executeCommandMock
      .mockResolvedValueOnce('rtk 0.51.0')
      .mockRejectedValueOnce(new CommandFailedError(code, stdout, ''))
    await expect(rtkRewrite('ls')).resolves.toBe(expected)
    expect(loggerMock.warn.mock.calls.length > 0).toBe(warn)
  })
})
