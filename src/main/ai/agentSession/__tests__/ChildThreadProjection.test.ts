import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { runtimeId, type RuntimeMessage, type ObservationSink, type ThreadHandle } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import type { AgentChildUpdate } from '@shared/ai/agentChildProjection'

import { ChildThreadProjection, savedChildView } from '../ChildThreadProjection'
import type { MessageDecorator } from '../ThreadMessageProjection'

const dbh = setupTestDatabase()
const projections: ChildThreadProjection[] = []
afterEach(async () => {
  for (const projection of projections.splice(0)) await projection.stop()
  vi.restoreAllMocks()
})

function fixture(beforeRead?: () => Promise<void>, decorate?: MessageDecorator) {
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
        messages: [],
        inputs: [],
        activity: { scope: 'foreground', state: 'active' }
      })
      return { status: 'confirmed', value: { stop: async () => {} } }
    },
    release: async () => {
      throw new Error('Projection cannot release native access')
    }
  }
  const archive: {
    messages: RuntimeMessage[]
    aliases: Record<string, string>
    legacy?: Record<string, { messageId: string; parts: number[] }>
  } = { messages: [], aliases: {} }
  let unavailable = false
  const projection = new ChildThreadProjection(
    context,
    handle,
    async () => {
      await beforeRead?.()
      if (unavailable) throw new Error('History temporarily unavailable')
      return archive
    },
    decorate
  )
  projections.push(projection)
  const item = (id: string, text: string, completeness: 'partial' | 'complete' = 'complete'): RuntimeMessage => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text, state: completeness === 'partial' ? 'streaming' : 'done' }],
    metadata: { completeness }
  })
  return {
    handle,
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

// Settled archive precedence must not suppress an explicit update to product display metadata.
it('refreshes committed child display metadata and persists it without new native content', async () => {
  let hidden = false
  const f = fixture(undefined, (message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'text' && hidden ? { ...part, text: part.text.replace(' reminder', '') } : part
    )
  }))
  await f.projection.attach()
  f.archive.messages = [f.item('native', 'Visible reminder')]
  f.archive.aliases = { native: 'native' }
  await f.send({ type: 'message.upsert', message: f.archive.messages[0] })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  hidden = true
  await f.projection.refreshDecoration(['native'])
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toMatchObject([{ id, parts: [{ text: 'Visible' }] }])
  expect(savedChildView(f.context).messages).toMatchObject([{ id, parts: [{ text: 'Visible' }] }])
})

// Native retraction must survive a stale archive replay; old rows remain retained off the active path.
it('persists explicit removals and does not resurrect them after reopening', async () => {
  const f = fixture()
  await f.projection.attach()
  f.archive.messages = [f.item('native-1', 'withdrawn'), f.item('native-2', 'retained')]
  f.archive.aliases = { 'native-1': 'native-1', 'native-2': 'native-2' }
  for (const item of f.archive.messages) await f.send({ type: 'message.upsert', message: item })
  await f.projection.flush()
  const retained = f.projection.snapshot().messages[1].id
  await f.send({ type: 'message.remove', ref: { session: f.handle.thread, id: runtimeId('native-1') } })
  await f.projection.flush()
  expect(savedChildView(f.context).messages.map((message) => message.id)).toEqual([retained])
  await f.projection.stop()
  projections.splice(projections.indexOf(f.projection), 1)
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => f.archive)
  projections.push(reopened)
  await reopened.attach()
  expect(reopened.snapshot().messages).toMatchObject([{ id: retained, parts: [{ text: 'retained' }] }])
})

// A committed UUID replaces its streaming identity without creating a second product row.
it('keeps the product identity when a native committed block replaces a preview', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.upsert', message: f.item('preview', 'part', 'partial') })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  f.archive.messages = [f.item('canonical', 'complete')]
  f.archive.aliases = { canonical: 'canonical' }
  await f.send({
    type: 'message.upsert',
    message: f.archive.messages[0],
    replaces: [{ session: f.handle.thread, id: runtimeId('preview') }]
  })
  await f.projection.flush()
  expect(savedChildView(f.context).messages).toMatchObject([{ id, parts: [{ text: 'complete' }] }])
})

// Catches asynchronous native archives losing a completion that arrives while the previous read is in flight.
it('serializes asynchronous archives with live completion and retains the preview identity', async () => {
  let release: (() => void) | undefined
  const f = fixture(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const attach = f.projection.attach()
  await expect.poll(() => release !== undefined).toBe(true)
  release!()
  await attach
  await f.send({ type: 'message.upsert', message: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  await f.send({
    type: 'snapshot',
    coverage: 'current-view',
    messages: [f.item('preview', 'partial', 'partial')],
    inputs: [],
    activity: { scope: 'foreground', state: 'active' }
  })
  release = undefined
  const pending = f.projection.flush()
  await expect.poll(() => release !== undefined).toBe(true)
  f.archive.messages = [f.item('entry', 'complete')]
  f.archive.aliases = { entry: 'preview' }
  await f.send({
    type: 'snapshot',
    coverage: 'current-view',
    messages: f.archive.messages,
    inputs: [],
    activity: { scope: 'foreground', state: 'idle' }
  })
  release!()
  await pending
  release = undefined
  const closing = f.projection.stop()
  await expect.poll(() => release !== undefined).toBe(true)
  release!()
  await closing
  projections.splice(projections.indexOf(f.projection), 1)
  expect(savedChildView(f.context).messages).toMatchObject([
    { id, parts: [{ type: 'text', text: 'complete', state: 'done' }] }
  ])
})

// Catches a mutable SDK snapshot erasing the previous text before the transport computes a delta.
it('publishes incremental text before completion and keeps previously delivered views stable', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.upsert', message: { ...f.item('preview', '', 'partial'), parts: [] } })
  await f.projection.flush()
  const empty = f.projection.snapshot()
  await f.send({ type: 'message.upsert', message: f.item('preview', 'prefix', 'partial') })
  await f.projection.flush()
  expect(empty.messages[0].parts).toEqual([])
  const before = f.projection.snapshot()
  expect(before.messages[0].metadata?.status).toBe('pending')
  const updates: AgentChildUpdate[] = []
  f.projection.subscribe((update) => updates.push(update))
  await f.send({ type: 'message.upsert', message: f.item('preview', 'prefix suffix', 'partial') })
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
  await f.send({ type: 'message.upsert', message: f.item('preview-last', 'last', 'partial') })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  f.archive.messages = [f.item('entry-first', 'first'), f.item('entry-last', 'last')]
  f.archive.aliases = { 'entry-last': 'preview-last' }
  await f.send({ type: 'gap', reason: 'overflow' })
  await f.projection.flush()
  const expected = f.projection.snapshot().messages
  expect(expected.map((message) => message.parts[0])).toMatchObject([{ text: 'first' }, { text: 'last' }])
  expect(expected[1].id).toBe(id)
  expect(savedChildView(f.context).messages.map((message) => message.id)).toEqual(expected.map((message) => message.id))
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toEqual(expected)
  expect(() => messages.orderChildArchiveTx(dbh.db, f.context.sessionId, [id])).toThrow(
    'retain messages without explicit removal'
  )
})

// Catches committed tool calls remaining stuck in input-available until the entire child finishes.
it('updates a committed message with preliminary and final tool output while the child stays active', async () => {
  const f = fixture()
  await f.projection.attach()
  const call = {
    type: 'dynamic-tool' as const,
    toolCallId: 'call',
    toolName: 'bash',
    input: { command: 'pwd' },
    state: 'input-available' as const
  }
  const native: RuntimeMessage = {
    id: 'entry-call',
    role: 'assistant',
    metadata: { completeness: 'complete' },
    parts: [call]
  }
  f.archive.messages = [native]
  f.archive.aliases = { 'entry-call': 'live-call' }
  await f.send({ type: 'message.upsert', message: { ...native, id: 'live-call' } })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  expect(savedChildView(contexts.context(f.context.id)).messages[0].metadata?.status).toBe('pending')
  await f.send({
    type: 'message.upsert',
    message: {
      ...native,
      id: 'live-call',
      parts: [{ ...call, state: 'output-available', output: 'FIRST', preliminary: true }]
    }
  })
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toMatchObject([
    { id, metadata: { status: 'pending' }, parts: [{ output: 'FIRST', preliminary: true }] }
  ])
  f.archive.messages = [
    { ...native, parts: [{ ...call, state: 'output-available', output: 'FIRST\nLAST', preliminary: false }] }
  ]
  await f.send({ type: 'message.upsert', message: { ...f.archive.messages[0], id: 'live-call' } })
  await f.projection.flush()
  expect(f.projection.snapshot().active).toBe(true)
  expect(f.projection.snapshot().messages).toMatchObject([
    { id, parts: [{ state: 'output-available', output: 'FIRST\nLAST', preliminary: false }] }
  ])
  expect(savedChildView(contexts.context(f.context.id)).messages[0].parts[0]).toMatchObject({ output: 'FIRST\nLAST' })
})

// Catches a failed archive read being acknowledged as a settled product view or retried as native work.
it('keeps the last readable archive on recovery failure and explicitly retries only observation persistence', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.upsert', message: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const before = f.projection.snapshot().messages
  f.archive.messages = [f.item('entry', 'complete')]
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
  await f.send({ type: 'message.upsert', message: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const before = f.projection.snapshot()
  f.archive.messages = [f.item('entry', 'finished')]
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

// Queued user input cannot change reply ownership before the harness places it.
it('composes native messages by placed input boundaries and restores the same child replies', async () => {
  const f = fixture()
  const prompt = { ...f.item('prompt', 'Inspect'), role: 'user' as const }
  f.archive.messages = [prompt, f.item('narration', 'Before')]
  await f.projection.attach()
  const first = f.projection.snapshot().messages[1].id
  await f.send({ type: 'input.changed', input: { inputId: runtimeId('queued'), facts: ['accepted', 'queued'] } })
  const continuation = f.item('continued', 'Still the first reply')
  f.archive.messages.push(continuation)
  await f.send({ type: 'message.upsert', message: continuation })
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toMatchObject([
    { role: 'user' },
    { id: first, parts: [{ text: 'Before' }, { text: 'Still the first reply' }] }
  ])
  const steer = { ...f.item('steer', 'Change direction'), role: 'user' as const }
  const second = f.item('after-steer', 'New reply')
  f.archive.messages.push(steer, second)
  await f.send({ type: 'message.upsert', message: steer })
  await f.send({ type: 'message.upsert', message: second })
  await f.send({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
  await f.projection.flush()
  const view = f.projection.snapshot().messages
  expect(view.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(view[1].id).toBe(first)
  expect(view[3].id).not.toBe(first)
  expect(savedChildView(contexts.context(f.context.id)).messages).toEqual(view)
  expect(readAgentSessionPath(dbh.db, f.context.sessionId)).toHaveLength(5)
})

// Native evidence changes display composition, never the IDs or branch edges of existing rows.
it('projects legacy split rows in native order and preserves their persisted identity', async () => {
  const f = fixture()
  await f.projection.stop()
  projections.splice(projections.indexOf(f.projection), 1)
  const textId = randomUUID()
  const toolId = randomUUID()
  const tool = {
    type: 'dynamic-tool' as const,
    toolCallId: 'call',
    toolName: 'Bash',
    input: {},
    state: 'output-available' as const,
    output: 'done'
  }
  application.get('DbService').withWriteTx((tx) => {
    messages.saveMessagesTx(tx, {
      sessionId: f.context.sessionId,
      parentId: f.context.anchorMessageId!,
      messages: [
        {
          id: textId,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              { type: 'text', text: 'Before', state: 'done' },
              { type: 'text', text: 'After', state: 'done' }
            ]
          }
        },
        { id: toolId, role: 'assistant', status: 'success', data: { parts: [tool] } }
      ]
    })
    contexts.saveProjectionTx(tx, f.context.id, { native: textId, 'native:call:call': toolId })
  })
  const before = readAgentSessionPath(dbh.db, f.context.sessionId).map(({ id, parentId, data }) => ({
    id,
    parentId,
    data
  }))
  f.archive.messages = [
    {
      ...f.item('native', 'Before'),
      parts: [{ type: 'text', text: 'Before', state: 'done' }, tool, { type: 'text', text: 'After', state: 'done' }]
    }
  ]
  f.archive.legacy = {
    native: { messageId: 'native', parts: [0, 2] },
    'native:call:call': { messageId: 'native', parts: [1] }
  }
  const restored = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => f.archive)
  projections.push(restored)
  await restored.attach()
  expect(restored.snapshot().messages).toMatchObject([
    { id: textId, parts: [{ text: 'Before' }, { toolCallId: 'call', output: 'done' }, { text: 'After' }] }
  ])
  const after = readAgentSessionPath(dbh.db, f.context.sessionId).map(({ id, parentId, data }) => ({
    id,
    parentId,
    data
  }))
  expect(after).toEqual(before)
  const context = contexts.context(f.context.id)
  expect(context.checkpointMapping?.projectionVersion).toBe(2)
  expect(savedChildView(context).messages).toEqual(restored.snapshot().messages)
})
