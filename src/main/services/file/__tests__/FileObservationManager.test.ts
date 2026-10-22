import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import type { WatcherEvent } from '../watcher'

const { watchers } = vi.hoisted(() => ({
  watchers: [] as {
    listeners: Set<(event: WatcherEvent) => void>
    closed: boolean
    finishClose: (() => void) | undefined
    emit: (event: WatcherEvent) => void
  }[]
}))
vi.mock('../watcher', () => ({
  createDirectoryWatcher: () => {
    const listeners = new Set<(event: WatcherEvent) => void>()
    const record = {
      listeners,
      closed: false,
      finishClose: undefined as (() => void) | undefined,
      emit: (event: WatcherEvent) => {
        for (const listener of listeners) listener(event)
      }
    }
    watchers.push(record)
    return {
      onEvent: (listener: (event: WatcherEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close: () =>
        new Promise<void>((resolve) => {
          record.closed = true
          record.finishClose = resolve
        })
    }
  }
}))

import { FileObservationManager } from '../FileObservationManager'

const root = AbsoluteFilePathSchema.parse('/test/notes')
const file = AbsoluteFilePathSchema.parse('/test/notes/a.md')

describe('FileObservationManager ownership and activation', () => {
  let manager: FileObservationManager
  const received: unknown[] = []

  beforeEach(async () => {
    BaseService.resetInstances()
    watchers.length = 0
    received.length = 0
    manager = new FileObservationManager()
    await manager._doInit()
    vi.spyOn(application.get('IpcApiService'), 'send').mockImplementation((_owner, event, payload) => {
      if (event === 'file.observe.event') received.push(payload)
    })
  })
  afterEach(async () => {
    const stopping = manager._doStop()
    for (const watcher of watchers) watcher.finishClose?.()
    await stopping
    vi.restoreAllMocks()
  })

  it('shares equivalent watchers while independently retaining subscriptions', async () => {
    const a = manager.acquireWatcher(root, {}, 'same-policy')
    const b = manager.acquireWatcher(root, { recursive: true }, 'same-policy')
    const first: WatcherEvent[] = []
    const second: WatcherEvent[] = []
    a.onEvent((event) => first.push(event))
    b.onEvent((event) => second.push(event))
    watchers[0].emit({ kind: 'ready' })
    await a.close()
    watchers[0].emit({ kind: 'change', path: file })
    expect(first).toEqual([{ kind: 'ready' }])
    expect(second).toEqual([{ kind: 'ready' }, { kind: 'change', path: file }])
    expect(watchers).toHaveLength(1)
    let completed = false
    const closing = b.close().then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    watchers[0].finishClose?.()
    await closing
    expect(completed).toBe(true)
  })

  it('replays events after activation and refuses a foreign owner or generation', async () => {
    const creating = manager.create('owner', root)
    watchers[0].emit({ kind: 'ready' })
    const lease = await creating
    watchers[0].emit({ kind: 'change', path: file })
    expect(received).toEqual([])
    expect(manager.activateObservation('other', lease)).toBe(false)
    expect(manager.activateObservation('owner', { ...lease, generation: 'retired' })).toBe(false)
    expect(manager.activateObservation('owner', lease)).toBe(true)
    expect(received).toEqual([{ ...lease, sequence: 1, kind: 'invalidate', paths: [file], subtree: false }])
    expect(manager.activateObservation('owner', lease)).toBe(true)
    expect(received).toHaveLength(1)
    const disposing = manager.dispose('owner', lease.observationId)
    watchers[0].emit({ kind: 'change', path: file })
    watchers[0].finishClose?.()
    await disposing
    expect(received).toHaveLength(1)
    expect(manager.activateObservation('owner', lease)).toBe(false)
  })

  it('requires reconciliation instead of replaying an incomplete overflowed stream', async () => {
    const creating = manager.create('owner', root)
    watchers[0].emit({ kind: 'ready' })
    const lease = await creating
    for (let i = 0; i < 1001; i++) watchers[0].emit({ kind: 'change', path: file })
    expect(manager.activateObservation('owner', lease)).toBe(false)
    expect(received).toEqual([])
  })

  it('replays readiness to a late consumer and surfaces a failed watcher as invalidation', async () => {
    const first = manager.create('owner', root)
    watchers[0].emit({ kind: 'ready' })
    const a = await first
    const b = await manager.create('owner', root)
    expect(manager.activateObservation('owner', b)).toBe(true)
    watchers[0].emit({ kind: 'error', error: new Error('watch failed') })
    expect(received).toEqual([{ ...b, sequence: 1, kind: 'resync-required', reason: 'watcher-error' }])
    await manager.dispose('owner', a.observationId)
    expect(watchers[0].closed).toBe(false)
  })

  it('rejects a pending acquisition when shutdown overtakes watcher readiness', async () => {
    const creating = manager.create('owner', root).catch((error: unknown) => error)
    const stopping = manager._doStop()
    watchers[0].emit({ kind: 'ready' })
    watchers[0].finishClose?.()
    await stopping
    expect(await creating).toMatchObject({ code: 'FILE_DIRECTORY_TREE_STOPPED' })
    expect(watchers[0].closed).toBe(true)
    expect(received).toEqual([])
  })
})
