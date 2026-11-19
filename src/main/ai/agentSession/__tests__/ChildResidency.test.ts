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
  // Archive reads per child, and gates keyed by child and read number (the last read is the release's final flush).
  const reads = new Map<string, number>()
  const gates = new Map<string, Promise<void>>()

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
      return { status: 'confirmed', value: { drain: async () => {}, stop: async () => {} } }
    },
    release: async () => {}
  })
  const relation = (target: Child, parent: Thread, work: Subagent['work']): Subagent => ({
    id: runtimeId(target.thread.id),
    parent,
    child: target.thread,
    origin: { toolCallId: `call-${target.thread.id}` },
    work
  })
  const open = (target: Child, parent: Thread) => () =>
    residency.open(target.key, {
      acquire: async () => ({ release: async () => {} }),
      build: async () => {
        attaches.push(target.thread.id)
        const projection = new ChildThreadProjection(
          contexts.context(target.contextId),
          handle(target.thread),
          async () => {
            const read = (reads.get(target.thread.id) ?? 0) + 1
            reads.set(target.thread.id, read)
            await gates.get(`${target.thread.id}:${read}`)
            return { messages: [], aliases: {} }
          }
        )
        return { relation: relation(target, parent, undefined), projection }
      }
    })
  const relate = (target: Child, parent: Thread, work: Subagent['work']) =>
    residency.relate(relation(target, parent, work), open(target, parent))
  const loaded = async (target: Child) => (await residency.resource(target.key)) !== undefined
  const settled = (target: Child) => contexts.context(target.contextId).checkpointMapping?.child?.settled === true
  return { root, rootThread, residency, attaches, reads, gates, child, open, relate, loaded, settled }
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

// Catches a parent releasing while its nested child's attach awaits the archive, stranding the nested child.
it('keeps a parent child loaded while its nested child attaches', async () => {
  const { root, rootThread, reads, gates, child, relate, loaded, settled } = fixture()
  const parent = child(root.id, 'parent')
  const nested = child(parent.contextId, 'nested')
  relate(parent, rootThread, 'running')
  await expect.poll(() => loaded(parent)).toBe(true)
  let unblock!: () => void
  gates.set('nested:1', new Promise<void>((resolve) => (unblock = resolve)))
  relate(nested, parent.thread, 'running')
  await expect.poll(() => reads.get('nested')).toBe(1)
  relate(parent, rootThread, 'idle')
  expect(await loaded(parent)).toBe(true)
  unblock()
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
