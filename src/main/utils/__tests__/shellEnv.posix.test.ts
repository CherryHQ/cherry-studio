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

/** Mirrors SHELL_ENV_TTL_MS — the backstop for passive reads. */
const TTL_MS = 5 * 60_000

describe('shellEnv – POSIX capture cache', () => {
  const savedEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps queued mockImplementationOnce entries — an unconsumed
    // one would leak into the next test and be served as its first spawn.
    vi.mocked(spawn).mockReset()
    MockMainCacheServiceUtils.resetMocks()
    vi.useFakeTimers()
    process.env = {
      SHELL: '/bin/zsh',
      HOME: '/home/test',
      // Distinct from every captured PATH, so a degraded fallback is recognizable.
      PATH: '/degraded/fallback'
    }
  })

  afterEach(() => {
    process.env = savedEnv
    vi.useRealTimers()
  })

  it('serves the captured env within the TTL without re-spawning', async () => {
    mockLoginShell('/usr/bin')
    expect((await getShellEnv()).PATH).toContain('/usr/bin')

    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    expect((await getShellEnv()).PATH).not.toContain('/opt/ffmpeg/bin')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('serves a tool installed after launch to a fresh read, on the first read', async () => {
    mockLoginShell('/usr/bin')
    await getShellEnv()

    // User installs ffmpeg in a terminal, switches back and activates a server.
    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    expect((await getShellEnv({ fresh: true })).PATH).toContain('/opt/ffmpeg/bin')
  })

  it('serves the last good capture while re-resolving in the background once it expires', async () => {
    mockLoginShell('/usr/bin')
    await getShellEnv()

    vi.advanceTimersByTime(TTL_MS + 1)
    const slowShell = mockPendingLoginShell('/usr/bin:/opt/ffmpeg/bin')

    // The expired passive read must not wait on the pending shell.
    expect((await getShellEnv()).PATH).toContain('/usr/bin')
    expect(spawn).toHaveBeenCalledTimes(2)

    slowShell.settle()
    await flush()
    expect((await getShellEnv()).PATH).toContain('/opt/ffmpeg/bin')
  })

  it('keeps the last good capture when a re-capture fails, and backs off for one TTL', async () => {
    mockLoginShell('/usr/bin')
    await getShellEnv()

    vi.advanceTimersByTime(TTL_MS + 1)
    mockFailingLoginShell()
    await getShellEnv()
    await flush()

    for (let i = 0; i < 5; i++) {
      const env = await getShellEnv()
      // A failed capture must not downgrade a working env to bare process.env.
      expect(env.PATH).toContain('/usr/bin')
      expect(env.PATH).not.toContain('/degraded/fallback')
    }
    // A broken profile must not be re-spawned once per read.
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('does not adopt an in-flight capture that started before a fresh read', async () => {
    // A read starts a capture, then the user installs a tool while it is running.
    // No clock advance: a capture and a caller in the same millisecond must
    // still order, so the running capture is not eligible for the refresh.
    const preInstall = mockPendingLoginShell('/usr/bin')
    const reader = getShellEnv()

    // BinaryManager refreshes after the install; it must observe the new PATH.
    const refresh = refreshShellEnv()
    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    preInstall.settle()

    expect((await reader).PATH).not.toContain('/opt/ffmpeg/bin')
    expect((await refresh).PATH).toContain('/opt/ffmpeg/bin')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('shares one queued capture across a burst of fresh reads', async () => {
    const running = mockPendingLoginShell('/usr/bin')
    const reader = getShellEnv()

    // Three activations land while the first capture is still running. The
    // queued capture starts after all of them, so one re-capture serves them all.
    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    const bursts = [getShellEnv({ fresh: true }), getShellEnv({ fresh: true }), getShellEnv({ fresh: true })]
    running.settle()

    await reader
    for (const env of await Promise.all(bursts)) {
      expect(env.PATH).toContain('/opt/ffmpeg/bin')
    }
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
