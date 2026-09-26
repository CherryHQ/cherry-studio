import type { ChildProcess } from 'node:child_process'
import type * as ChildProcessModule from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

const owned = vi.hoisted(() => ({ children: [] as ChildProcess[] }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return {
    ...actual,
    spawn: (_file: string, _args: string[], options: object) => {
      const child = actual.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options)
      owned.children.push(child)
      return child
    }
  }
})
vi.mock('@main/core/platform', () => ({ isWin: false }))

import { findCommandInShellEnv } from '../commandResolver'

afterEach(() => {
  for (const child of owned.children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  owned.children.length = 0
})

describe('owned lookup cancellation', () => {
  it('terminates the command subprocess rather than just abandoning the promise', async () => {
    const controller = new AbortController()
    const pending = findCommandInShellEnv('npx', { PATH: '/usr/bin' }, controller.signal)
    const child = owned.children[0]
    expect(child.pid).toBeTypeOf('number')
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    const rejected = expect(pending).rejects.toThrow()
    controller.abort()
    await rejected
    await closed
    expect(child.signalCode).toBe('SIGKILL')
    expect(() => process.kill(child.pid!, 0)).toThrow()
  })
})
