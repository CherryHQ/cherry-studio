import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ShellEnv from '../shellEnv'

const state = vi.hoisted(() => ({ children: [] as any[] }))
vi.mock('@main/core/platform', () => ({ isWin: false, isMac: true }))
vi.mock('child_process', () => ({
  spawn: (_file: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      args
    })
    state.children.push(child)
    return child
  }
}))

let shell: typeof ShellEnv
function complete(index: number, output: string, code = 0) {
  const child = state.children[index]
  child.stdout.emit('data', Buffer.from(output))
  child.emit('close', code)
}
async function initial() {
  const pending = shell.getRawShellEnv()
  complete(0, 'PATH=/usr/bin\nHOME=/home/test\n')
  await pending
}

beforeEach(async () => {
  vi.resetModules()
  state.children = []
  shell = await import('../shellEnv')
})
afterEach(() => vi.useRealTimers())

describe('interactive shell fallback', () => {
  it('keeps the initial capture non-interactive and shares one fallback snapshot with execution', async () => {
    await initial()
    expect(state.children[0].args).toEqual(['-lc', 'env'])
    const first = shell.getInteractiveShellEnv()
    const second = shell.getInteractiveShellEnv()
    await vi.waitFor(() => expect(state.children).toHaveLength(2))
    complete(1, 'BANNER=ignored\n\0PATH=/fnm/bin:/usr/bin\nFNM_DIR=/fnm\nHOME=/changed\nHTTPS_PROXY=interactive\n\0')
    expect(await first).toEqual({ PATH: '/usr/bin:/fnm/bin', HOME: '/home/test' })
    const copy = await second
    copy.PATH = '/mutated'
    expect(await shell.getRawShellEnv()).toEqual({ PATH: '/usr/bin:/fnm/bin', HOME: '/home/test' })
    expect(await shell.getInteractiveShellEnv()).toEqual(await first)
    expect(state.children).toHaveLength(2)
  })

  it('surfaces and shares capture failures rather than reporting a missing tool', async () => {
    await initial()
    const pending = shell.getInteractiveShellEnv()
    const rejection = expect(pending).rejects.toThrow('code 1')
    await vi.waitFor(() => expect(state.children).toHaveLength(2))
    complete(1, '', 1)
    await rejection
    await expect(shell.getInteractiveShellEnv()).rejects.toThrow('code 1')
    expect(state.children).toHaveLength(2)
    expect((await shell.getRawShellEnv()).PATH).toBe('/usr/bin')
  })

  it('bounds a hung interactive startup and leaves the original environment usable', async () => {
    await initial()
    vi.useFakeTimers()
    const pending = shell.getInteractiveShellEnv()
    const rejection = expect(pending).rejects.toThrow('Timed out after 15000ms')
    await vi.advanceTimersByTimeAsync(15000)
    await rejection
    expect(state.children[1].kill).toHaveBeenCalledWith('SIGKILL')
    expect((await shell.getRawShellEnv()).PATH).toBe('/usr/bin')
  })

  it('refresh invalidates a pending interactive capture without letting it overwrite the fresh snapshot', async () => {
    await initial()
    const fallback = shell.getInteractiveShellEnv()
    await vi.waitFor(() => expect(state.children).toHaveLength(2))
    const fresh = shell.refreshShellEnv()
    complete(2, 'PATH=/fresh/bin\n')
    await fresh
    complete(1, '\0PATH=/stale/bin\n\0')
    await fallback
    expect((await shell.getRawShellEnv()).PATH).toBe('/fresh/bin')
    const next = shell.getInteractiveShellEnv()
    await vi.waitFor(() => expect(state.children).toHaveLength(4))
    complete(3, '\0PATH=/new-interactive/bin\n\0')
    expect((await next).PATH).toBe('/fresh/bin:/new-interactive/bin')
  })
})
