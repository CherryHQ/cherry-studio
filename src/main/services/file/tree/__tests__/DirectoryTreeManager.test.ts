import type { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// `DirectoryTreeManager` extends `BaseService`, which forbids more than one
// instance per constructor. Tests new it up per `beforeEach` — reset the
// guard between tests so each one starts clean. (Real production code
// goes through `application.get('DirectoryTreeManager')` so it only constructs
// once anyway.)
import type * as lifecycleModule from '@main/core/lifecycle'
import type { TreeMutationPushPayload } from '@shared/file/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof lifecycleModule>)()
  return {
    ...actual,
    Injectable: () => () => {},
    ServicePhase: () => () => {}
  }
})

import { BaseService } from '@main/core/lifecycle'

import * as builderModule from '../builder'
import { DirectoryTreeManager } from '../DirectoryTreeManager'

// Capture handlers registered via `ipcMain.handle` so the Zod validation
// tests below can drive each channel without an actual Electron runtime.
// Other electron surfaces (`app.isPackaged`, etc.) are stubbed minimally
// because the import graph (logger, @main/utils' toAsarUnpackedPath) pulls
// them in transitively.
const registeredHandlers = new Map<string, (event: unknown, params: unknown) => unknown>()
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getAppPath: () => '/tmp'
  },
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, params: unknown) => unknown) => {
      registeredHandlers.set(channel, listener)
    },
    removeHandler: (channel: string) => {
      registeredHandlers.delete(channel)
    },
    on: () => {},
    removeListener: () => {}
  }
}))

/**
 * Minimal `WebContents`-shaped double. We only touch:
 *   - `id` (registry buckets by it)
 *   - `isDestroyed()` (mutation forwarder guards on it)
 *   - `send(channel, payload)` (where mutations land)
 *   - `once('destroyed', listener)` (orphan-cleanup hook)
 */
function makeSender(id: number) {
  let destroyed = false
  const sentMutations: TreeMutationPushPayload[] = []
  const destroyedListeners: Array<() => void> = []
  const sender = {
    id,
    isDestroyed: () => destroyed,
    send: (channel: string, payload: TreeMutationPushPayload) => {
      if (channel === IpcChannel.File_TreeMutation) sentMutations.push(payload)
    },
    once: (event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
      return sender as unknown as EventEmitter
    },
    fireDestroyed: () => {
      destroyed = true
      for (const l of destroyedListeners.splice(0)) l()
    },
    sentMutations
  }
  return sender as typeof sender & WebContents
}

describe('DirectoryTreeManager', () => {
  let tmp: string
  let registry: DirectoryTreeManager

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tree-registry-'))
    BaseService.resetInstances()
    registry = new DirectoryTreeManager()
  })

  afterEach(async () => {
    await registry.disposeAll()
    await rm(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('issues a fresh treeId on every create, even when the underlying builder is shared', async () => {
    await writeFile(path.join(tmp, 'a.md'), 'a')

    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)

    expect(created1.treeId).not.toBe(created2.treeId)
    expect(created1.snapshot.path).toBe(created2.snapshot.path)
  })

  it('reuses one DirectoryTreeBuilder across multiple consumers with the same (rootPath, options)', async () => {
    const spy = vi.spyOn(builderModule, 'createDirectoryTree')

    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    await registry.create(sender1, tmp, undefined)
    await registry.create(sender2, tmp, undefined)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('dedupes truly concurrent creates via the inflight map (not just sequential reuse)', async () => {
    // Sequential await skips the `inflight` map (the second call always
    // finds an entry in `sharedBuilders` because the first finished). Two
    // truly-parallel creates must hit the `pending` branch — otherwise a
    // race could spawn two ripgrep scans + two chokidar watchers per root.
    const spy = vi.spyOn(builderModule, 'createDirectoryTree')

    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const [created1, created2] = await Promise.all([
      registry.create(sender1, tmp, undefined),
      registry.create(sender2, tmp, undefined)
    ])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(created1.treeId).not.toBe(created2.treeId)
  })

  it('treats option objects with different key order or array order as the same key', async () => {
    const spy = vi.spyOn(builderModule, 'createDirectoryTree')

    const sender1 = makeSender(1)
    const sender2 = makeSender(2)
    const sender3 = makeSender(3)

    // Same options, three different literal shapes. Without canonical key
    // serialization the JSON.stringify outputs differ and dedupe fails.
    await registry.create(sender1, tmp, { extensions: ['md', 'txt'], withStats: true })
    await registry.create(sender2, tmp, { withStats: true, extensions: ['md', 'txt'] })
    await registry.create(sender3, tmp, { extensions: ['txt', 'md'], withStats: true })

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('fans watcher mutations out to every attached sender', async () => {
    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)

    await new Promise((resolve) => setTimeout(resolve, 100)) // let watcher settle
    await writeFile(path.join(tmp, 'fanout.md'), 'x')

    // Poll for the mutation rather than sleeping a fixed window — the
    // chokidar `stabilityThresholdMs` is 200ms but the actual delivery
    // varies with FS load, so a hardcoded wait is either flaky (too
    // short) or slow (always burns the worst case). Vitest's `waitFor`
    // polls until both senders have received the `added` push.
    await vi.waitFor(
      () => {
        expect(sender1.sentMutations.some((m) => m.event.type === 'added')).toBe(true)
        expect(sender2.sentMutations.some((m) => m.event.type === 'added')).toBe(true)
      },
      { timeout: 4000, interval: 50 }
    )

    // Each sender receives the same `added` event tagged with its own treeId.
    const added1 = sender1.sentMutations.find((m) => m.event.type === 'added')
    const added2 = sender2.sentMutations.find((m) => m.event.type === 'added')
    expect(added1?.treeId).toBe(created1.treeId)
    expect(added2?.treeId).toBe(created2.treeId)
    expect(added1?.event).toEqual(added2?.event)
  })

  it('does not tear down the shared builder when one of two consumers disposes', async () => {
    const spy = vi.spyOn(builderModule, 'createDirectoryTree')

    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    await registry.create(sender2, tmp, undefined)
    registry.dispose(created1.treeId)

    // Builder must still exist; a third create with the same key reuses it.
    const sender3 = makeSender(3)
    await registry.create(sender3, tmp, undefined)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reuses the still-warm builder when a dispose+create happens within the grace window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const spy = vi.spyOn(builderModule, 'createDirectoryTree')

    const sender = makeSender(1)
    const created = await registry.create(sender, tmp, undefined)
    registry.dispose(created.treeId)

    // Re-acquire before the grace timer fires.
    await vi.advanceTimersByTimeAsync(100)
    await registry.create(sender, tmp, undefined)

    // Still just one builder created end-to-end.
    expect(spy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('tears the shared builder down after the grace window elapses with no new consumers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const sender = makeSender(1)
    const created = await registry.create(sender, tmp, undefined)

    const disposedSpy = vi.fn()
    const consumer = (
      registry as unknown as { consumers: Map<string, { builder: { dispose: typeof disposedSpy } }> }
    ).consumers.get(created.treeId)
    const builder = consumer!.builder
    const realDispose = builder.dispose
    builder.dispose = ((): void => {
      disposedSpy()
      realDispose.call(builder)
    }) as typeof realDispose

    registry.dispose(created.treeId)
    expect(disposedSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(600)
    expect(disposedSpy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('rename(treeId, …) dispatches to the shared builder and emits to all consumers', async () => {
    await writeFile(path.join(tmp, 'old.md'), 'x')
    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)

    const applied = registry.rename(created1.treeId, path.join(tmp, 'old.md'), path.join(tmp, 'new.md'))
    expect(applied).toBe(true)

    // Both consumers see the renamed mutation (shared builder fan-out).
    const renamed1 = sender1.sentMutations.find((p) => p.event.type === 'renamed')
    const renamed2 = sender2.sentMutations.find((p) => p.event.type === 'renamed')
    expect(renamed1).toBeDefined()
    expect(renamed2).toBeDefined()
    expect(renamed1?.treeId).toBe(created1.treeId)
    expect(renamed2?.treeId).toBe(created2.treeId)
  })

  it('rename(treeId, …) returns false when the treeId is unknown', () => {
    const applied = registry.rename('does-not-exist', '/a/old', '/a/new')
    expect(applied).toBe(false)
  })

  describe('IPC handler Zod validation', () => {
    beforeEach(async () => {
      registeredHandlers.clear()
      await (registry as unknown as { _doInit: () => Promise<void> })._doInit()
    })

    it('File_TreeCreate rejects missing rootPath', async () => {
      const handler = registeredHandlers.get('file:tree:create')!
      await expect(handler({}, { options: { withStats: true } } as unknown)).rejects.toThrow()
    })

    it('File_TreeCreate rejects a relative rootPath', async () => {
      const handler = registeredHandlers.get('file:tree:create')!
      await expect(handler({}, { rootPath: 'relative/path' } as unknown)).rejects.toThrow()
    })

    it('File_TreeCreate rejects negative maxDepth', async () => {
      const handler = registeredHandlers.get('file:tree:create')!
      await expect(handler({}, { rootPath: tmp, options: { maxDepth: -1 } } as unknown)).rejects.toThrow()
    })

    it('File_TreeDispose rejects missing treeId', async () => {
      const handler = registeredHandlers.get('file:tree:dispose')!
      await expect(handler({}, {} as unknown)).rejects.toThrow()
    })

    it('File_TreeRename rejects relative oldPath / newPath', async () => {
      const handler = registeredHandlers.get('file:tree:rename')!
      await expect(handler({}, { treeId: 't-1', oldPath: 'a.md', newPath: '/abs/b.md' } as unknown)).rejects.toThrow()
      await expect(handler({}, { treeId: 't-1', oldPath: '/abs/a.md', newPath: 'b.md' } as unknown)).rejects.toThrow()
    })
  })

  it('drops all trees and their builders when the owning webContents is destroyed', async () => {
    const sender = makeSender(1)
    await registry.create(sender, tmp, undefined)
    await registry.create(sender, path.join(tmp), { extensions: ['.md'] })

    sender.fireDestroyed()
    // Both consumers were tracked under this webContentsId — disposal
    // cascades through.
    const internal = registry as unknown as { consumers: Map<string, unknown> }
    expect(internal.consumers.size).toBe(0)
  })
})
