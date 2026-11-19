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
  const archives = new Map<string, Promise<void>>()

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
            await archives.get(target.thread.id)
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
  return { root, rootThread, residency, attaches, archives, child, relate, loaded, settled }
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

// Catches a reopen loading every unsettled child archive at once.
it('restores unseen idle children one at a time and settles each', async () => {
  const { root, rootThread, attaches, archives, child, relate, settled } = fixture()
  const first = child(root.id, 'first')
  const second = child(root.id, 'second')
  let unblock!: () => void
  archives.set('first', new Promise<void>((resolve) => (unblock = resolve)))
  relate(first, rootThread, 'idle')
  relate(second, rootThread, 'idle')
  await expect.poll(() => attaches).toEqual(['first'])
  await new Promise((resolve) => setImmediate(resolve))
  expect(attaches).toEqual(['first'])
  unblock()
  await expect.poll(() => settled(first) && settled(second)).toBe(true)
  expect(attaches).toEqual(['first', 'second'])
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
  const unpin = residency.command(resource)
  unview()
  unpin()
  await new Promise((resolve) => setImmediate(resolve))
  expect(await loaded(target)).toBe(true)
  relate(target, rootThread, 'idle')
  await expect.poll(() => settled(target)).toBe(true)
  expect(await loaded(target)).toBe(false)
})
