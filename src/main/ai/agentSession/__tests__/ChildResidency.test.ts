import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { expect, it } from 'vitest'

import { runtimeId, type Subagent, type Thread, type ThreadHandle } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'

import { childKey, ChildResidency } from '../ChildResidency'
import { ChildThreadProjection } from '../ChildThreadProjection'

const dbh = setupTestDatabase()

type Child = { contextId: string; thread: Thread; key: string }

function fixture() {
  const workspaceId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: `/test/${workspaceId}`, orderKey: 'a0' })
    .run()
  const sessionId = randomUUID()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  const root = preparePiBranch(sessionId)
  const rootThread: Thread = { backendId: runtimeId(root.backendId), id: runtimeId(root.nativeThreadId!) }
  const residency = new ChildResidency<{ release(): Promise<void> }>({ accepting: () => true, closing: () => false })
  const attaches: string[] = []
  // Archive reads per child, and gates keyed by child and read number (the last read is the release's final flush)
  // or by `${child}:build` for the build.
  const reads = new Map<string, number>()
  const gates = new Map<string, Promise<void>>()
  const gate = (key: string) => {
    let open!: () => void
    gates.set(key, new Promise<void>((resolve) => (open = resolve)))
    return open
  }
  /** Children whose next acquire fails, and native handle releases per child. */
  const failures = new Set<string>()
  const handleReleases = new Map<string, number>()
  /** One-shot hooks run when a child's observation drains. */
  const drains = new Map<string, () => void>()
  /** The native revision each child's archive reads report. */
  const revisions = new Map<string, number>()

  const child = (parentContextId: string, id: string): Child => {
    const context = contexts.child(parentContextId, id, `call-${id}`, id)
    const thread: Thread = { backendId: runtimeId(context.backendId), id: runtimeId(id) }
    return { contextId: context.id, thread, key: childKey(thread.backendId, thread.id) }
  }
  const handle = (thread: Thread): ThreadHandle => ({
    thread,
    contextUsage: async () => ({
      status: 'unsupported',
      error: { operation: 'contextUsage', code: 'f', message: 'f' }
    }),
    observe: async (sink) => {
      await sink({ type: 'snapshot', messages: [], inputs: [], activity: { state: 'idle' } })
      const drain = async () => {
        const hook = drains.get(thread.id)
        drains.delete(thread.id)
        hook?.()
      }
      return { status: 'confirmed', value: { drain, stop: async () => {} } }
    },
    release: async () => {}
  })
  const relation = (target: Child, parent: Thread, work: Subagent['work'], revision?: number): Subagent => ({
    id: runtimeId(target.thread.id),
    parent,
    child: target.thread,
    origin: { toolCallId: `call-${target.thread.id}` },
    work,
    revision
  })
  const open = (target: Child, parent: Thread, granted?: { release(): Promise<void> }) => () =>
    residency.open(target.key, {
      granted,
      acquire: async () => {
        if (failures.delete(target.thread.id)) throw new Error('acquire failed')
        const id = target.thread.id
        return { release: async () => void handleReleases.set(id, (handleReleases.get(id) ?? 0) + 1) }
      },
      build: async (_handle, hold) => {
        attaches.push(target.thread.id)
        hold(relation(target, parent, undefined))
        await gates.get(`${target.thread.id}:build`)
        const projection = new ChildThreadProjection(
          contexts.context(target.contextId),
          handle(target.thread),
          async () => {
            const read = (reads.get(target.thread.id) ?? 0) + 1
            reads.set(target.thread.id, read)
            await gates.get(`${target.thread.id}:${read}`)
            return { messages: [], aliases: {}, revision: revisions.get(target.thread.id) }
          }
        )
        return { relation: relation(target, parent, undefined), projection }
      }
    })
  const relate = (target: Child, parent: Thread, work: Subagent['work'], revision?: number) =>
    residency.relate(relation(target, parent, work, revision), open(target, parent))
  const loaded = async (target: Child) => (await residency.resource(target.key)) !== undefined
  const settled = (target: Child) => contexts.context(target.contextId).checkpointMapping?.child?.settled === true
  const savedRevision = (target: Child) => contexts.context(target.contextId).checkpointMapping?.child?.settledRevision
  return {
    root,
    rootThread,
    residency,
    attaches,
    reads,
    gates,
    gate,
    failures,
    handleReleases,
    drains,
    revisions,
    child,
    open,
    relate,
    loaded,
    settled,
    savedRevision
  }
}

// Catches a nested child losing its relationship stream because its parent child was released first.
it('keeps a parent child loaded while its nested child works and releases both after it ends', async () => {
  const { root, rootThread, child, relate, loaded, settled } = fixture()
  const parent = child(root.id, 'parent')
  const nested = child(parent.contextId, 'nested')
  relate(parent, rootThread, 'running')
  await expect.poll(() => loaded(parent)).toBe(true)
  relate(nested, parent.thread, 'running')
  await expect.poll(() => loaded(nested)).toBe(true)
  relate(parent, rootThread, 'idle')
  await new Promise((resolve) => setImmediate(resolve))
  expect(await loaded(parent)).toBe(true)
  relate(nested, parent.thread, 'idle')
  await expect.poll(() => settled(nested) && settled(parent)).toBe(true)
  expect(await loaded(nested)).toBe(false)
  expect(await loaded(parent)).toBe(false)
})

// Catches archive replays reloading every settled child, and a resumed child staying unobserved.
it('reloads a released child when its parent reports it working, not on an idle replay', async () => {
  const { root, rootThread, attaches, child, relate, loaded, settled } = fixture()
  const target = child(root.id, 'target')
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  relate(target, rootThread, 'idle')
  await expect.poll(() => settled(target)).toBe(true)
  relate(target, rootThread, 'idle')
  await new Promise((resolve) => setImmediate(resolve))
  expect(attaches).toEqual(['target'])
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  expect(attaches).toEqual(['target', 'target'])
  expect(settled(target)).toBe(false)
})

// Catches a reopen loading the next child archive before the previous child has flushed and released.
it('restores unseen idle children one at a time and settles each', async () => {
  const { root, rootThread, attaches, reads, gates, child, relate, loaded, settled } = fixture()
  const first = child(root.id, 'first')
  const second = child(root.id, 'second')
  let unblock!: () => void
  gates.set('first:2', new Promise<void>((resolve) => (unblock = resolve)))
  relate(first, rootThread, 'idle')
  relate(second, rootThread, 'idle')
  await expect.poll(() => reads.get('first')).toBe(2)
  await new Promise((resolve) => setImmediate(resolve))
  expect(attaches).toEqual(['first'])
  expect(settled(first)).toBe(false)
  unblock()
  await expect.poll(() => settled(first) && settled(second)).toBe(true)
  expect(attaches).toEqual(['first', 'second'])
  expect(await loaded(first)).toBe(false)
})

// Catches a command's child being released on idle evidence read before the command's input.
it('keeps a commanded child loaded until a relationship after the command reports idle', async () => {
  const { root, rootThread, residency, child, relate, loaded, settled } = fixture()
  const target = child(root.id, 'target')
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  const resource = (await residency.resource(target.key))!
  const unview = residency.pin(resource)
  relate(target, rootThread, 'idle')
  const done = residency.command(resource)
  unview()
  done(true)
  await new Promise((resolve) => setImmediate(resolve))
  expect(await loaded(target)).toBe(true)
  relate(target, rootThread, 'idle')
  await expect.poll(() => settled(target)).toBe(true)
  expect(await loaded(target)).toBe(false)
})

// Catches a refused command clearing the child's idle evidence and leaving it loaded until the root closes.
it('releases a child whose command input was refused', async () => {
  const { root, rootThread, residency, child, relate, loaded, settled } = fixture()
  const target = child(root.id, 'target')
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  const resource = (await residency.resource(target.key))!
  const unview = residency.pin(resource)
  relate(target, rootThread, 'idle')
  const done = residency.command(resource)
  unview()
  done(false)
  await expect.poll(() => settled(target)).toBe(true)
  expect(await loaded(target)).toBe(false)
})

// Catches a backup drain returning while a queued restore or a release's final flush can still write.
it('drains queued restores and the final flushes of the releases they start', async () => {
  const { root, rootThread, residency, gates, child, relate, settled } = fixture()
  const first = child(root.id, 'first')
  const second = child(root.id, 'second')
  let unblock!: () => void
  gates.set('first:2', new Promise<void>((resolve) => (unblock = resolve)))
  relate(first, rootThread, 'idle')
  relate(second, rootThread, 'idle')
  let drained = false
  const drain = residency.drain().then(() => (drained = true))
  await new Promise((resolve) => setImmediate(resolve))
  expect(drained).toBe(false)
  unblock()
  await drain
  expect(settled(first) && settled(second)).toBe(true)
})

// Catches a parent releasing while its nested child's build or attach awaits the archive, stranding the nested child.
it('keeps a parent child loaded while its nested child builds and attaches', async () => {
  const { root, rootThread, attaches, gate, child, relate, loaded, settled } = fixture()
  const parent = child(root.id, 'parent')
  const nested = child(parent.contextId, 'nested')
  relate(parent, rootThread, 'running')
  await expect.poll(() => loaded(parent)).toBe(true)
  const finishBuild = gate('nested:build')
  relate(nested, parent.thread, 'running')
  await expect.poll(() => attaches).toEqual(['parent', 'nested'])
  relate(parent, rootThread, 'idle')
  expect(await loaded(parent)).toBe(true)
  finishBuild()
  await expect.poll(() => loaded(nested)).toBe(true)
  relate(nested, parent.thread, 'idle')
  await expect.poll(() => settled(nested) && settled(parent)).toBe(true)
})

// Catches a settled parent hiding an unsettled nested child, whose relationship only its observation carries.
it('restores a settled child with an unsettled descendant and leaves settled subtrees released', async () => {
  const { root, rootThread, residency, attaches, child, relate, settled } = fixture()
  const parent = child(root.id, 'parent')
  const nested = child(parent.contextId, 'nested')
  const done = child(root.id, 'done')
  contexts.settleChild(parent.contextId, true)
  contexts.settleChild(done.contextId, true)
  residency.restoreReleased(root.id)
  relate(done, rootThread, 'idle')
  relate(parent, rootThread, 'idle')
  await expect.poll(() => attaches).toEqual(['parent'])
  relate(nested, parent.thread, 'idle')
  await expect.poll(() => settled(nested) && settled(parent)).toBe(true)
  expect(attaches).toEqual(['parent', 'nested'])
})

// Catches Stop finding no child while a resumed child's previous release is still flushing.
it('resolves a releasing child that works again to its reopened resource', async () => {
  const { root, rootThread, residency, reads, gates, child, relate, loaded } = fixture()
  const target = child(root.id, 'target')
  let unblock!: () => void
  gates.set('target:2', new Promise<void>((resolve) => (unblock = resolve)))
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  relate(target, rootThread, 'idle')
  await expect.poll(() => reads.get('target')).toBe(2)
  relate(target, rootThread, 'running')
  const found = residency.resource(target.key)
  unblock()
  expect(await found).toBeDefined()
})

// Catches a lookup that waits on another child's attach and then returns a child released meanwhile.
it('returns a pinned, current child from a lookup that waited on another attach', async () => {
  const { root, rootThread, residency, attaches, reads, gates, child, open, relate, loaded, settled } = fixture()
  const target = child(root.id, 'target')
  const other = child(root.id, 'other')
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  let unblock!: () => void
  gates.set('other:1', new Promise<void>((resolve) => (unblock = resolve)))
  relate(other, rootThread, 'running')
  await expect.poll(() => reads.get('other')).toBe(1)
  const lookup = residency.forContext(target.contextId, () => open(target, rootThread)())
  relate(target, rootThread, 'idle')
  unblock()
  const found = await lookup
  expect(await residency.resource(target.key)).toBe(found?.child)
  expect(attaches.filter((id) => id === 'target')).toHaveLength(2)
  found!.unpin()
  await expect.poll(() => settled(target)).toBe(true)
})

// Catches the next restore loading while a parent that a restored nested child unpinned is still flushing.
it('waits for the parent release a restored nested child sets off before the next restore', async () => {
  const { root, rootThread, attaches, reads, gate, child, relate, loaded, settled } = fixture()
  const parent = child(root.id, 'parent')
  const nested = child(parent.contextId, 'nested')
  const next = child(root.id, 'next')
  relate(parent, rootThread, 'running')
  await expect.poll(() => loaded(parent)).toBe(true)
  const finishNested = gate('nested:2')
  const finishParent = gate('parent:2')
  relate(nested, parent.thread, 'idle')
  relate(next, rootThread, 'idle')
  await expect.poll(() => reads.get('nested')).toBe(2)
  relate(parent, rootThread, 'idle')
  finishNested()
  await expect.poll(() => reads.get('parent')).toBe(2)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(attaches).toEqual(['parent', 'nested'])
  finishParent()
  await expect.poll(() => settled(next)).toBe(true)
  expect(settled(parent) && settled(nested)).toBe(true)
})

// Catches a child marked settled though work resumed, so neither a replay nor a cold reopen repaired its saved rows.
it('leaves a child that works again unsettled and restores it after a failed reopen', async () => {
  const { root, rootThread, attaches, reads, gate, failures, child, relate, loaded, settled } = fixture()
  const target = child(root.id, 'target')
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  const finishFlush = gate('target:2')
  relate(target, rootThread, 'idle')
  await expect.poll(() => reads.get('target')).toBe(2)
  failures.add('target')
  relate(target, rootThread, 'running')
  finishFlush()
  await expect.poll(() => failures.size).toBe(0)
  await new Promise((resolve) => setImmediate(resolve))
  expect(settled(target)).toBe(false)
  relate(target, rootThread, 'idle')
  await expect.poll(() => settled(target)).toBe(true)
  expect(attaches).toEqual(['target', 'target'])
  // A released child that works again and fails to reopen is restored the same way.
  failures.add('target')
  relate(target, rootThread, 'running')
  await expect.poll(() => failures.size).toBe(0)
  await new Promise((resolve) => setImmediate(resolve))
  expect(settled(target)).toBe(false)
  relate(target, rootThread, 'idle')
  await expect.poll(() => attaches).toEqual(['target', 'target', 'target'])
  await expect.poll(() => settled(target)).toBe(true)
})

// Catches a backup drain returning while a restore that a parent's projection drain queued can still write.
it('drains the restores a loaded parent queues while its projection drains', async () => {
  const { root, rootThread, residency, drains, child, relate, loaded, settled } = fixture()
  const parent = child(root.id, 'parent')
  const late = child(parent.contextId, 'late')
  relate(parent, rootThread, 'running')
  await expect.poll(() => loaded(parent)).toBe(true)
  drains.set('parent', () => relate(late, parent.thread, 'idle'))
  await residency.drain()
  expect(settled(late)).toBe(true)
})

// Catches a viewer receiving a child that was released while its redundant native handle closed.
it('returns the current child when it releases while a redundant handle closes', async () => {
  const { root, rootThread, residency, child, open, relate, loaded } = fixture()
  const target = child(root.id, 'target')
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  let closeHandle: (() => void) | undefined
  const granted = { release: () => new Promise<void>((resolve) => (closeHandle = resolve)) }
  const opened = open(target, rootThread, granted)()
  await expect.poll(() => closeHandle).toBeDefined()
  relate(target, rootThread, 'idle')
  closeHandle!()
  const current = await opened
  expect(current).toBeDefined()
  expect(await residency.resource(target.key)).toBe(current)
})

// Catches concurrent opens each retrying a failed release flush and releasing the same native handle twice, and an
// automatic reopen's failure going unhandled.
it('shares one retry of a failed release flush between opens and reports a repeated failure', async () => {
  const { root, rootThread, attaches, reads, gates, gate, handleReleases, child, open, relate, loaded } = fixture()
  const target = child(root.id, 'target')
  const fail = (read: number) => {
    const failed = Promise.reject(new Error('flush failed'))
    failed.catch(() => {})
    gates.set(`target:${read}`, failed)
  }
  relate(target, rootThread, 'running')
  await expect.poll(() => loaded(target)).toBe(true)
  fail(2)
  relate(target, rootThread, 'idle')
  await expect.poll(() => reads.get('target')).toBe(2)
  fail(3)
  relate(target, rootThread, 'running')
  await expect.poll(() => reads.get('target')).toBe(3)
  const finishRetry = gate('target:4')
  const first = open(target, rootThread)()
  const second = open(target, rootThread)()
  await expect.poll(() => reads.get('target')).toBe(4)
  finishRetry()
  const reopened = await first
  expect(reopened).toBeDefined()
  expect(await second).toBe(reopened)
  expect(attaches).toEqual(['target', 'target'])
  expect(handleReleases.get('target')).toBe(1)
})

// Catches a child whose history grew after its final flush staying released with stale saved rows.
it('reloads a released child when a relationship reports a newer revision than its final flush read', async () => {
  const { root, rootThread, attaches, revisions, child, relate, loaded, savedRevision } = fixture()
  const target = child(root.id, 'target')
  revisions.set('target', 4)
  relate(target, rootThread, 'running', 2)
  await expect.poll(() => loaded(target)).toBe(true)
  relate(target, rootThread, 'idle', 4)
  await expect.poll(() => savedRevision(target)).toBe(4)
  relate(target, rootThread, 'idle', 4)
  await new Promise((resolve) => setImmediate(resolve))
  expect(attaches).toEqual(['target'])
  revisions.set('target', 6)
  relate(target, rootThread, 'idle', 6)
  await expect.poll(() => savedRevision(target)).toBe(6)
  expect(attaches).toEqual(['target', 'target'])
  expect(await loaded(target)).toBe(false)
})

// Catches a cold reopen trusting a settled marker that is older than the child's native history.
it('restores a settled child on reopen only when its native revision is newer than the saved one', async () => {
  const { root, rootThread, residency, attaches, revisions, child, relate, savedRevision } = fixture()
  const current = child(root.id, 'current')
  const stale = child(root.id, 'stale')
  contexts.settleChild(current.contextId, true, 3)
  contexts.settleChild(stale.contextId, true, 3)
  residency.restoreReleased(root.id)
  revisions.set('stale', 5)
  relate(current, rootThread, 'idle', 3)
  relate(stale, rootThread, 'idle', 5)
  await expect.poll(() => savedRevision(stale)).toBe(5)
  await residency.drain()
  expect(attaches).toEqual(['stale'])
  expect(savedRevision(current)).toBe(3)
})
