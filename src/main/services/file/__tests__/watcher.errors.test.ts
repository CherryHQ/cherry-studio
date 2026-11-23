import type { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NativeWatcher } from '../nativeWatcher'
import type { WatcherMessage } from '../watcherProtocol'

const mocks = vi.hoisted(() => ({
  watchers: [] as Array<EventEmitter & { close: () => Promise<void>; polling: boolean }>
}))

vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    watch: (_root: string, options: { usePolling: boolean }) => {
      const watcher = Object.assign(new EventEmitter(), {
        close: () => Promise.resolve(),
        polling: options.usePolling
      })
      mocks.watchers.push(watcher)
      return watcher
    }
  }
})

const originalPlatform = process.platform
let watcher: NativeWatcher
let events: WatcherMessage[]

beforeEach(() => {
  mocks.watchers.length = 0
  events = []
  watcher = new NativeWatcher({ root: '/notes', options: {} }, (event) => events.push(event))
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  await watcher.close()
})

function fail(code: string): void {
  mocks.watchers.at(-1)?.emit('error', Object.assign(new Error(`${code}: watch failed`), { code }))
}

// Catches loss of observation after recoverable native errors and false recovery after polling fails.
describe('native watcher error recovery', () => {
  it.each(['EPERM', 'EBUSY', 'EMFILE'])('restores event delivery through polling after Windows %s', (code) => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    fail(code)
    const polling = mocks.watchers.find((candidate) => candidate.polling)
    polling?.emit('ready')
    polling?.emit('add', '/notes/restored.txt')
    expect(events).toContainEqual({ kind: 'ready' })
    expect(events).toContainEqual({ kind: 'add', path: '/notes/restored.txt' })
    expect(events.some((event) => event.kind === 'error')).toBe(false)
  })

  it('reports permissions failure on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    fail('EPERM')
    expect(events).toContainEqual({ kind: 'error', message: 'EPERM: watch failed' })
  })

  it('reports lost coverage when the polling watcher also fails', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    fail('EPERM')
    fail('EPERM')
    expect(events).toContainEqual({ kind: 'error', message: 'EPERM: watch failed' })
  })

  it('waits for the retired native watcher as well as its polling replacement', async () => {
    const nativeClose = Promise.withResolvers<void>()
    mocks.watchers[0].close = () => nativeClose.promise
    fail('EMFILE')
    let completed = false
    const closing = watcher.close().then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    nativeClose.resolve()
    await closing
    expect(completed).toBe(true)
  })
})
