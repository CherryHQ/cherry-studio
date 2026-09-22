import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `DirectoryTreeManager` state machine, exercised against a fake builder.
 *
 * The sibling `DirectoryTreeManager.test.ts` runs the same manager over a real
 * ripgrep scan + chokidar watcher and is therefore gated behind
 * `skipIf(!ripgrepAvailable)` — which means it does not run in CI. Builder
 * dedupe, the snapshot→activate→stream handshake, revision numbering, ownership
 * and teardown are manager-level protocol, not filesystem behavior, so they are
 * covered here with no binary dependency and always execute.
 */
import { application } from '@application'
import type * as lifecycleModule from '@main/core/lifecycle'
import type { ManagedWindow } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  DirectoryTreeOptions,
  SerializedTreeNode,
  TreeMutationEvent,
  TreeMutationPushPayload
} from '@shared/utils/file'

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof lifecycleModule>)()
  return { ...actual, Injectable: () => () => {}, ServicePhase: () => () => {} }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {}, removeListener: () => {} }
}))

const { createDirectoryTreeMock } = vi.hoisted(() => ({ createDirectoryTreeMock: vi.fn() }))
vi.mock('../builder', () => ({ createDirectoryTree: createDirectoryTreeMock }))

import { BaseService } from '@main/core/lifecycle'

import { DirectoryTreeManager } from '../DirectoryTreeManager'

/** Minimal `DirectoryTreeBuilder` double: emits mutations on command, records disposal. */
function makeFakeBuilder(rootPath = '/ws') {
  const listeners = new Set<(e: TreeMutationEvent) => void>()
  const builder = {
    root: {} as never,
    disposeCount: 0,
    onMutation: (listener: (e: TreeMutationEvent) => void) => {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
    getNode: () => null,
    snapshot: (): SerializedTreeNode => ({ kind: 'directory', path: rootPath, basename: 'ws', children: {} }),
    rename: vi.fn(() => true),
    dispose: () => {
      builder.disposeCount += 1
    },
    disposeAsync: async () => {
      builder.disposeCount += 1
    },
    /** Test seam: push a mutation through every attached consumer. */
    emit: (event: TreeMutationEvent) => {
      for (const listener of Array.from(listeners)) listener(event)
    },
    listenerCount: () => listeners.size
  }
  return builder
}

type FakeBuilder = ReturnType<typeof makeFakeBuilder>

function addedEvent(name: string): TreeMutationEvent {
  return { type: 'added', kind: 'file', path: `/ws/${name}`, basename: name, parentPath: '/ws' }
}

/**
 * `WebContents` double — only `id`, `isDestroyed` and `send` are touched. `windowId`
 * is the managed window the manager keys ownership teardown by.
 */
function makeSender(id: number) {
  let destroyed = false
  const sentMutations: TreeMutationPushPayload[] = []
  const sender = {
    id,
    windowId: `win-${id}`,
    isDestroyed: () => destroyed,
    send: (channel: string, event: string, payload: TreeMutationPushPayload) => {
      if (channel === IpcChannel.IpcApi_Event && event === 'file.tree.mutation') sentMutations.push(payload)
    },
    /** Mark destroyed with no event — models a window closing mid-create, after `onWindowDestroyed` already ran. */
    destroy: () => {
      destroyed = true
    },
    sentMutations
  }
  return sender as typeof sender & WebContents
}

describe('DirectoryTreeManager protocol', () => {
  let manager: DirectoryTreeManager
  let builder: FakeBuilder
  let windowDestroyed: (managed: ManagedWindow) => void

  beforeEach(async () => {
    BaseService.resetInstances()
    builder = makeFakeBuilder()
    createDirectoryTreeMock.mockReset().mockResolvedValue(builder)
    vi.mocked(application.get('WindowManager').onWindowDestroyed).mockImplementation((listener) => {
      windowDestroyed = listener
      return { dispose: () => {} }
    })
    manager = new DirectoryTreeManager()
    await manager._doInit()
  })

  afterEach(async () => {
    await manager.disposeAll()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const create = (sender: ReturnType<typeof makeSender>, options?: DirectoryTreeOptions) =>
    manager.create({ windowId: sender.windowId, webContents: sender }, '/ws', options)

  describe('handshake', () => {
    it('buffers mutations until the owner activates, then flushes them in order', async () => {
      const sender = makeSender(1)
      const created = await create(sender)

      builder.emit(addedEvent('a.md'))
      builder.emit(addedEvent('b.md'))
      expect(sender.sentMutations).toEqual([])

      expect(manager.activateTree(created.treeId, created.revision, sender.id)).toBe(true)
      expect(sender.sentMutations.map((m) => m.revision)).toEqual([1, 2])
      expect(sender.sentMutations.map((m) => (m.event as { path: string }).path)).toEqual(['/ws/a.md', '/ws/b.md'])
    })

    it('streams live once activated', async () => {
      const sender = makeSender(1)
      const created = await create(sender)
      manager.activateTree(created.treeId, created.revision, sender.id)

      builder.emit(addedEvent('later.md'))
      expect(sender.sentMutations).toHaveLength(1)
      expect(sender.sentMutations[0].revision).toBe(created.revision + 1)
    })

    it('refuses activation against a revision other than the snapshot baseline', async () => {
      const sender = makeSender(1)
      const created = await create(sender)

      expect(manager.activateTree(created.treeId, created.revision + 1, sender.id)).toBe(false)
      builder.emit(addedEvent('a.md'))
      expect(sender.sentMutations).toEqual([])
    })

    it('numbers revisions per treeId even when the builder is shared', async () => {
      const sender1 = makeSender(1)
      const sender2 = makeSender(2)
      const first = await create(sender1)
      manager.activateTree(first.treeId, first.revision, sender1.id)
      builder.emit(addedEvent('early.md'))

      const second = await create(sender2)
      manager.activateTree(second.treeId, second.revision, sender2.id)
      builder.emit(addedEvent('late.md'))

      expect(sender1.sentMutations.map((m) => m.revision)).toEqual([1, 2])
      expect(sender2.sentMutations.map((m) => m.revision)).toEqual([1])
      expect(sender2.sentMutations[0].treeId).toBe(second.treeId)
    })

    it('disposes a consumer that buffers past the pending ceiling', async () => {
      const sender = makeSender(1)
      const created = await create(sender)

      // One past the ceiling: the overflow event disposes rather than being queued.
      for (let i = 0; i <= 1000; i += 1) builder.emit(addedEvent(`f${i}.md`))

      // Late activation now fails, so the renderer restarts the handshake instead of
      // receiving a replay whose head was silently dropped.
      expect(manager.activateTree(created.treeId, created.revision, sender.id)).toBe(false)
      expect(sender.sentMutations).toEqual([])
      expect(builder.listenerCount()).toBe(0)
    })
  })

  describe('ownership', () => {
    it('refuses activate / dispose / rename from a window that does not own the tree', async () => {
      const owner = makeSender(1)
      const other = makeSender(2)
      const created = await create(owner)

      expect(manager.activateTree(created.treeId, created.revision, other.id)).toBe(false)
      expect(manager.rename(created.treeId, '/ws/a.md', 'b.md', other.id)).toBe(false)
      expect(manager.dispose(created.treeId, other.id)).toBe(false)
      expect(builder.rename).not.toHaveBeenCalled()

      // The owner's tree is untouched by the attempts above.
      expect(manager.activateTree(created.treeId, created.revision, owner.id)).toBe(true)
      builder.emit(addedEvent('a.md'))
      expect(owner.sentMutations).toHaveLength(1)
    })

    it('resolves a rename against the original parent directory', async () => {
      const sender = makeSender(1)
      const created = await create(sender)

      expect(manager.rename(created.treeId, '/ws/nested/old.md', 'new.md', sender.id)).toBe(true)
      expect(builder.rename).toHaveBeenCalledWith('/ws/nested/old.md', '/ws/nested/new.md')
    })
  })

  describe('owner lifetime', () => {
    it('releases the consumer when the owner is destroyed while the builder is being created', async () => {
      const sender = makeSender(1)
      let resolveBuilder: ((b: FakeBuilder) => void) | undefined
      createDirectoryTreeMock.mockReturnValueOnce(
        new Promise<FakeBuilder>((resolve) => {
          resolveBuilder = resolve
        })
      )

      const pending = create(sender)
      // The window goes away mid-scan: `onWindowDestroyed` has already fired with nothing
      // of ours registered, so only the post-await reconcile can catch it.
      sender.destroy()
      resolveBuilder?.(builder)

      await expect(pending).rejects.toThrow(/destroyed during creation/)

      const internal = manager as unknown as { consumers: Map<string, unknown> }
      expect(internal.consumers.size).toBe(0)
      expect(builder.listenerCount()).toBe(0)
    })

    it('still tears the builder down when a dead and a live create share one acquisition', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const dead = makeSender(1)
      const live = makeSender(2)
      let resolveBuilder: ((b: FakeBuilder) => void) | undefined
      createDirectoryTreeMock.mockReturnValueOnce(
        new Promise<FakeBuilder>((resolve) => {
          resolveBuilder = resolve
        })
      )

      // Both wait on the same in-flight acquisition, so both receive the shared record
      // as it was. The dead one attaches and immediately disposes, flipping the entry
      // to `draining`; the live one must not act on its stale `active` copy.
      const deadCreate = create(dead)
      const liveCreate = create(live)
      dead.destroy()
      resolveBuilder?.(builder)

      await expect(deadCreate).rejects.toThrow(/destroyed during creation/)
      const created = await liveCreate

      // The timer armed by the dead consumer's disposal fires with a live consumer
      // attached and must leave the builder usable.
      await vi.advanceTimersByTimeAsync(600)
      expect(builder.disposeCount).toBe(0)

      // The real test: the surviving consumer's own disposal has to arm a new timer.
      // Against a record stranded in `draining` it would arm nothing and the watcher
      // would outlive every consumer.
      manager.dispose(created.treeId)
      await vi.advanceTimersByTimeAsync(600)
      expect(builder.disposeCount).toBe(1)
    })

    it('drops every tree owned by a window when it is destroyed, and nothing else', async () => {
      const sender = makeSender(1)
      const survivor = makeSender(2)
      await create(sender)
      await create(sender, { includeHidden: true })
      const kept = await create(survivor)

      sender.destroy()
      windowDestroyed({ id: sender.windowId } as ManagedWindow)

      const internal = manager as unknown as { consumers: Map<string, unknown> }
      expect(Array.from(internal.consumers.keys())).toEqual([kept.treeId])
    })

    it('registers nothing on the service disposable list per create/dispose cycle', async () => {
      const internal = manager as unknown as { _disposables: unknown[] }
      const baseline = internal._disposables.length
      const sender = makeSender(1)
      for (let i = 0; i < 3; i++) {
        const { treeId } = await create(sender)
        manager.dispose(treeId)
      }
      expect(internal._disposables.length).toBe(baseline)
    })
  })

  describe('builder sharing', () => {
    it('shares one builder across consumers with the same (rootPath, options)', async () => {
      await create(makeSender(1))
      await create(makeSender(2))
      expect(createDirectoryTreeMock).toHaveBeenCalledTimes(1)
    })

    it('dedupes truly concurrent creates through the inflight map', async () => {
      const [a, b] = await Promise.all([create(makeSender(1)), create(makeSender(2))])
      expect(createDirectoryTreeMock).toHaveBeenCalledTimes(1)
      expect(a.treeId).not.toBe(b.treeId)
    })

    it('treats option objects with different key or array order as the same builder', async () => {
      await create(makeSender(1), { extensions: ['md', 'txt'], withStats: true })
      await create(makeSender(2), { withStats: true, extensions: ['md', 'txt'] })
      await create(makeSender(3), { extensions: ['txt', 'md'], withStats: true })
      expect(createDirectoryTreeMock).toHaveBeenCalledTimes(1)
    })

    it('keeps the builder alive while another consumer holds it', async () => {
      const first = await create(makeSender(1))
      await create(makeSender(2))

      manager.dispose(first.treeId)

      expect(builder.disposeCount).toBe(0)
      expect(builder.listenerCount()).toBe(1)
    })

    it('reuses a still-warm builder when dispose and create land inside the grace window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const sender = makeSender(1)
      const created = await create(sender)
      manager.dispose(created.treeId)

      await vi.advanceTimersByTimeAsync(100)
      await create(sender)

      expect(createDirectoryTreeMock).toHaveBeenCalledTimes(1)
      expect(builder.disposeCount).toBe(0)
    })

    it('tears the builder down once the grace window elapses with no new consumers', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const created = await create(makeSender(1))

      manager.dispose(created.treeId)
      expect(builder.disposeCount).toBe(0)

      await vi.advanceTimersByTimeAsync(600)
      expect(builder.disposeCount).toBe(1)
    })
  })
})
