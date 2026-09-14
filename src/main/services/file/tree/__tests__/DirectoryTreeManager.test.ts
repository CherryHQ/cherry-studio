/**
 * `DirectoryTreeManager` **integration** — the manager driving a real
 * `DirectoryTreeBuilder` over a real ripgrep scan + chokidar watcher.
 *
 * Only behavior that genuinely needs the filesystem lives here, because this
 * suite is gated behind `skipIf(!ripgrepAvailable)` and therefore does not run
 * in CI. The manager's state machine — handshake, revisions, ownership, builder
 * sharing, teardown — is covered against a fake builder in
 * `DirectoryTreeManager.protocol.test.ts`, which always runs. Keep that split:
 * anything provable without the binary belongs there.
 */
import type { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `DirectoryTreeManager` extends `BaseService`, which forbids more than one
// instance per constructor. Tests new it up per `beforeEach` — reset the
// guard between tests so each one starts clean. (Real production code
// goes through `application.get('DirectoryTreeManager')` so it only constructs
// once anyway.)
import type * as lifecycleModule from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type { TreeMutationPushPayload } from '@shared/utils/file'

import { tryTestRipgrepPath } from './ripgrepTestUtils'

const ripgrepAvailable = tryTestRipgrepPath() !== null

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof lifecycleModule>)()
  return {
    ...actual,
    Injectable: () => () => {},
    ServicePhase: () => () => {}
  }
})

import { BaseService } from '@main/core/lifecycle'

// Production resolves ripgrep via BinaryManager (`getBinaryPath('rg')`), which
// reads cherry.bin / mise shims — neither is populated under vitest. Point it
// at the test ripgrep binary so real-builder tests spawn an actual ripgrep scan.
vi.mock('@main/utils/binaryResolver', async () => {
  const { tryTestRipgrepPath: tryPath } = await import('./ripgrepTestUtils')
  const resolvedRgPath = tryPath() ?? '/nonexistent/rg'
  return {
    getBinaryPath: async (name?: string) => (name === 'rg' ? resolvedRgPath : (name ?? ''))
  }
})

vi.mock('@main/utils/binaryEnv', () => ({
  getBinaryExecutionEnv: () => ({})
}))

import { DirectoryTreeManager } from '../DirectoryTreeManager'

// Electron surfaces (`app.isPackaged`, etc.) are stubbed minimally because the
// import graph (logger, @main/utils' toAsarUnpackedPath) pulls them in
// transitively. The `file.tree.*` routes live in the IpcApi handler map now, so
// nothing here registers on `ipcMain`.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getAppPath: () => '/tmp'
  },
  ipcMain: {
    handle: () => {},
    removeHandler: () => {},
    on: () => {},
    removeListener: () => {}
  }
}))

/**
 * Minimal `WebContents`-shaped double. We only touch:
 *   - `id` (registry buckets by it)
 *   - `isDestroyed()` (mutation forwarder guards on it)
 *   - `send(channel, event, payload)` (where mutations land)
 *   - `once('destroyed', listener)` (orphan-cleanup hook)
 */
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

describe.skipIf(!ripgrepAvailable)('DirectoryTreeManager integration', () => {
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

  it('scans the root and hands every consumer the same snapshot', async () => {
    await writeFile(path.join(tmp, 'a.md'), 'a')

    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)

    expect(created1.treeId).not.toBe(created2.treeId)
    expect(created1.snapshot.path).toBe(created2.snapshot.path)
    expect(Object.keys(created1.snapshot.children ?? {})).toContain('a.md')
  })

  it('fans real watcher mutations out to every attached sender', async () => {
    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)
    expect(registry.activateTree(created1.treeId, created1.revision, sender1.id)).toBe(true)
    expect(registry.activateTree(created2.treeId, created2.revision, sender2.id)).toBe(true)

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
    expect(added1?.revision).toBe(created1.revision + 1)
    expect(added2?.revision).toBe(created2.revision + 1)
    expect(added1?.event).toEqual(added2?.event)
  })

  it('applies an explicit rename to the real builder and emits it to every consumer', async () => {
    await writeFile(path.join(tmp, 'old.md'), 'x')
    const sender1 = makeSender(1)
    const sender2 = makeSender(2)

    const created1 = await registry.create(sender1, tmp, undefined)
    const created2 = await registry.create(sender2, tmp, undefined)
    expect(registry.activateTree(created1.treeId, created1.revision, sender1.id)).toBe(true)
    expect(registry.activateTree(created2.treeId, created2.revision, sender2.id)).toBe(true)

    expect(registry.rename(created1.treeId, path.join(tmp, 'old.md'), 'new.md', sender1.id)).toBe(true)

    // Both consumers see the renamed mutation (shared builder fan-out).
    const renamed1 = sender1.sentMutations.find((p) => p.event.type === 'renamed')
    const renamed2 = sender2.sentMutations.find((p) => p.event.type === 'renamed')
    expect(renamed1?.treeId).toBe(created1.treeId)
    expect(renamed2?.treeId).toBe(created2.treeId)
    expect(renamed1?.event).toMatchObject({ newPath: `${tmp.replace(/\\/g, '/')}/new.md`, basename: 'new.md' })
  })
})
