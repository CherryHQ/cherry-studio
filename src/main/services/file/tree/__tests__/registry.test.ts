import type { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// `TreeRegistry` extends `BaseService`, which forbids more than one
// instance per constructor. Tests new it up per `beforeEach` — reset the
// guard between tests so each one starts clean. (Real production code
// goes through `application.get('TreeRegistry')` so it only constructs
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
import { TreeRegistry } from '../registry'

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

describe('TreeRegistry', () => {
  let tmp: string
  let registry: TreeRegistry

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tree-registry-'))
    BaseService.resetInstances()
    registry = new TreeRegistry()
  })

  afterEach(async () => {
    registry.disposeAll()
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

  it('fans watcher mutations out to every attached sender', async () => {
    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)

    await new Promise((resolve) => setTimeout(resolve, 100)) // let watcher settle
    await writeFile(path.join(tmp, 'fanout.md'), 'x')
    // chokidar's `stabilityThresholdMs` is 200ms; give it generous extra
    // headroom because this test sometimes races other watcher-heavy
    // suites running in the same vitest worker.
    await new Promise((resolve) => setTimeout(resolve, 1500))

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
      registry as unknown as { consumers: Map<string, { sharedBuilder: { builder: { dispose: typeof disposedSpy } } }> }
    ).consumers.get(created.treeId)
    const realDispose = consumer!.sharedBuilder.builder.dispose
    consumer!.sharedBuilder.builder.dispose = ((): void => {
      disposedSpy()
      realDispose.call(consumer!.sharedBuilder.builder)
    }) as typeof realDispose

    registry.dispose(created.treeId)
    expect(disposedSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(600)
    expect(disposedSpy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
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
