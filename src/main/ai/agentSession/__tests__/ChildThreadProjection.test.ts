import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import {
  runtimeId,
  ThreadFeed,
  type RuntimeMessage,
  type ObservationSink,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import { preparePiBranch, reservePiBranchTx } from '@main/ai/runtime/pi/piContext'
import type { AgentChildUpdate } from '@shared/ai/agentChildProjection'

import { savedChildView } from '../childArchive'
import { ChildThreadProjection } from '../ChildThreadProjection'
import { prepareNativeSubmission } from '../nativeSubmission'
import type { MessageDecorator } from '../ThreadMessageProjection'

const dbh = setupTestDatabase()
const projections: ChildThreadProjection[] = []
function inputPosition(id: string): number | null {
  return (dbh.sqlite.prepare('SELECT pos FROM agent_session_message WHERE id = ?').get(id) as { pos: number | null })
    .pos
}
afterEach(async () => {
  for (const projection of projections.splice(0)) await projection.stop()
  vi.restoreAllMocks()
})

function fixture(
  beforeRead?: () => Promise<void>,
  decorate?: MessageDecorator,
  decorateLive?: ConstructorParameters<typeof ChildThreadProjection>[5]
) {
  const workspaceId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: `/test/${workspaceId}`, orderKey: 'a0' })
    .run()
  const root = randomUUID()
  dbh.db.insert(agentSessionTable).values({ id: root, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  const parent = preparePiBranch(root)
  const context = contexts.child(parent.id, 'child', 'spawn', 'Child')
  const thread = { backendId: runtimeId<'backend'>(parent.backendId), id: runtimeId<'thread'>('child') }
  let sink!: ObservationSink
  const handle: ThreadHandle = {
    thread,
    contextUsage: async () => ({
      status: 'unsupported',
      error: { operation: 'contextUsage', code: 'fixture', message: 'Observation-only fixture' }
    }),
    observe: async (consumer) => {
      sink = consumer
      await consumer({
        type: 'snapshot',
        messages: [],
        inputs: [],
        activity: { state: 'active' }
      })
      return { status: 'confirmed', value: { drain: async () => {}, stop: async () => {} } }
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
    decorate,
    undefined,
    decorateLive
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

it('schedules child message refreshes only for content or state changes', async () => {
  const f = fixture()
  await f.projection.attach()
  vi.useFakeTimers()
  try {
    const flush = vi.spyOn(f.projection, 'flush')
    await f.send({
      type: 'subagent.upsert',
      subagent: { id: runtimeId('grandchild'), parent: f.handle.thread }
    })
    await vi.runAllTimersAsync()
    expect(flush).toHaveBeenCalledTimes(0)

    await f.send({ type: 'message.reconcile', message: f.item('answer', 'Still streaming', 'partial') })
    await vi.runAllTimersAsync()
    expect(f.projection.snapshot().messages).toMatchObject([{ parts: [{ text: 'Still streaming' }] }])
  } finally {
    vi.useRealTimers()
  }
})

it.each(['', 'partial answer'])(
  'keeps a failed child reply and its cause through archive recovery (%j)',
  async (text) => {
    const f = fixture()
    await f.projection.attach()
    const failed = {
      ...f.item('failure', text),
      parts: text ? f.item('failure', text).parts : [],
      metadata: {
        completeness: 'complete' as const,
        error: { operation: 'input', code: 'model-error', message: '429: CONCURRENCY_LIMITED' }
      }
    }
    await f.send({ type: 'message.reconcile', message: failed })
    await f.projection.flush()
    const expected = {
      parts: [
        ...(text ? [{ type: 'text', text, state: 'done' }] : []),
        { type: 'data-error', data: { message: '429: CONCURRENCY_LIMITED', reason: 'model-error' } }
      ]
    }
    expect(f.projection.snapshot().messages).toMatchObject([expected])
    f.archive.messages = [failed]
    f.archive.aliases = { failure: 'failure' }
    await f.send({ type: 'activity.changed', activity: { state: 'idle' } })
    await f.projection.flush()
    expect(savedChildView(contexts.context(f.context.id)).messages).toMatchObject([expected])
    await f.projection.stop()
    const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => f.archive)
    projections.push(reopened)
    await reopened.attach()
    expect(reopened.snapshot().messages).toMatchObject([expected])
  }
)

it('retains a failed attempt after the native input completes successfully', async () => {
  const f = fixture()
  const prompt: RuntimeMessage = { ...f.item('prompt', 'Inspect'), role: 'user' }
  const failed: RuntimeMessage = {
    ...f.item('attempt', ''),
    parts: [],
    metadata: {
      completeness: 'complete',
      error: { operation: 'input', code: 'model-error', message: '429: CONCURRENCY_LIMITED' }
    }
  }
  f.archive.messages = [prompt, failed]
  await f.projection.attach()
  const answer = f.item('answer', 'Recovered')
  f.archive.messages = [prompt, failed, answer]
  await f.send({ type: 'message.reconcile', message: answer })
  await f.send({
    type: 'input.changed',
    input: {
      nativeInput: { session: f.handle.thread, id: runtimeId('input') },
      facts: ['accepted', 'placed'],
      outcome: 'completed'
    }
  })
  await f.projection.flush()
  const expected = [
    { role: 'user' },
    {
      metadata: { status: 'success' },
      parts: [
        { type: 'data-error', data: { message: '429: CONCURRENCY_LIMITED' } },
        { type: 'text', text: 'Recovered' }
      ]
    }
  ]
  expect(f.projection.snapshot().messages).toMatchObject(expected)
  expect(savedChildView(contexts.context(f.context.id)).messages).toMatchObject(expected)
})

// Catches closing or backing up before an entered observation applies the final native tail.
it.each(['stop', 'drain'] as const)('joins blocked observation delivery before %s flushes', async (action) => {
  const f = fixture()
  const entered = Promise.withResolvers<void>()
  const held = Promise.withResolvers<void>()
  const feed = new ThreadFeed(
    {
      type: 'snapshot',
      messages: [],
      inputs: [],
      activity: { state: 'idle' }
    },
    (error) => {
      throw error
    }
  )
  f.handle.observe = async (sink) => ({
    status: 'confirmed',
    value: feed.observe(async (event) => {
      if (event.type === 'message.reconcile') {
        entered.resolve()
        await held.promise
      }
      await sink(event)
    })
  })
  await f.projection.attach()
  feed.publish({ type: 'message.reconcile', message: f.item('last', 'final tail') })
  await entered.promise
  if (action === 'stop') feed.close('shutdown')
  let finished = false
  const flushing = f.projection[action]().then(() => {
    finished = true
  })
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(finished).toBe(false)
    expect(savedChildView(f.context).messages).toEqual([])
  } finally {
    held.resolve()
  }
  await flushing
  expect(savedChildView(f.context).messages).toMatchObject([{ parts: [{ type: 'text', text: 'final tail' }] }])
  const saved = savedChildView(f.context)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(savedChildView(f.context)).toEqual(saved)
})

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
  await f.send({ type: 'message.reconcile', message: f.archive.messages[0] })
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
  const fork = { prefix: { runtime: 'pi', runtimeSessionId: 'original', leafId: 'leaf' } }
  application.get('DbService').withWriteTx((tx) => contexts.publishBranchTx(tx, f.context.sessionId, 'child', fork))
  await f.projection.attach()
  f.archive.messages = [f.item('native-1', 'withdrawn'), f.item('native-2', 'retained')]
  f.archive.aliases = { 'native-1': 'native-1', 'native-2': 'native-2' }
  for (const item of f.archive.messages) await f.send({ type: 'message.reconcile', message: item })
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
  expect(contexts.context(f.context.id).checkpointMapping?.fork).toEqual(fork)
})

it.each([false, true])(
  'keeps the product row and part when an archived native ID already appeared live (alias=%s)',
  async (withAlias) => {
    const f = fixture()
    await f.projection.attach()
    await f.send({ type: 'message.reconcile', message: f.item('same', 'partial', 'partial') })
    await f.projection.flush()
    const [live] = f.projection.snapshot().messages
    f.archive.messages = [f.item('same', 'complete')]
    if (withAlias) f.archive.aliases = { same: 'unobserved-preview' }
    await f.send({ type: 'message.reconcile', message: f.archive.messages[0] })
    await f.projection.flush()
    expect(savedChildView(f.context).messages).toMatchObject([
      { id: live.id, partIds: live.partIds, parts: [{ text: 'complete' }] }
    ])
  }
)

it('keeps the published ID of an unsaved child part when its preview gets an archive alias', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'before', 'partial') })
  await f.projection.flush()
  const ref = { session: f.handle.thread, id: runtimeId<'item'>('preview') }
  await f.send({ type: 'message.text-open', ref, part: 1, kind: 'text' })
  await f.send({ type: 'message.text-append', ref, part: 1, text: 'after' })

  const [live] = f.projection.snapshot().messages
  expect(live.partIds).toHaveLength(2)
  expect(savedChildView(f.context).messages[0].partIds).toHaveLength(1)
  f.archive.aliases = { entry: 'preview' }
  f.archive.messages = [
    { ...f.item('entry', 'before'), parts: [...f.item('entry', 'before').parts, ...f.item('entry', 'after').parts] }
  ]
  await f.projection.refresh()

  expect(f.projection.snapshot().messages[0]).toMatchObject({ id: live.id, partIds: live.partIds })
  expect(savedChildView(f.context).messages[0]).toMatchObject({ id: live.id, partIds: live.partIds })
})

// A committed UUID replaces its streaming identity without creating a second product row.
it('keeps the product identity when a native committed block replaces a preview', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'part', 'partial') })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  f.archive.messages = [f.item('canonical', 'complete')]
  f.archive.aliases = { canonical: 'canonical' }
  await f.send({
    type: 'message.reconcile',
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
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  await f.send({
    type: 'snapshot',
    messages: [f.item('preview', 'partial', 'partial')],
    inputs: [],
    activity: { state: 'active' }
  })
  release = undefined
  const pending = f.projection.flush()
  await expect.poll(() => release !== undefined).toBe(true)
  f.archive.messages = [f.item('entry', 'complete')]
  f.archive.aliases = { entry: 'preview' }
  await f.send({
    type: 'snapshot',
    messages: f.archive.messages,
    inputs: [],
    activity: { state: 'idle' }
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

it('keeps live appends visible across a child archive read', async () => {
  const reading = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let block = false
  const f = fixture(async () => {
    if (block) {
      reading.resolve()
      await release.promise
    }
  })
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'A', 'partial') })
  await f.projection.flush()
  const [row] = f.projection.snapshot().messages
  const updates: AgentChildUpdate[] = []
  f.projection.subscribe((update) => updates.push(update))
  const append = (text: string) =>
    f.send({ type: 'message.text-append', ref: { id: runtimeId('preview'), session: f.handle.thread }, part: 0, text })
  block = true
  const pending = f.projection.refresh()
  await reading.promise
  try {
    await append('B')
    expect(f.projection.snapshot().messages[0].parts[0]).toMatchObject({ text: 'AB' })
  } finally {
    block = false
    release.resolve()
  }
  await pending
  expect(f.projection.snapshot().messages[0].parts[0]).toMatchObject({ text: 'AB' })
  await append('C')
  expect(f.projection.snapshot().messages[0].parts[0]).toMatchObject({ text: 'ABC' })
  expect(updates.flatMap((update) => [...update.patches])).toEqual([
    { type: 'part-append', partId: row.partIds![0], text: 'B' },
    { type: 'part-append', partId: row.partIds![0], text: 'C' }
  ])
})

it('archives unobserved child updates without building delivery copies until a baseline is requested', async () => {
  const f = fixture()
  await f.projection.attach()
  // oxlint-disable-next-line no-restricted-properties -- Measure real clone work without replacing the copy or isolation behavior.
  const clone = globalThis.structuredClone
  let copies = 0
  const measured = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    copies++
    return clone(value, options)
  })
  try {
    for (const text of ['A', 'AB', 'ABC']) {
      await f.send({ type: 'message.reconcile', message: f.item('preview', text, 'partial') })
      await f.projection.flush()
    }
    expect(copies).toBe(0)
  } finally {
    measured.mockRestore()
  }
  const baseline = f.projection.snapshot()
  expect(baseline.messages[0].parts[0]).toMatchObject({ text: 'ABC' })
  const updates: AgentChildUpdate[] = []
  f.projection.subscribe((update) => updates.push(update))
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'ABCD', 'partial') })
  await f.projection.flush()
  expect(updates).toMatchObject([{ revision: baseline.revision + 1, patches: [{ type: 'append', text: 'D' }] }])
  expect(baseline.messages[0].parts[0]).toMatchObject({ text: 'ABC' })
})

// Catches a mutable SDK snapshot erasing the previous text before the transport computes a delta.
it('publishes incremental text before completion and keeps previously delivered views stable', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: { ...f.item('preview', '', 'partial'), parts: [] } })
  await f.projection.flush()
  const empty = f.projection.snapshot()
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'prefix', 'partial') })
  await f.projection.flush()
  expect(empty.messages[0].parts).toEqual([])
  const before = f.projection.snapshot()
  expect(before.messages[0].metadata?.status).toBe('pending')
  const updates: AgentChildUpdate[] = []
  f.projection.subscribe((update) => updates.push(update))
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'prefix suffix', 'partial') })
  await f.projection.flush()
  expect(before.messages[0].parts[0]).toMatchObject({ text: 'prefix' })
  expect(f.projection.snapshot().messages[0].parts[0]).toMatchObject({ text: 'prefix suffix' })
  expect(updates).toMatchObject([
    { patches: [{ type: 'append', messageId: before.messages[0].id, part: 0, text: ' suffix' }] }
  ])
})

// Catches the first committed prompt moving behind its uncommitted live reply.
it('keeps a committed prompt before its streaming reply through completion and reopen', async () => {
  const f = fixture()
  await f.projection.attach()
  const prompt = { ...f.item('prompt', 'question'), role: 'user' as const }
  f.archive.messages = [prompt]
  await f.send({
    type: 'snapshot',
    messages: [prompt, f.item('preview', 'answer', 'partial')],
    inputs: [],
    activity: { state: 'active' }
  })
  await f.projection.flush()
  const view = f.projection.snapshot()
  expect(view.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  const ids = view.messages.map((message) => message.id)
  expect(readAgentSessionPath(dbh.db, f.context.sessionId).map((row) => [row.id, row.parentId])).toEqual([
    [ids[0], f.context.anchorMessageId],
    [ids[1], ids[0]]
  ])

  await f.send({
    type: 'snapshot',
    messages: [f.item('preview', 'answer', 'partial'), prompt],
    inputs: [],
    activity: { state: 'active' }
  })
  await f.projection.flush()
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'answer more', 'partial') })
  await f.projection.flush()
  expect(f.projection.snapshot().messages.map((message) => message.id)).toEqual(ids)

  f.archive.messages = [prompt, f.item('answer', 'answer done')]
  f.archive.aliases = { answer: 'preview' }
  await f.send({ type: 'gap', reason: 'overflow' })
  await f.projection.flush()
  expect(f.projection.snapshot().messages.map((message) => message.id)).toEqual(ids)
  await f.projection.stop()
  projections.splice(projections.indexOf(f.projection), 1)
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => f.archive)
  projections.push(reopened)
  await reopened.attach()
  expect(reopened.snapshot().messages.map((message) => message.id)).toEqual(ids)
  expect(savedChildView(contexts.context(f.context.id)).messages.map((message) => message.role)).toEqual([
    'user',
    'assistant'
  ])
})

it('reuses the saved task prompt when a fresh observer first learns its native message ID', async () => {
  const f = fixture()
  const prompt = { ...f.item(f.handle.thread.id, 'Inspect the file'), role: 'user' as const }
  f.archive.messages = [prompt]
  f.archive.aliases = { [prompt.id]: prompt.id }
  await f.projection.attach()
  const saved = f.projection.snapshot().messages
  expect(saved).toHaveLength(1)
  await f.projection.stop()

  const nativeId = randomUUID()
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => ({
    messages: [{ ...prompt, id: nativeId }],
    aliases: { [nativeId]: prompt.id }
  }))
  projections.push(reopened)
  await reopened.attach()
  expect(reopened.snapshot().messages).toEqual(saved)
  expect(contexts.context(f.context.id).checkpointMapping?.child?.sources[nativeId]).toBe(saved[0].id)
})

// Catches a persisted wrong parent chain being treated as authoritative on every later reopen.
it('repairs saved message order from native history without changing product identities', async () => {
  const f = fixture()
  f.archive.messages = [
    { ...f.item('prompt', 'first'), role: 'user' },
    f.item('reply', 'second'),
    { ...f.item('follow-up', 'third'), role: 'user' }
  ]
  await f.projection.attach()
  const ids = f.projection.snapshot().messages.map((message) => message.id)
  await f.projection.stop()
  projections.splice(projections.indexOf(f.projection), 1)
  const uncovered = randomUUID()
  application.get('DbService').withWriteTx((tx) => {
    messages.saveMessagesTx(tx, {
      sessionId: f.context.sessionId,
      parentId: ids[2],
      messages: [
        { id: uncovered, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Older archive' }] } }
      ]
    })
    messages.orderChildArchiveTx(tx, f.context.sessionId, [ids[2], uncovered, ids[1], ids[0]])
  })
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => f.archive)
  projections.push(reopened)
  await reopened.attach()
  expect(reopened.snapshot().messages.map((message) => message.id)).toEqual([ids[0], uncovered, ids[1], ids[2]])
  expect(readAgentSessionPath(dbh.db, f.context.sessionId).map((row) => [row.id, row.parentId])).toEqual([
    [ids[0], f.context.anchorMessageId],
    [uncovered, ids[0]],
    [ids[1], uncovered],
    [ids[2], ids[1]]
  ])
})

// Catches late committed entries becoming hidden sibling branches or duplicating their live preview.
it('archives public observations and restores source order from committed evidence without a Pi handle', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: f.item('preview-last', 'last', 'partial') })
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
  await f.send({ type: 'message.reconcile', message: { ...native, id: 'live-call' } })
  await f.projection.flush()
  const id = f.projection.snapshot().messages[0].id
  expect(savedChildView(contexts.context(f.context.id)).messages[0].metadata?.status).toBe('pending')
  await f.send({
    type: 'message.reconcile',
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
  await f.send({ type: 'message.reconcile', message: { ...f.archive.messages[0], id: 'live-call' } })
  await f.projection.flush()
  expect(f.projection.snapshot().active).toBe(true)
  expect(f.projection.snapshot().messages).toMatchObject([
    { id, parts: [{ state: 'output-available', output: 'FIRST\nLAST', preliminary: false }] }
  ])
  expect(savedChildView(contexts.context(f.context.id)).messages[0].parts[0]).toMatchObject({ output: 'FIRST\nLAST' })
})

// Equal compact references still need ordered invalidation when the accepted result changes.
it('keeps oversized child results out of text batches and invalidates same-preview replacements', async () => {
  const f = fixture()
  await f.projection.attach()
  const source: RuntimeMessage = {
    id: 'native',
    role: 'assistant',
    metadata: { completeness: 'partial' },
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'Read',
        toolCallId: 'call',
        state: 'output-available',
        input: {},
        output: 'A'.repeat(64 * 1024)
      },
      { type: 'text', text: 'prefix', state: 'streaming' }
    ]
  }
  await f.send({ type: 'message.reconcile', message: source })
  await f.projection.flush()
  const baseline = f.projection.snapshot()
  const id = baseline.messages[0].id
  const topicId = `agent-session:${f.context.sessionId}`
  expect(baseline.messages[0].parts[0]).toMatchObject({
    output: { $deferredToolResult: { topicId, messageId: id, toolCallId: 'call' } }
  })
  const updates: AgentChildUpdate[] = []
  f.projection.subscribe((update) => updates.push(update))
  const ref = { session: f.handle.thread, id: runtimeId<'item'>(source.id) }
  await f.send({ type: 'message.parts', ref, changes: [{ type: 'append', part: 1, text: ' suffix' }] })
  await f.projection.flush()
  expect(f.projection.snapshot().messages[0].parts[0]).toBe(baseline.messages[0].parts[0])
  expect(updates[0].patches).toEqual([
    { type: 'part-append', partId: baseline.messages[0].partIds?.[1], text: ' suffix' }
  ])
  const call = source.parts[0]
  if (call.type !== 'dynamic-tool' || call.state !== 'output-available') throw new Error('Missing tool result')
  await f.send({
    type: 'message.parts',
    ref,
    changes: [{ type: 'put', part: 0, value: { ...call, output: 'B'.repeat(64 * 1024) } }]
  })
  await f.projection.flush()
  expect(updates.at(-1)?.patches).toContainEqual({
    type: 'tool-result',
    ref: { topicId, messageId: id, toolCallId: 'call', partId: baseline.messages[0].partIds?.[0] }
  })
  expect(f.projection.snapshot().messages[0].parts[0]).toEqual(baseline.messages[0].parts[0])
  expect(messages.getSessionToolOutput(f.context.sessionId, id, 'call')).toEqual({
    found: true,
    output: 'B'.repeat(64 * 1024)
  })
})

// Catches a failed archive read being acknowledged as a settled product view or retried as native work.
it('keeps the last readable archive on recovery failure and explicitly retries only observation persistence', async () => {
  const f = fixture()
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const before = f.projection.snapshot().messages
  f.archive.messages = [f.item('entry', 'complete')]
  f.archive.aliases = { entry: 'preview' }
  f.failHistory(true)
  await f.send({ type: 'activity.changed', activity: { state: 'idle' } })
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
  await f.send({ type: 'message.reconcile', message: f.item('preview', 'partial', 'partial') })
  await f.projection.flush()
  const before = f.projection.snapshot()
  f.archive.messages = [f.item('entry', 'finished')]
  f.archive.aliases = { entry: 'preview' }
  await f.send({ type: 'activity.changed', activity: { state: 'idle' } })
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
  await f.send({ type: 'message.reconcile', message: continuation })
  await f.projection.flush()
  expect(f.projection.snapshot().messages).toMatchObject([
    { role: 'user' },
    { id: first, parts: [{ text: 'Before' }, { text: 'Still the first reply' }] }
  ])
  const steer = { ...f.item('steer', 'Change direction'), role: 'user' as const }
  const second = f.item('after-steer', 'New reply')
  f.archive.messages.push(steer, second)
  await f.send({ type: 'message.reconcile', message: steer })
  await f.send({ type: 'message.reconcile', message: second })
  await f.send({ type: 'activity.changed', activity: { state: 'idle' } })
  await f.projection.flush()
  const view = f.projection.snapshot().messages
  expect(view.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(view[1].id).toBe(first)
  expect(view[3].id).not.toBe(first)
  expect(savedChildView(contexts.context(f.context.id)).messages).toEqual(view)
  expect(readAgentSessionPath(dbh.db, f.context.sessionId)).toHaveLength(5)
})

it.each(['replace', 'retract'] as const)(
  'relinquishes a pending child tool output when reconciliation says to %s it',
  async (action) => {
    const f = fixture()
    const ref = { session: f.handle.thread, id: runtimeId<'item'>('tool') }
    const call = {
      type: 'dynamic-tool' as const,
      toolCallId: 'call',
      toolName: 'Read',
      input: {},
      state: 'input-available' as const
    }
    const saved = { ...call, state: 'output-available' as const, output: 'initial', preliminary: true }
    const input = { ...f.item(ref.id, ''), parts: [saved] }
    await f.projection.attach()
    await f.send({ type: 'message.reconcile', message: input })
    await f.projection.flush()
    const [row] = f.projection.snapshot().messages
    const partId = row.partIds![0]
    const tool = { ...call, state: 'output-available' as const, output: 'preview'.repeat(10_000), preliminary: true }
    await f.send({ type: 'message.tool-output', ref, part: 0, tool })
    expect(f.projection.getToolResult(partId, 'call')).toEqual({ found: true, output: tool.output })

    f.projection.snapshot()
    const updates: AgentChildUpdate[] = []
    f.projection.subscribe((update) => updates.push(update))
    const final = action === 'replace' ? { ...tool, output: 'final'.repeat(10_000), preliminary: false } : call
    const reconciled = { ...input, parts: [final] }
    f.archive.messages = [reconciled]
    await f.send({ type: 'snapshot', messages: [], inputs: [], activity: { state: 'active' } })
    vi.spyOn(application.get('DbService'), 'withWriteTx').mockImplementationOnce(() => {
      throw new Error('Write unavailable')
    })
    await expect(f.projection.flush()).rejects.toThrow('Write unavailable')
    expect(f.projection.getToolResult(partId, 'call')).toEqual({ found: true, output: tool.output })
    await f.projection.flush()
    expect(f.projection.getToolResult(partId, 'call')).toBeUndefined()
    expect(messages.getSessionToolOutput(f.context.sessionId, row.id, 'call', partId)).toEqual(
      'output' in final ? { found: true, output: final.output } : { found: false }
    )
    expect(updates.flatMap((update) => [...update.patches])).toContainEqual({
      type: 'tool-result',
      ref: { topicId: `agent-session:${f.context.sessionId}`, messageId: row.id, toolCallId: 'call', partId }
    })
    if (action === 'retract') expect(savedChildView(f.context).messages[0].parts[0]).not.toHaveProperty('output')
  }
)

it('keeps a newer child tool result arriving during a committed archive read', async () => {
  const reading = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let block = false
  const f = fixture(async () => {
    if (block) {
      reading.resolve()
      await release.promise
    }
  })
  const ref = { session: f.handle.thread, id: runtimeId<'item'>('tool') }
  const call = {
    type: 'dynamic-tool' as const,
    toolCallId: 'call',
    toolName: 'Read',
    input: {},
    state: 'input-available' as const
  }
  const input = { ...f.item(ref.id, ''), parts: [call] }
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: input })
  await f.projection.flush()
  const [row] = f.projection.snapshot().messages
  const partId = row.partIds![0]
  const old = { ...call, state: 'output-available' as const, output: 'old' }
  f.archive.aliases = { committed: ref.id }
  f.archive.messages = [{ ...input, id: 'committed', parts: [old, { ...call, toolCallId: 'archive-sibling' }] }]
  block = true
  const pending = f.projection.refresh()
  await reading.promise
  try {
    await f.send({ type: 'message.tool-output', ref, part: 0, tool: { ...old, output: 'new' } })
  } finally {
    block = false
    release.resolve()
  }
  await pending
  expect(f.projection.snapshot().messages[0].parts).toMatchObject([
    { output: 'new' },
    { toolCallId: 'archive-sibling' }
  ])
  expect(messages.getSessionToolOutput(f.context.sessionId, row.id, 'call', partId)).toEqual({
    found: true,
    output: 'new'
  })
})

it('serves a large error under its native archive row before and after the child commits', async () => {
  const f = fixture()
  const prompt = { ...f.item('prompt', 'Inspect'), role: 'user' as const }
  const narration = f.item('narration', 'Before')
  const inputTool = {
    type: 'dynamic-tool' as const,
    toolName: 'read',
    toolCallId: 'call',
    state: 'input-available' as const,
    input: {}
  }
  const result = { ...f.item('source', ''), parts: [inputTool] }
  f.archive.messages = [prompt, narration, result]
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: result })
  await f.projection.flush()
  const [visible] = f.projection.snapshot().messages.slice(1)
  const partId = visible.partIds![1]
  const row = readAgentSessionPath(dbh.db, f.context.sessionId).at(-1)!
  expect(row.id).not.toBe(visible.id)
  const errorText = 'x'.repeat(65_536)
  const resultProviderMetadata = { pi: { result: errorText } }
  const failure = { ...inputTool, state: 'output-error' as const, errorText, resultProviderMetadata }
  await f.send({
    type: 'message.tool-output',
    ref: { id: runtimeId(result.id), session: f.handle.thread },
    part: 0,
    tool: failure
  })
  const displayed = f.projection.snapshot().messages[1].parts[1]
  expect(Buffer.byteLength(JSON.stringify(displayed))).toBeLessThan(32 * 1024)
  expect(displayed).toMatchObject({
    state: 'output-error',
    resultProviderMetadata: {
      cherry: { deferredToolOutput: { $deferredToolResult: { messageId: row.id, partId } } }
    }
  })
  const detail = {
    found: true,
    output: { isError: true, content: [{ type: 'text', text: errorText }], resultProviderMetadata }
  }
  expect(f.projection.getToolResult(partId, 'call')).toEqual(detail)
  await f.projection.flush()
  expect(f.projection.getToolResult(partId, 'call')).toBeUndefined()
  expect(messages.getSessionToolOutput(f.context.sessionId, row.id, 'call', partId)).toEqual(detail)
  await f.projection.stop()
})

it('delivers a tool update by part ID and reads the oversized result from its own archive row', async () => {
  const f = fixture()
  const prompt = { ...f.item('prompt', 'Inspect'), role: 'user' as const }
  const narration = f.item('narration', 'Before')
  const inputTool = {
    type: 'dynamic-tool' as const,
    toolName: 'read',
    toolCallId: 'call',
    state: 'input-available' as const,
    input: {}
  }
  const result = { ...f.item('source', ''), parts: [inputTool] }
  f.archive.messages = [prompt, narration, result]
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: result })
  await f.projection.flush()
  const [visible] = f.projection.snapshot().messages.slice(1)
  const partId = visible.partIds![1]
  const row = readAgentSessionPath(dbh.db, f.context.sessionId).at(-1)!
  expect(row.id).not.toBe(visible.id)
  const updates: AgentChildUpdate[] = []
  const stop = f.projection.subscribe((update) => updates.push(update))
  const output = 'X'.repeat(64 * 1024)
  const tool = { ...inputTool, state: 'output-available' as const, output, preliminary: false }
  await f.send({
    type: 'message.tool-output',
    ref: { id: runtimeId(result.id), session: f.handle.thread },
    part: 0,
    tool
  })
  f.projection.snapshot()
  expect(updates[0]?.patches).toEqual([
    expect.objectContaining({
      type: 'part-put',
      partId,
      part: expect.objectContaining({
        output: expect.objectContaining({
          $deferredToolResult: expect.objectContaining({ messageId: row.id, toolCallId: 'call', partId })
        })
      })
    })
  ])
  expect(f.projection.getToolResult(partId, 'call')).toEqual({ found: true, output })
  await f.projection.flush()
  expect(f.projection.getToolResult(partId, 'call')).toBeUndefined()
  expect(messages.resolveToolResultMessageId(f.context.sessionId, partId, 'call')).toBe(row.id)
  expect(messages.getSessionToolOutput(f.context.sessionId, row.id, 'call')).toEqual({ found: true, output })
  expect(f.projection.snapshot().messages[1].partIds).toEqual(visible.partIds)
  const reopened = savedChildView(contexts.context(f.context.id)).messages[1]
  expect(reopened.partIds).toEqual(visible.partIds)
  expect(reopened.parts[1]).toMatchObject({ output: { $deferredToolResult: { messageId: row.id, partId } } })

  f.archive.messages = [prompt, { ...result, parts: [tool] }]
  updates.length = 0
  await f.send({ type: 'message.remove', ref: { id: runtimeId(narration.id), session: f.handle.thread } })
  await f.projection.flush()
  const regrouped = f.projection.snapshot().messages[1]
  expect(regrouped.id).toBe(row.id)
  expect(regrouped.partIds).toEqual([partId])
  expect(regrouped.parts[0]).toEqual(reopened.parts[1])
  expect(
    updates
      .map((update) => update.patches)
      .flat()
      .filter((patch) => patch.type === 'tool-result')
  ).toEqual([])
  stop()
})

it('opens and finishes a child block after an earlier source without changing either part ID', async () => {
  const f = fixture()
  const prompt = { ...f.item('prompt', 'Inspect'), role: 'user' as const }
  f.archive.messages = [prompt, f.item('a', 'Before')]
  await f.projection.attach()
  await f.send({ type: 'message.reconcile', message: { ...f.item('b', '', 'partial'), parts: [] } })
  await f.projection.flush()
  const message = f.projection.snapshot().messages[1]
  const afterPartId = message.partIds![0]
  const updates: AgentChildUpdate[] = []
  const stop = f.projection.subscribe((update) => updates.push(update))
  const address = { ref: { id: runtimeId<'item'>('b'), session: f.handle.thread }, part: 0 }
  await f.send({ ...address, type: 'message.text-open', kind: 'text' })
  await f.send({ ...address, type: 'message.text-append', text: 'After' })
  const opened = () =>
    updates
      .map((update) => update.patches)
      .flat()
      .find((patch) => patch.type === 'part-open')
  await expect.poll(opened).toMatchObject({ messageId: message.id, afterPartId })
  const partId = opened()!.partId
  await f.send({ ...address, type: 'message.text-finish' })
  await f.projection.flush()
  expect(updates.map((update) => update.patches).flat()).toEqual([
    { type: 'part-open', messageId: message.id, partId, afterPartId, kind: 'text' },
    { type: 'part-append', partId, text: 'After' },
    { type: 'part-finish', partId }
  ])
  const saved = savedChildView(contexts.context(f.context.id)).messages[1]
  expect(saved.partIds).toEqual([afterPartId, partId])
  expect(saved.parts.map((part) => part.type === 'text' && part.text)).toEqual(['Before', 'After'])
  stop()
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
  expect(savedChildView(context).messages).toEqual(restored.snapshot().messages)
})

// Catches transformed native input overwriting retained content or reusing another branch's message.
it.each(['same-context', 'other-context', 'other-session'] as const)(
  'reuses child input only within its captured owner (%s)',
  async (target) => {
    const f = fixture()
    const sessionId =
      target === 'other-session' ? contexts.context(f.context.parentContextId!).sessionId : f.context.sessionId
    const user = messages.saveMessage({
      sessionId,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'original user input' }] } }
    })
    const owner =
      target === 'other-session'
        ? contexts.context(f.context.parentContextId!)
        : target === 'other-context'
          ? application
              .get('DbService')
              .withWriteTx((tx) => reservePiBranchTx(tx, sessionId, user.id, 'another-branch'))
          : f.context
    prepareNativeSubmission(owner.sessionId, user.id, owner.id, 'steer')
    await f.projection.attach()
    await f.projection.refresh()
    const nativeUser: RuntimeMessage = {
      id: 'native-input',
      role: 'user',
      parts: [{ type: 'text', text: 'wrapped native input' }],
      metadata: { inputId: runtimeId(user.id), completeness: 'complete' }
    }
    f.archive.messages = [nativeUser, f.item('answer', 'shared answer')]
    f.archive.aliases = { 'native-input': 'native-input', answer: 'answer' }
    await f.send({
      type: 'input.changed',
      input: {
        inputId: runtimeId(user.id),
        nativeInput: { session: f.handle.thread, id: runtimeId('native-input') },
        facts: ['placed'],
        outcome: 'completed'
      }
    })
    for (const message of f.archive.messages) await f.send({ type: 'message.reconcile', message })
    await f.projection.flush()
    await f.projection.refresh()
    expect(messages.getSessionMessage(owner.sessionId, user.id).data.parts).toEqual([
      { type: 'text', text: 'original user input' }
    ])
    const view = f.projection.snapshot().messages
    expect(view.filter((message) => message.role === 'assistant')).toMatchObject([
      { parts: [{ type: 'text', text: 'shared answer' }] }
    ])
    if (target === 'same-context') {
      expect(view.filter((message) => message.role === 'user')).toMatchObject([
        { id: user.id, parts: [{ type: 'text', text: 'original user input' }] }
      ])
      expect(inputPosition(user.id)).toEqual(expect.any(Number))
    } else {
      const projected = view.find((message) =>
        message.parts.some((part) => part.type === 'text' && part.text === 'wrapped native input')
      )
      expect(projected).toBeDefined()
      expect(projected!.id).not.toBe(user.id)
      expect(inputPosition(user.id)).toBeNull()
    }
  }
)

it('keeps two retained inputs and one shared answer across archive replay and reopen', async () => {
  const f = fixture()
  const users = ['first', 'second'].map((text) => {
    const user = messages.saveMessage({
      sessionId: f.context.sessionId,
      message: { role: 'user', data: { parts: [{ type: 'text', text }] } }
    })
    prepareNativeSubmission(f.context.sessionId, user.id, f.context.id, 'steer')
    return user
  })
  await f.projection.attach()
  await f.projection.refresh()
  f.archive.messages = [
    ...users.map(
      (user, index): RuntimeMessage => ({
        id: `input-${index}`,
        role: 'user',
        parts: [{ type: 'text', text: `wrapped ${index}` }],
        metadata: { inputId: runtimeId(user.id), completeness: 'complete' }
      })
    ),
    f.item('answer', 'combined answer')
  ]
  for (const [index, user] of users.entries())
    await f.send({
      type: 'input.changed',
      input: {
        inputId: runtimeId(user.id),
        facts: ['placed'],
        outcome: 'completed',
        nativeInput: { session: f.handle.thread, id: runtimeId(`input-${index}`) }
      }
    })
  for (const message of f.archive.messages) await f.send({ type: 'message.reconcile', message })
  await f.projection.flush()
  const expected = f.projection.snapshot().messages
  expect(expected.filter((message) => message.role === 'user').map((message) => message.id)).toEqual(
    users.map((user) => user.id)
  )
  expect(expected.filter((message) => message.role === 'assistant')).toMatchObject([
    { parts: [{ type: 'text', text: 'combined answer' }] }
  ])
  await f.projection.stop()
  projections.splice(projections.indexOf(f.projection), 1)
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, () => f.archive)
  projections.push(reopened)
  await reopened.attach()
  expect(reopened.snapshot().messages).toEqual(expected)
})

it('keeps a child observation newer than its pending context read without writing message history', async () => {
  const f = fixture()
  const reading = Promise.withResolvers<Awaited<ReturnType<ThreadHandle['contextUsage']>>>()
  const started = Promise.withResolvers<void>()
  f.handle.contextUsage = () => {
    started.resolve()
    return reading.promise
  }
  const attaching = f.projection.attach()
  await started.promise
  const current = {
    status: 'confirmed' as const,
    value: {
      model: 'child-model',
      revision: 'child-current',
      contextWindow: 1000,
      used: { tokens: 25, precision: 'reported' as const },
      basis: 'current-context' as const
    }
  }
  await f.send({ type: 'context.changed', result: current })
  reading.resolve({ status: 'unknown', error: { operation: 'contextUsage', code: 'stale', message: 'Old context' } })
  await attaching
  const key = `agent.session.context_usage.${f.context.sessionId}` as const
  expect(application.get('CacheService').getShared(key)).toEqual({ result: current })
  expect(readAgentSessionPath(dbh.db, f.context.sessionId)).toEqual([])
  const revision = f.projection.snapshot().revision
  await f.send({ type: 'context.changed', result: current })
  expect(f.projection.snapshot().revision).toBe(revision)
  await f.projection.stop()
  expect(application.get('CacheService').getShared(key)).toBeUndefined()
})

// Catches archive rereads that redecorate or rewrite unchanged history, and incremental state a reopen would not rebuild.
it('decorates and saves only changed committed history and matches a reopened projection', async () => {
  const decorated: string[] = []
  const decorate: MessageDecorator = (message) => {
    decorated.push(message.id)
    return message
  }
  const f = fixture(undefined, decorate)
  await f.projection.attach()
  f.archive.messages = ['one', 'two', 'three'].map((text) => f.item(`entry-${text}`, text))
  await f.projection.drain()
  const saves = vi.spyOn(contexts, 'saveProjectionTx')
  decorated.length = 0
  await f.projection.drain()
  expect(decorated).toEqual([])
  expect(saves).not.toHaveBeenCalled()

  f.archive.messages = [...f.archive.messages, f.item('entry-four', 'four')]
  await f.projection.drain()
  expect(decorated).toEqual(['entry-four'])
  expect(saves).toHaveBeenCalledTimes(1)
  decorated.length = 0
  await f.projection.refreshDecoration(['entry-two'])
  await f.projection.drain()
  expect(decorated).toEqual(['entry-two'])

  const warm = f.projection.snapshot().messages
  expect(warm.map((message) => message.parts)).toEqual(
    ['one', 'two', 'three', 'four'].map((text) => [{ type: 'text', text, state: 'done' }])
  )
  saves.mockClear()
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, async () => f.archive, decorate)
  projections.push(reopened)
  await reopened.attach()
  await reopened.drain()
  expect(reopened.snapshot().messages).toEqual(warm)
  expect(saves).not.toHaveBeenCalled()
})

// Catches every reopen rewriting saved tool messages whose parts hold undefined fields, which JSON storage drops.
it('does not rewrite saved messages when a reopened archive has undefined part fields', async () => {
  const f = fixture()
  await f.projection.attach()
  f.archive.messages = [
    {
      id: 'entry-tool',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call-read',
          toolName: 'read',
          state: 'output-available',
          input: { path: 'image.png' },
          output: { content: [{ type: 'text', text: 'read' }], nestedCalls: undefined, isError: false }
        }
      ],
      metadata: { completeness: 'complete' }
    }
  ]
  await f.projection.drain()
  const writes = vi.spyOn(messages, 'saveMessagesTx')
  const reopened = new ChildThreadProjection(contexts.context(f.context.id), f.handle, async () => f.archive)
  projections.push(reopened)
  await reopened.attach()
  await reopened.drain()
  expect(reopened.snapshot().messages).toMatchObject([{ parts: [{ type: 'dynamic-tool', toolCallId: 'call-read' }] }])
  expect(writes).not.toHaveBeenCalled()
})

it('places a child input once without revisiting its context on content updates', async () => {
  const f = fixture()
  const user = messages.saveMessage({
    sessionId: f.context.sessionId,
    message: { role: 'user', data: { parts: [{ type: 'text', text: 'question' }] } }
  })
  prepareNativeSubmission(f.context.sessionId, user.id, f.context.id, 'steer')
  await f.projection.attach()
  await f.projection.refresh()
  await f.send({
    type: 'input.changed',
    input: {
      inputId: runtimeId(user.id),
      nativeInput: { session: f.handle.thread, id: runtimeId('native-question') },
      facts: ['placed']
    }
  })
  await f.projection.flush()
  const pos = inputPosition(user.id)
  expect(pos).toEqual(expect.any(Number))
  const reads = vi.spyOn(contexts, 'context')
  for (const text of ['A', 'AB', 'ABC']) {
    await f.send({ type: 'message.reconcile', message: f.item('preview', text, 'partial') })
    await f.projection.flush()
  }
  expect(reads).not.toHaveBeenCalled()
  expect(inputPosition(user.id)).toBe(pos)
})

// Catches every archive read announcing all response owners again.
it('reports each response owner once', async () => {
  const f = fixture()
  projections.splice(projections.indexOf(f.projection), 1)
  const reported: [string, string][] = []
  const projection = new ChildThreadProjection(
    f.context,
    f.handle,
    async () => ({ ...f.archive, responseIds: { 'response-one': 'entry-one' } }),
    undefined,
    (responseId, messageId) => reported.push([responseId, messageId])
  )
  projections.push(projection)
  await projection.attach()
  f.archive.messages = [f.item('entry-one', 'one')]
  await projection.drain()
  f.archive.messages = [...f.archive.messages, f.item('entry-two', 'two')]
  await projection.drain()
  await projection.drain()
  expect(reported).toEqual([['response-one', projection.snapshot().messages[0].id]])
})

// Catches retry status leaking between children, into archives, or surviving settlement.
it('overlays only the latest live retry status without persisting it', async () => {
  const first = fixture()
  const second = fixture()
  await first.projection.attach()
  await second.projection.attach()
  first.projection.retry({ state: 'retrying', modelId: 'model-A', attempt: 2, reason: 'http 429' })
  first.projection.retry({ state: 'retrying', modelId: 'model-A', attempt: 3, reason: 'http 503' })
  expect(first.projection.snapshot().messages.flatMap((m) => m.parts)).toEqual([
    { type: 'data-retry', id: 'retry', data: { state: 'retrying', modelId: 'model-A', attempt: 3, reason: 'http 503' } }
  ])
  expect(second.projection.snapshot().messages).toEqual([])
  const answer = first.item('answer', 'recovered')
  first.archive.messages = [answer]
  await first.send({ type: 'message.reconcile', message: answer })
  await first.projection.drain()
  expect(
    first.projection
      .snapshot()
      .messages.flatMap((m) => m.parts)
      .filter((p) => p.type === 'data-retry')
  ).toHaveLength(1)
  expect(JSON.stringify(savedChildView(contexts.context(first.context.id)))).not.toContain('data-retry')
  first.projection.retry({ state: 'settled' })
  expect(first.projection.snapshot().messages.flatMap((m) => m.parts)).toEqual(answer.parts)
  expect(JSON.stringify(savedChildView(contexts.context(first.context.id)))).toContain('recovered')
  first.projection.retry({ state: 'retrying', modelId: 'model-A', attempt: 2, reason: 'http 429' })
  await first.projection.stop()
  expect(JSON.stringify(first.projection.snapshot())).not.toContain('data-retry')
})
