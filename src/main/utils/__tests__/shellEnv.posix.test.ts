import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/platform', () => ({
  isWin: false,
  isMac: true,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('child_process')

vi.mock('../bundledGit', () => ({
  getBundledGitPath: vi.fn(() => null),
  getBundledGitDir: vi.fn(() => null)
}))

// Import AFTER mocks are registered so the module binds to mocked values.
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { getShellEnv, refreshShellEnv } from '../shellEnv'

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn()
  })
}

function mockSpawnOnce(impl: (child: ReturnType<typeof fakeChild>) => void): void {
  vi.mocked(spawn).mockImplementationOnce((() => {
    const child = fakeChild()
    impl(child)
    return child
  }) as unknown as typeof spawn)
}

/** Queue a login shell that prints `pathValue` and exits on its own. */
function mockLoginShell(pathValue: string): void {
  mockSpawnOnce((child) => {
    queueMicrotask(() => {
      child.stdout.emit('data', `HOME=/home/test\nPATH=${pathValue}\n`)
      child.emit('close', 0)
    })
  })
}

/** Queue a login shell that hangs until the returned `settle` is called. */
function mockPendingLoginShell(pathValue: string): { settle: () => void } {
  let emit = () => {}
  mockSpawnOnce((child) => {
    emit = () => {
      child.stdout.emit('data', `HOME=/home/test\nPATH=${pathValue}\n`)
      child.emit('close', 0)
    }
  })
  return { settle: () => emit() }
}

/** Make every following login shell fail to start. */
function mockFailingLoginShell(): void {
  vi.mocked(spawn).mockImplementation((() => {
    const child = fakeChild()
    queueMicrotask(() => child.emit('error', new Error('shell unavailable')))
    return child
  }) as unknown as typeof spawn)
}

/** Let queued promise callbacks run without advancing wall-clock time. */
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('shellEnv – POSIX capture cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps queued mockImplementationOnce entries — an unconsumed
    // one would leak into the next test and be served as its first spawn.
    vi.mocked(spawn).mockReset()
    MockMainCacheServiceUtils.resetMocks()
    vi.useFakeTimers()
    process.env.SHELL = '/bin/zsh'
    process.env.HOME = '/home/test'
    // Distinct from every captured PATH, so a degraded fallback is recognizable.
    process.env.PATH = '/degraded/fallback'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves the captured env within the TTL without re-spawning', async () => {
    mockLoginShell('/usr/bin')
    expect((await getShellEnv()).PATH).toContain('/usr/bin')

    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    expect((await getShellEnv()).PATH).not.toContain('/opt/ffmpeg/bin')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('serves the last good capture while re-resolving in the background once it expires', async () => {
    mockLoginShell('/usr/bin')
    await getShellEnv()

    // User installs a tool; the capture expires while the login shell is slow.
    vi.advanceTimersByTime(60_001)
    const slowShell = mockPendingLoginShell('/usr/bin:/opt/ffmpeg/bin')

    // The expired read must not wait on the pending shell.
    const served = await getShellEnv()
    expect(served.PATH).toContain('/usr/bin')
    expect(spawn).toHaveBeenCalledTimes(2)

    slowShell.settle()
    await flush()
    expect((await getShellEnv()).PATH).toContain('/opt/ffmpeg/bin')
  })

  it('keeps the last good capture when a re-capture fails', async () => {
    mockLoginShell('/usr/bin')
    await getShellEnv()

    vi.advanceTimersByTime(60_001)
    mockFailingLoginShell()
    await getShellEnv()
    await flush()

    // A failed capture must not downgrade a working env to bare process.env.
    const env = await getShellEnv()
    expect(env.PATH).toContain('/usr/bin')
    expect(env.PATH).not.toContain('/degraded/fallback')
  })

  it('does not adopt an in-flight capture that started before an explicit refresh', async () => {
    // A read starts a capture, then the user installs a tool while it is running.
    const preInstall = mockPendingLoginShell('/usr/bin')
    const reader = getShellEnv()

    // BinaryManager refreshes after the install; it must observe the new PATH.
    const refresh = refreshShellEnv()
    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    preInstall.settle()

    expect((await reader).PATH).not.toContain('/opt/ffmpeg/bin')
    expect((await refresh).PATH).toContain('/opt/ffmpeg/bin')

    // The superseded capture must not publish over the refreshed one.
    expect((await getShellEnv()).PATH).toContain('/opt/ffmpeg/bin')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('never publishes a capture that an explicit refresh superseded', async () => {
    const preInstall = mockPendingLoginShell('/usr/bin')
    const reader = getShellEnv()

    const refresh = refreshShellEnv()
    // The replacement capture stays pending, so nothing can publish after the
    // superseded one — any cached value would have to be its stale result.
    mockPendingLoginShell('/usr/bin:/opt/ffmpeg/bin')
    preInstall.settle()
    await reader
    await flush()

    expect(MockMainCacheServiceUtils.getCacheValue('system.shell_env')).toBeUndefined()
    expect(MockMainCacheServiceUtils.getCacheValue('system.shell_env.last_good')).toBeUndefined()
    void refresh.catch(() => {})
  })
})
