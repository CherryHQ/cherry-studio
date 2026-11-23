import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isWin: false }))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platform.isWin
  },
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))
vi.mock('../shellEnv', () => ({ getShellEnv: vi.fn() }))

const { killProcessTree, terminateProcessTree } = await import('../processRunner')

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
  child.kill('SIGKILL')
  await exited
}

describe('killProcessTree', () => {
  beforeEach(() => {
    platform.isWin = process.platform === 'win32'
  })

  it('terminates a running child through the native platform backend', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: process.platform !== 'win32'
    })

    try {
      await once(child, 'spawn')
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })

      killProcessTree(child)

      await exited
      if (process.platform !== 'win32') expect(child.signalCode).toBe('SIGTERM')
      else expect(child.exitCode).not.toBeNull()
    } finally {
      await stopChild(child)
    }
  })

  it.skipIf(process.platform === 'win32').each([
    ['null', () => null],
    [
      'unprintable value',
      () => ({
        toString() {
          throw new Error('unprintable signal failure')
        }
      })
    ],
    [
      'revoked proxy',
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {})
        revoke()
        return proxy
      }
    ]
  ] as const)('still terminates the child after a %s group-signal failure', async (_label, createFailure) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const originalKill = process.kill

    try {
      await once(child, 'spawn')
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      const failure = createFailure()
      process.kill = () => {
        throw failure
      }

      killProcessTree(child)

      await exited
      expect(child.signalCode).toBe('SIGTERM')
    } finally {
      process.kill = originalKill
      await stopChild(child)
    }
  })
})

describe('terminateProcessTree on POSIX', () => {
  beforeEach(() => {
    platform.isWin = false
  })

  it.each([false, true])('accepts ESRCH as already terminated (force=%s)', async (force) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const originalKill = process.kill

    try {
      await once(child, 'spawn')
      process.kill = () => {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      }

      await expect(terminateProcessTree(child, force, 'test')).resolves.toBeUndefined()
    } finally {
      process.kill = originalKill
      await stopChild(child)
    }
  })

  it.each([false, true])('preserves all other failure identities (force=%s)', async (force) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const failures = [
      Object.assign(new Error('permission denied'), { code: 'EPERM' }),
      new Error('uncoded signal failure'),
      null,
      undefined,
      Object.defineProperty({}, 'code', {
        get() {
          throw new Error('unreadable code')
        }
      }),
      proxy
    ]
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const originalKill = process.kill

    try {
      await once(child, 'spawn')

      for (const failure of failures) {
        process.kill = () => {
          throw failure
        }
        let rejected = false

        try {
          await terminateProcessTree(child, force, 'test')
        } catch (error) {
          rejected = true
          expect(Object.is(error, failure)).toBe(true)
        }

        expect(rejected).toBe(true)
      }
    } finally {
      process.kill = originalKill
      await stopChild(child)
    }
  })
})
