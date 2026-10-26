import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import {
  runtimeId,
  type ContentItem,
  type MessageItem,
  type ObservationSink,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { AgentChildUpdate } from '@shared/ai/agentChildProjection'

import { ChildThreadProjection, savedChildView } from '../ChildThreadProjection'

const dbh = setupTestDatabase()
const projections: ChildThreadProjection[] = []
afterEach(async () => {
  for (const projection of projections.splice(0)) await projection.stop()
  vi.restoreAllMocks()
})

function fixture() {
  const workspaceId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: '/test', orderKey: 'a0' })
    .run()
  const root = randomUUID()
  dbh.db.insert(agentSessionTable).values({ id: root, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  const parent = contexts.preparePiBranch(root)
  const context = contexts.child(parent.id, 'child', 'child', 'spawn', 'Child')
  const thread = { backendId: runtimeId<'backend'>(parent.backendId), id: runtimeId<'thread'>('child') }
  let sink!: ObservationSink
  const handle: ThreadHandle = {
    thread,
    observe: async (consumer) => {
      sink = consumer
      await consumer({
        type: 'snapshot',
        coverage: 'live-only',
        items: [],
        inputs: [],
        activity: { scope: 'foreground', state: 'active' }
      })
      return { status: 'confirmed', value: { stop: async () => {} } }
    },
    release: async () => {
      throw new Error('Projection cannot release native access')
    }
  }
  const archive: { items: ContentItem[]; aliases: Record<string, string> } = { items: [], aliases: {} }
  let unavailable = false
  const projection = new ChildThreadProjection(context, handle, () => {
    if (unavailable) throw new Error('History temporarily unavailable')
    return archive
  })
  projections.push(projection)
  const item = (id: string, text: string, completeness: 'partial' | 'complete' = 'complete'): MessageItem => ({
    ref: { session: thread, id: runtimeId(id) },
    type: 'message',
    role: 'assistant',
    parts: [{ type: 'text', text }],
    completeness
  })
  return {
    context,
    archive,
    projection,
    item,
    send: (event: Parameters<ObservationSink>[0]) => sink(event),
    failHistory: (fail: boolean) => {
      unavailable = fail
    }
  }
}

// Catches a mutable SDK snapshot erasing the previous text before the transport computes a delta.
it('publishes incremental text before completion and keeps previously delivered views stable', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'item.upsert', item: { ...f.item('preview', '', 'partial'), parts: [] } })
  await f.projection.flush()
  const empty = f.projection.snapshot()
  await f.send({ type: 'item.upsert', item: f.item('preview', 'prefix', 'partial') })
  await f.projection.flush()
  expect(empty.messages[0].parts).toEqual([])
  const before = f.projection.snapshot()
  const updates: AgentChildUpdate[] = []
  f.projection.subscribe((update) => updates.push(update))
  await f.send({ type: 'item.upsert', item: f.item('preview', 'prefix suffix', 'partial') })
  await f.projection.flush()
  expect(before.messages[0].parts[0]).toMatchObject({ text: 'prefix' })
  expect(f.projection.snapshot().messages[0].parts[0]).toMatchObject({ text: 'prefix suffix' })
  expect(updates).toMatchObject([
    { patches: [{ type: 'append', messageId: before.messages[0].id, part: 0, text: ' suffix' }] }
  ])
})

// Catches late committed entries becoming hidden sibling branches or duplicating their live preview.
it('archives public observations and restores source order from committed evidence without a Pi handle', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'item.upsert', item: f.item('preview-last', 'last', 'partial') })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  f.archive.items = [f.item('entry-first', 'first'), f.item('entry-last', 'last')]
  f.archive.aliases = { 'entry-last': 'preview-last' }
  await f.send({ type: 'gap', reason: 'overflow' })
  await f.projection.flush()
  const expected = f.projection.snapshot().messages
  expect(expected.map((message) => message.parts[0])).toMatchObject([{ text: 'first' }, { text: 'last' }])
  expect(expected[1].id).toBe(id)
  expect(savedChildView(f.context).messages.map((message) => message.id)).toEqual(expected.map((message) => message.id))
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toEqual(expected)
  expect(() => messages.orderChildArchiveTx(dbh.db, f.context.sessionId, [id])).toThrow('retain every message')
})

// Catches committed tool calls remaining stuck in input-available until the entire child finishes.
it('updates an already committed tool call when its result arrives before the child becomes idle', async () => {
  const f = fixture()
  await f.projection.attach()
  const call: ContentItem = {
    type: 'tool-call',
    ref: f.item('live-call', '').ref,
    name: 'bash',
    argumentsText: '{"command":"pwd"}',
    completeness: 'complete'
  }
  const native = { ...call, ref: f.item('entry-call', '').ref }
  f.archive.items = [native]
  f.archive.aliases = { 'entry-call': 'live-call' }
  await f.send({ type: 'item.upsert', item: call })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  const result: ContentItem = {
    type: 'tool-result',
    ref: f.item('result', '').ref,
    call: native.ref,
    parts: [{ type: 'text', text: '/workspace' }],
    outcome: 'success'
  }
  f.archive.items = [native, result]
  await f.send({ type: 'item.upsert', item: { ...result, call: call.ref } })
  await f.projection.flush()
  expect(f.projection.snapshot().active).toBe(true)
  expect(f.projection.snapshot().messages).toMatchObject([
    { id, parts: [{ state: 'output-available', output: [{ type: 'text', text: '/workspace' }] }] }
  ])
})

// Catches a failed archive read being acknowledged as a settled product view or retried as native work.
it('keeps the last readable archive on recovery failure and explicitly retries only observation persistence', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'item.upsert', item: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const before = f.projection.snapshot().messages
  f.archive.items = [f.item('entry', 'complete')]
  f.archive.aliases = { entry: 'preview' }
  f.failHistory(true)
  await f.send({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
  await expect(f.projection.flush()).rejects.toThrow('temporarily unavailable')
  expect(f.projection.snapshot().messages).toEqual(before)
  f.failHistory(false)
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toMatchObject([{ id: before[0].id, parts: [{ text: 'complete' }] }])
  expect(savedChildView(f.context).messages).toMatchObject([{ id: before[0].id, parts: [{ text: 'complete' }] }])
})

// Catches an archive write failure advancing delivery or losing the live/native mapping needed for retry.
it('keeps failed writes unresolved and retries the same product row without resubmitting input', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'item.upsert', item: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const before = f.projection.snapshot()
  f.archive.items = [f.item('entry', 'finished')]
  f.archive.aliases = { entry: 'preview' }
  await f.send({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
  vi.spyOn(application.get('DbService'), 'withWriteTx').mockImplementationOnce(() => {
    throw new Error('Archive write failed')
  })
  await expect(f.projection.flush()).rejects.toThrow('Archive write failed')
  expect(f.projection.snapshot()).toBe(before)
  expect(savedChildView(f.context).messages[0].parts[0]).toMatchObject({ text: 'partial' })
  await f.projection.flush()
  expect(savedChildView(f.context).messages).toMatchObject([
    { id: before.messages[0].id, parts: [{ text: 'finished' }] }
  ])
})
