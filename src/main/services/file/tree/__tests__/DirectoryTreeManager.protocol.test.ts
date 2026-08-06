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
import type * as lifecycleModule from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  DirectoryTreeOptions,
  SerializedTreeNode,
  TreeMutationEvent,
  TreeMutationPushPayload
} from '@shared/utils/file'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/** `WebContents` double — only `id`, `isDestroyed`, `send` and `once('destroyed')` are touched. */
function makeSender(id: number) {
  let destroyed = false
  const sentMutations: TreeMutationPushPayload[] = []
  const destroyedListeners: Array<() => void> = []
  const sender = {
    id,
    isDestroyed: () => destroyed,
    send: (channel: string, event: string, payload: TreeMutationPushPayload) => {
      if (channel === IpcChannel.IpcApi_Event && event === 'file.tree.mutation') sentMutations.push(payload)
    },
    once: (event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
      return sender
    },
    off: () => sender,
    /** Mark destroyed and run the registered `destroyed` handlers. */
    fireDestroyed: () => {
      destroyed = true
      for (const l of destroyedListeners.splice(0)) l()
    },
    /** Mark destroyed WITHOUT notifying — models the event firing before we subscribed. */
    destroySilently: () => {
      destroyed = true
    },
    sentMutations
  }
  return sender as typeof sender & WebContents
}

describe('DirectoryTreeManager protocol', () => {
  let manager: DirectoryTreeManager
  let builder: FakeBuilder

  beforeEach(() => {
    BaseService.resetInstances()
    builder = makeFakeBuilder()
    createDirectoryTreeMock.mockReset().mockResolvedValue(builder)
    manager = new DirectoryTreeManager()
  })

  afterEach(async () => {
    await manager.disposeAll()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const create = (sender: WebContents, options?: DirectoryTreeOptions) => manager.create(sender, '/ws', options)

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
      // The window goes away mid-scan: `destroyed` has already fired, so the listener
      // the manager registers afterwards would never see it.
      sender.destroySilently()
      resolveBuilder?.(builder)

      await expect(pending).rejects.toThrow(/destroyed during creation/)

      const internal = manager as unknown as { consumers: Map<string, unknown> }
      expect(internal.consumers.size).toBe(0)
      expect(builder.listenerCount()).toBe(0)
    })

    it('drops every tree owned by a webContents when it is destroyed', async () => {
      const sender = makeSender(1)
      await create(sender)
      await create(sender, { includeHidden: true })

      sender.fireDestroyed()

      const internal = manager as unknown as { consumers: Map<string, unknown> }
      expect(internal.consumers.size).toBe(0)
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
