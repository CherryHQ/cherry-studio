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

import { getShellEnv } from '../shellEnv'

/** Make the next `spawn` behave like a login shell printing `env` output. */
function mockLoginShell(pathValue: string): void {
  vi.mocked(spawn).mockImplementationOnce((() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn()
    })
    queueMicrotask(() => {
      child.stdout.emit('data', `HOME=/home/test\nPATH=${pathValue}\n`)
      child.emit('close', 0)
    })
    return child
  }) as unknown as typeof spawn)
}

describe('shellEnv – POSIX cache TTL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainCacheServiceUtils.resetMocks()
    vi.useFakeTimers()
    process.env.SHELL = '/bin/zsh'
    process.env.HOME = '/home/test'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses the captured env within the TTL and re-resolves after it expires', async () => {
    mockLoginShell('/usr/bin')
    expect((await getShellEnv()).PATH).toContain('/usr/bin')

    // Second read inside the TTL must not spawn another login shell.
    mockLoginShell('/usr/bin:/opt/ffmpeg/bin')
    expect((await getShellEnv()).PATH).not.toContain('/opt/ffmpeg/bin')
    expect(spawn).toHaveBeenCalledTimes(1)

    // Past the TTL, a tool installed after launch becomes visible.
    vi.advanceTimersByTime(60_001)
    expect((await getShellEnv()).PATH).toContain('/opt/ffmpeg/bin')
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
