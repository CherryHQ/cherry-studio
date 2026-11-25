import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { isToolUIPart } from 'ai'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'

import { application } from '@application'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'
import { PersistenceListener } from '@main/ai/streamManager/listeners/PersistenceListener'
import type { CherryUIMessage } from '@shared/data/types/message'

import { AgentSessionMessageBackend } from '../persistence/AgentSessionMessageBackend'
import { RootMessageProjection } from '../RootMessageProjection'
import { ThreadProjection } from '../ThreadProjection'

const dbh = setupTestDatabase()
function fixture() {
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: `/test/${workspaceId}`, orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  const context = prepareClaudeBranch(sessionId, '/test/claude')
  const projection = new RootMessageProjection(context.id, { lastPos: 0 })
  const reply = () =>
    messages.saveMessage({ sessionId, message: { role: 'assistant', status: 'pending', data: { parts: [] } } }).id
  const update = (
    messages: CherryUIMessage[],
    extra: Partial<RuntimeMessageProjection> = {}
  ): RuntimeMessageProjection => ({
    contextId: context.id,
    messages,
    live: messages.map((message) => message.id),
    replaces: {},
    removed: [],
    ...extra
  })
  const save = (id: string) => saveProjection(sessionId, id, projection)
  const reopen = () => new RootMessageProjection(context.id, { lastPos: messages.lastTimelinePosition(sessionId) })
  return { sessionId, context, projection, reply, update, save, reopen }
}
function saveProjection(sessionId: string, messageId: string, projection: RootMessageProjection) {
  const placement = projection.partPlacement(messageId)
  return messages.replaceMessageParts(
    sessionId,
    messageId,
    projection.parts(messageId),
    projection.checkpoint(),
    placement?.partIds,
    placement?.positions
  )
}
const text = (id: string, value: string): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: value, state: 'done' }]
})

it('opens a fresh reply without reading settled parts and restores only the reply a correction addresses', () => {
  const f = fixture()
  const old = f.reply()
  const other = f.reply()
  const history = [text('a', 'First part'), text('b', 'Second part'), text('c', 'Other reply')]
  f.projection.accept(f.update(history.slice(0, 2)), old)
  f.projection.accept(f.update(history.slice(2)), other)
  const original = f.projection.replyEntries(old)!
  messages.replaceMessageParts(
    f.sessionId,
    old,
    f.projection.parts(old),
    f.projection.checkpoint(),
    original.map(({ partId }) => partId),
    new Map(original.map(({ partId }, i) => [partId, i + 1]))
  )
  f.save(other)
  using reads = vi.spyOn(messages, 'getStoredMessagePartFacts')
  using bodies = vi.spyOn(messages, 'getStoredMessageParts')
  using exists = vi.spyOn(messages, 'hasSessionMessage')

  const projection = f.reopen()
  const fresh = f.reply()
  expect(
    projection.control(old, {
      type: 'data-agent-task-event',
      transient: true,
      data: { event: 'notification', taskId: 'background', status: 'in_progress' }
    })
  ).toBe(false)
  const changed = projection.accept(f.update([...history, text('d', 'New reply')], { live: ['d'] }), fresh)
  expect([...changed.keys()]).toEqual([fresh])
  expect(projection.parts(fresh)).toEqual(text('d', 'New reply').parts)
  expect(projection.checkpoint().root.sources).toEqual({
    a: { messageId: old, partIds: [original[0].partId] },
    b: { messageId: old, partIds: [original[1].partId] },
    c: { messageId: other, partIds: [f.projection.replyEntries(other)![0].partId] },
    d: { messageId: fresh, partIds: [projection.replyEntries(fresh)![0].partId] }
  })
  expect([reads.mock.calls, bodies.mock.calls, exists.mock.calls]).toEqual([[], [], []])

  const corrected = projection.accept(f.update([text('b', 'Corrected')], { live: [], refresh: ['b'] }))
  expect(corrected.get(old)).toEqual([
    { partId: original[0].partId, pos: 1, payload: history[0].parts[0] },
    { partId: original[1].partId, pos: 2, payload: text('b', 'Corrected').parts[0] }
  ])
  expect(reads.mock.calls.map(([, id]) => id)).toEqual([old])
  expect(bodies.mock.calls.every(([, id]) => id === old)).toBe(true)
})

it('restores the stable part address without loading the archived tool result into the live reply', () => {
  const f = fixture()
  const replyId = f.reply()
  const output = 'archive output '.repeat(8192)
  f.projection.accept(
    f.update([
      {
        id: 'native-source',
        role: 'assistant',
        parts: [
          { type: 'dynamic-tool', toolName: 'read', toolCallId: 'call', state: 'output-available', input: {}, output }
        ]
      }
    ]),
    replyId
  )
  const [{ partId }] = f.projection.replyEntries(replyId)!
  messages.replaceMessageParts(
    f.sessionId,
    replyId,
    f.projection.parts(replyId),
    f.projection.checkpoint(),
    [partId],
    new Map([[partId, 7]])
  )

  const reopened = f.reopen()
  f.projection.committedReply(replyId)
  const stored = [
    {
      partId,
      payload: { output: { $deferredToolResult: { messageId: replyId, toolCallId: 'call', partId } } }
    }
  ]
  expect(f.projection.replyEntries(replyId)).toMatchObject(stored)
  expect(reopened.replyEntries(replyId)).toMatchObject([{ ...stored[0], pos: 7 }])
  expect(messages.getSessionToolOutput(f.sessionId, replyId, 'call')).toEqual({ found: true, output })
})

it('keeps identified data part IDs when their source reorders or replaces them', () => {
  const f = fixture()
  const replyId = f.reply()
  const part = (id: string): CherryUIMessage['parts'][number] => ({
    type: 'data-error',
    id,
    data: { name: 'Error', message: id, stack: null }
  })
  const project = (ids: string[]) =>
    f.projection.accept(f.update([{ id: 'native', role: 'assistant', parts: ids.map(part) }]), replyId)
  project(['first', 'second'])
  const ids = () => f.projection.replyEntries(replyId)!.map(({ partId }) => partId)
  const [first, second] = ids()
  project(['second', 'first'])
  expect(ids()).toEqual([first, second])
  project(['second', 'new'])
  const [retained, replacement] = ids()
  expect(retained).toBe(second)
  expect(replacement).not.toBe(first)
})

it.each(['connected', 'reconnected'])(
  'keeps a deleted reply out of %s projection replay and the next reply',
  (mode) => {
    const f = fixture()
    const deleted = f.reply()
    f.projection.accept(f.update([text('old', 'Deleted answer'), text('old:2', 'Deleted continuation')]), deleted)
    f.save(deleted)
    const retained = f.reply()
    f.projection.accept(f.update([text('retained', 'Retained answer')]), retained)
    f.save(retained)
    const stale = f.projection.checkpoint()

    messages.deleteSessionMessage(f.sessionId, deleted)
    const saved = contexts.context(f.context.id).checkpointMapping!.root!
    expect(Object.keys(saved.sources)).toEqual(['retained'])
    expect(saved.removed).toEqual(expect.arrayContaining(['old', 'old:2']))
    messages.replaceMessageParts(f.sessionId, retained, text('', 'Retained answer').parts, stale)
    expect(Object.keys(contexts.context(f.context.id).checkpointMapping!.root!.sources)).toEqual(['retained'])

    const projection = mode === 'connected' ? f.projection : f.reopen()
    const next = f.reply()
    const changed = projection.accept(
      f.update([text('old', 'Late replay'), text('canonical', 'Late replacement'), text('next', 'New answer')], {
        replaces: { 'old:2': 'canonical' }
      }),
      next
    )
    expect([...changed.keys()]).toEqual([next])
    expect(changed.get(next)?.map(({ payload }) => payload)).toEqual(text('', 'New answer').parts)
    saveProjection(f.sessionId, next, projection)
    const restored = f.reopen()
    expect(restored.parts(next)).toEqual(text('', 'New answer').parts)
    expect(restored.parts(retained)).toEqual(text('', 'Retained answer').parts)
    expect(restored.parts(deleted)).toBeUndefined()
    expect(messages.hasSessionMessage(f.sessionId, deleted)).toBe(false)
  }
)

it('recovers an existing dangling checkpoint without assigning its sources to the next reply', () => {
  const f = fixture()
  const deleted = f.reply()
  f.projection.accept(f.update([text('old', 'Deleted answer')]), deleted)
  f.save(deleted)
  const checkpointMapping = contexts.context(f.context.id).checkpointMapping
  messages.deleteSessionMessage(f.sessionId, deleted)
  // Reproduce the checkpoint left by the old deletion path.
  dbh.db
    .update(agentSessionContextTable)
    .set({ checkpointMapping })
    .where(eq(agentSessionContextTable.id, f.context.id))
    .run()

  const projection = f.reopen()
  const next = f.reply()
  projection.accept(f.update([text('old', 'Replay'), text('next', 'New answer')]), next)
  saveProjection(f.sessionId, next, projection)
  expect(f.reopen().parts(next)).toEqual(text('', 'New answer').parts)
  expect(contexts.context(f.context.id).checkpointMapping!.root!.removed).toContain('old')
})

it('rolls back root ownership and tombstones with a failed message deletion transaction', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('native', 'Answer')]), id)
  f.save(id)
  const before = contexts.context(f.context.id).checkpointMapping
  expect(() =>
    application.get('DbService').withWriteTx((tx) => {
      messages.deleteSessionMessageTx(tx, f.sessionId, id)
      throw new Error('Rollback deletion')
    })
  ).toThrow('Rollback deletion')
  expect(messages.getSessionMessage(f.sessionId, id).data.parts).toEqual(text('', 'Answer').parts)
  expect(contexts.context(f.context.id).checkpointMapping).toEqual(before)
})

it.each(['success', 'paused'] as const)(
  'preserves source ownership through %s normalization and reopen',
  async (status) => {
    const f = fixture()
    const id = f.reply()
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'call',
      toolName: 'Read',
      state: 'input-available' as const,
      input: {}
    }
    f.projection.accept(
      f.update([
        { id: 'a', role: 'assistant', parts: [{ type: 'reasoning', text: '', state: 'done' }, tool] },
        text('b', 'Answer from B')
      ]),
      id
    )
    const listener = new PersistenceListener({
      topicId: `agent-session:${f.sessionId}`,
      prepareMessage: (message, status) => f.projection.prepare(message, status),
      backend: new AgentSessionMessageBackend({
        sessionId: f.sessionId,
        assistantMessageId: id,
        projection: () => f.projection.checkpoint(),
        partPlacement: (messageId) => f.projection.partPlacement(messageId)
      }),
      onPersistFailed: () => {}
    })
    f.projection.control(id, { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } })
    const finalMessage: CherryUIMessage = {
      id,
      role: 'assistant',
      parts: [
        ...f.projection.parts(id)!,
        { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } }
      ]
    }
    if (status === 'success') await listener.onDone({ status, finalMessage })
    else await listener.onPaused({ status, finalMessage })
    const restored = f.reopen()
    restored.accept(f.update([text('a', 'Refreshed A')], { live: [], refresh: ['a'] }))
    messages.replaceMessageParts(
      f.sessionId,
      id,
      restored.parts(id),
      restored.checkpoint(),
      restored.partPlacement(id)?.partIds,
      restored.partPlacement(id)?.positions
    )
    expect(f.reopen().parts(id)).toEqual([
      ...text('', 'Answer from B').parts,
      { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } },
      ...text('', 'Refreshed A').parts
    ])
    restored.accept(f.update([], { removed: ['a'] }))
    expect(restored.parts(id)).toEqual([
      ...text('', 'Answer from B').parts,
      { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } }
    ])
  }
)

it('keeps a compaction boundary between an existing block and a newly admitted block through save and reopen', () => {
  const f = fixture()
  const reply = f.reply()
  const first = { type: 'text', text: 'A', state: 'streaming' } as const
  const marker = {
    type: 'data-compaction-anchor',
    id: 'boundary',
    data: { phase: 'agent-session', status: 'done' }
  } as const
  f.projection.accept(f.update([{ id: 'native', role: 'assistant', parts: [first] }]), reply)
  f.projection.control(reply, marker)
  const [a, c] = f.projection.replyEntries(reply)!
  const ref = {
    session: { backendId: runtimeId<'backend'>('test'), id: runtimeId<'thread'>('root') },
    id: runtimeId<'item'>('native')
  }
  f.projection.changePart({ type: 'message.text-append', ref, part: 0, text: '1' })
  const [b] = f.projection.changePart({ type: 'message.text-open', ref, part: 1, kind: 'text' })
  f.projection.changePart({ type: 'message.text-append', ref, part: 1, text: 'B' })
  const entries = f.projection.replyEntries(reply)!
  expect(entries.map(({ partId }) => partId)).toEqual([a.partId, c.partId, b.patch.partId])
  expect(b.patch).toMatchObject({ type: 'part-open', messageId: reply, pos: entries[2].pos })
  expect(entries.map(({ pos }) => pos)).toEqual([1, 2, 3])
  const placement = f.projection.partPlacement(reply)!
  messages.replaceMessageParts(
    f.sessionId,
    reply,
    f.projection.parts(reply),
    f.projection.checkpoint(),
    placement.partIds,
    placement.positions
  )
  const reopened = f.reopen()
  expect(reopened.replyEntries(reply)).toEqual(entries)
  reopened.changePart({
    type: 'message.parts',
    ref,
    changes: [{ type: 'correct', part: 1, kind: 'text', text: 'B2', state: 'done' }]
  })
  expect(reopened.parts(reply)).toMatchObject([{ text: 'A1' }, marker, { text: 'B2' }])
})

it('recovers interleaved native parts by ID and admits a newly discovered source after live work', () => {
  const f = fixture()
  const sessionId = f.sessionId
  const user = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: text('', 'go').parts } }
  })
  messages.bindInputContextTx(dbh.db, sessionId, user.id, f.context.id)
  const runId = f.reply()
  messages.linkReply(sessionId, [user.id], runId)
  const marker = {
    type: 'data-compaction-anchor',
    id: 'boundary',
    data: { phase: 'agent-session', status: 'done' }
  } as const
  f.projection.accept(f.update([text('native', 'A')]), runId)
  f.projection.control(runId, marker)
  const native = { ...text('native', ''), parts: [...text('', 'A').parts, ...text('', 'B').parts] }
  f.projection.accept(f.update([native]), runId)
  f.save(runId)
  const before = f.projection.replyEntries(runId)!
  const timeline = { lastPos: 8 }
  expect(
    messages.settleRecoveredReply(
      { sessionId, runId, contextId: f.context.id, inputIds: [user.id], timeline },
      'success',
      [text('previously-unseen', 'D'), { ...native, parts: [...text('', 'A2').parts, ...text('', 'B2').parts] }]
    )
  ).toBe(true)
  const after = f.reopen().replyEntries(runId)!
  expect(after.map(({ payload }) => payload)).toEqual([
    ...text('', 'A2').parts,
    marker,
    ...text('', 'B2').parts,
    ...text('', 'D').parts
  ])
  expect(after.slice(0, 3).map(({ partId, pos }) => [partId, pos])).toEqual(
    before.map(({ partId, pos }) => [partId, pos])
  )
  expect([after[3].pos, timeline.lastPos]).toEqual([9, 9])
})

it('updates only the owning reply across interleaved sources, replacements, removal and host display', () => {
  const f = fixture()
  const fork = { prefix: { runtime: 'claude-code', sessionId: 'original', messageId: 'boundary' } }
  application
    .get('DbService')
    .withWriteTx((tx) => contexts.publishBranchTx(tx, f.sessionId, f.context.nativeThreadId!, fork))
  const first = f.reply()
  const second = f.reply()
  f.projection.accept(f.update([text('a', 'A')]), first)
  f.projection.accept(f.update([text('b', 'B')]), second)
  f.projection.accept(f.update([text('c', 'C')]), first)
  const changed = f.projection.accept(f.update([text('canonical', 'A2')], { replaces: { a: 'canonical' } }), second)
  expect([...changed.keys()]).toEqual([first])
  expect(changed.get(first)?.map(({ payload }) => payload)).toEqual([...text('', 'A2').parts, ...text('', 'C').parts])
  f.projection.control(first, { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } })
  expect(f.projection.accept(f.update([], { removed: ['canonical'] }), second).has(second)).toBe(false)
  f.projection.accept(f.update([text('d', 'D')]), first)
  f.save(first)
  f.save(second)
  const restored = f.reopen()
  expect(restored.parts(first)).toEqual([
    ...text('', 'C').parts,
    { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } },
    ...text('', 'D').parts
  ])
  expect(restored.parts(second)).toEqual(text('', 'B').parts)
  expect(Object.keys(restored.checkpoint().root.sources)).toEqual(['b', 'c', 'd'])
  expect(contexts.context(f.context.id).checkpointMapping?.fork).toEqual(fork)
})

it('keeps root history when incremental thread reconciliation drops compacted sources', () => {
  const f = fixture()
  const id = f.reply()
  const thread = { backendId: runtimeId<'backend'>('pi'), id: runtimeId<'thread'>('root') }
  const updates: RuntimeMessageProjection[] = []
  const view = new ThreadProjection(thread, f.context.id, (update) => {
    updates.push(update)
    f.projection.accept(update, id)
  })
  view.accept({
    events: [{ type: 'message.reconcile', message: { ...text('old', 'Retained'), metadata: undefined } }],
    live: ['old'],
    aliases: {}
  })
  view.accept({
    events: [
      {
        type: 'snapshot',
        messages: [],
        inputs: [],
        activity: { state: 'idle' }
      }
    ],
    live: [],
    aliases: {}
  })
  expect(f.projection.parts(id)).toEqual(text('', 'Retained').parts)
  expect(updates.at(-1)?.removed).toEqual([])
  view.accept({
    events: [{ type: 'message.reconcile', message: { ...text('new', 'Live'), metadata: undefined } }],
    live: ['new'],
    aliases: {}
  })
  expect(updates.at(-1)?.messages.map((message) => message.id)).toEqual(['new'])
  expect(f.projection.parts(id)).toEqual([...text('', 'Retained').parts, ...text('', 'Live').parts])
  view.accept({
    events: [
      {
        type: 'snapshot',
        messages: [
          { ...text('new', 'Live'), metadata: undefined },
          { ...text('canonical', 'Committed'), metadata: undefined }
        ],
        inputs: [],
        activity: { state: 'idle' }
      }
    ],
    live: ['new', 'canonical'],
    aliases: { canonical: 'old' }
  })
  expect(updates.at(-1)?.messages.map((message) => message.id)).toEqual(['canonical'])
  expect(f.projection.parts(id)).toEqual([...text('', 'Committed').parts, ...text('', 'Live').parts])
  view.accept({
    events: [{ type: 'message.remove', ref: { session: thread, id: runtimeId('canonical') } }],
    live: [],
    aliases: {}
  })
  expect(f.projection.parts(id)).toEqual(text('', 'Live').parts)
})

it('refreshes display metadata only for known owners without admitting historical sources', () => {
  const f = fixture()
  const first = f.reply()
  const second = f.reply()
  f.projection.accept(f.update([text('known', 'Original')]), first)
  const update = f.update([text('known', 'Filtered'), text('historical', 'Must not be admitted')], {
    live: [],
    refresh: ['known', 'historical']
  })
  const changed = f.projection.accept(update, second)
  expect([...changed.keys()]).toEqual([first])
  expect(changed.get(first)?.map(({ payload }) => payload)).toEqual(text('', 'Filtered').parts)
  expect(f.projection.parts(second)).toBeUndefined()
})

// A child may finish after its parent: persist the task status without copying the child report.
it('updates a settled parent task and keeps the status after replay and reopen', () => {
  const f = fixture()
  const id = f.reply()
  const source: CherryUIMessage = {
    id: 'native-tool',
    role: 'assistant',
    parts: [{ type: 'dynamic-tool', toolName: 'Agent', toolCallId: 'spawn', state: 'input-available', input: {} }]
  }
  f.projection.accept(f.update([source]), id)
  f.projection.taskEvent({ event: 'started', taskId: 'child', toolUseId: 'spawn', status: 'in_progress' })
  const stale = { id, role: 'assistant' as const, parts: f.projection.parts(id)! }
  f.projection.control(id, { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } })
  f.save(id)
  const terminal = {
    event: 'notification' as const,
    taskId: 'child',
    toolUseId: 'spawn',
    status: 'completed' as const,
    summary: 'Full child report belongs to its own projection'
  }
  expect(f.projection.taskEvent(terminal)).toBe(id)
  f.projection.accept(f.update([source], { live: [] }))
  new AgentSessionMessageBackend({
    sessionId: f.sessionId,
    assistantMessageId: id,
    projection: () => f.projection.checkpoint(),
    partPlacement: (messageId) => f.projection.partPlacement(messageId)
  }).persistAssistant({
    finalMessage: f.projection.prepare(stale, 'success'),
    status: 'success'
  })
  f.projection.taskEvent({ ...terminal, usage: { totalTokens: 100 } })
  f.save(id)
  const restored = f.reopen()
  const taskParts = restored.parts(id)!.filter((part) => part.type === 'data-agent-task-event')
  expect(taskParts).toHaveLength(1)
  expect(taskParts[0].data).toMatchObject({ status: 'completed', taskId: 'child', toolUseId: 'spawn' })
  expect(JSON.stringify(restored.parts(id))).not.toContain(terminal.summary)
  expect(restored.parts(id)).toContainEqual({
    type: 'data-compaction-anchor',
    data: { phase: 'agent-session', status: 'done' }
  })
})

it.each([
  ['completed', true],
  ['stopped', true],
  ['error', true],
  ['completed', false]
] as const)(
  'retires a %s task approval (native part: %s) across snapshots, persistence and reopen without deciding siblings',
  (status, nativePart) => {
    const f = fixture()
    const id = f.reply()
    const source: CherryUIMessage = {
      id: 'native-bash',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'A',
          state: 'approval-requested',
          input: { command: 'sleep 10' },
          approval: { id: 'approve-A' }
        }
      ]
    }
    f.projection.accept(f.update([nativePart ? source : text(source.id, 'Running')]), id)
    for (const toolCallId of ['A', 'B']) {
      f.projection.control(id, {
        type: 'tool-input-available',
        toolCallId,
        toolName: 'Bash',
        input: { command: 'sleep 10' }
      })
      f.projection.control(id, { type: 'tool-approval-request', toolCallId, approvalId: `approve-${toolCallId}` })
    }
    expect(f.projection.parts(id)).toContainEqual(
      expect.objectContaining({ toolCallId: 'B', state: 'approval-requested' })
    )
    f.projection.taskEvent({ event: 'notification', taskId: 'bg', toolUseId: 'A', status })
    expect(f.projection.retireToolApproval('A')).toBe(true)
    expect(f.projection.retireToolApproval('A')).toBe(false)
    const check = (projection: RootMessageProjection) => {
      const parts = projection.parts(id)!
      expect(parts).toContainEqual({
        type: 'dynamic-tool',
        toolName: 'Bash',
        toolCallId: 'A',
        state: 'input-available',
        input: { command: 'sleep 10' }
      })
      expect(parts).toContainEqual(
        expect.objectContaining({ toolCallId: 'B', state: 'approval-requested', approval: { id: 'approve-B' } })
      )
      expect(parts).toContainEqual(
        expect.objectContaining({ type: 'data-agent-task-event', data: expect.objectContaining({ status }) })
      )
    }
    check(f.projection)
    f.projection.accept(f.update([source]), id)
    check(f.projection)
    const prepared = f.projection.prepare({ id, role: 'assistant', parts: f.projection.parts(id)! }, 'success')
    messages.replaceMessageParts(
      f.sessionId,
      id,
      prepared.parts,
      f.projection.checkpoint(),
      f.projection.partPlacement(id)?.partIds,
      f.projection.partPlacement(id)?.positions
    )
    const restored = f.reopen()
    check(restored)
    restored.accept(f.update([source]), id)
    check(restored)
    const output: CherryUIMessage = {
      ...source,
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'A',
          state: 'output-available',
          input: {},
          output: 'done'
        }
      ]
    }
    restored.accept(f.update([output]), id)
    expect(restored.parts(id)).toContainEqual(output.parts[0])
  }
)

it('revives a real approval request after retirement, including ordered persisted parts', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('native', 'Running')]), id)
  f.projection.control(id, { type: 'tool-input-available', toolCallId: 'A', toolName: 'Bash', input: {} })
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'old' })
  const event = { event: 'notification' as const, taskId: 'bg', toolUseId: 'A', status: 'completed' as const }
  f.projection.taskEvent(event)
  f.projection.retireToolApproval('A')
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'new' })
  expect(f.projection.parts(id)).toContainEqual(
    expect.objectContaining({ state: 'approval-requested', approval: { id: 'new' } })
  )
  const task = f.projection.parts(id)!.find((part) => part.type === 'data-agent-task-event')!
  const request = f.projection.parts(id)!.find((part) => 'toolCallId' in part)!
  const checkpoint = f.projection.checkpoint()
  for (const [parts, state] of [
    [[task, request], 'approval-requested'],
    [[request, task], 'input-available']
  ] as const) {
    messages.replaceMessageParts(f.sessionId, id, [...parts], {
      ...checkpoint,
      root: { ...checkpoint.root, sources: { native: { messageId: id, offset: 0, count: 2 } } }
    })
    expect(f.reopen().parts(id)).toContainEqual(expect.objectContaining({ toolCallId: 'A', state }))
  }
})

it('retires a persisted synthetic approval without a native tool and accepts its later output once', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('native', 'Running')]), id)
  f.projection.control(id, { type: 'tool-input-available', toolCallId: 'A', toolName: 'Bash', input: {} })
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'approval' })
  const prepared = f.projection.prepare({ id, role: 'assistant', parts: f.projection.parts(id)! }, 'success')
  messages.replaceMessageParts(
    f.sessionId,
    id,
    prepared.parts,
    f.projection.checkpoint(),
    f.projection.partPlacement(id)?.partIds,
    f.projection.partPlacement(id)?.positions
  )
  const restored = f.reopen()
  expect(restored.toolCallMessageId('A')).toBe(id)
  restored.retireToolApproval('A')
  restored.taskEvent({ event: 'notification', taskId: 'bg', toolUseId: 'A', status: 'completed' })
  const tools = restored.parts(id)!.filter((part) => 'toolCallId' in part)
  expect(tools).toHaveLength(1)
  expect(tools[0]).toMatchObject({ state: 'input-available' })
  expect((tools[0] as any).approval).toBeUndefined()
  messages.replaceMessageParts(
    f.sessionId,
    id,
    restored.parts(id),
    restored.checkpoint(),
    restored.partPlacement(id)?.partIds
  )
  const reopened = f.reopen()
  expect(reopened.parts(id)).toEqual(restored.parts(id))
  reopened.accept(
    f.update([
      {
        id: 'native',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'Bash',
            toolCallId: 'A',
            state: 'output-available',
            input: {},
            output: 'done'
          }
        ]
      }
    ]),
    id
  )
  const outputs = reopened.parts(id)!.filter((part) => 'toolCallId' in part)
  expect(outputs).toHaveLength(1)
  expect(outputs[0]).toMatchObject({ state: 'output-available', output: 'done' })
})

it('resolves a control-only autonomous call to its old reply instead of the newest reply', () => {
  const f = fixture()
  const old = f.reply()
  f.projection.accept(f.update([text('old', 'Old')]), old)
  f.projection.control(old, { type: 'tool-input-available', toolCallId: 'A', toolName: 'Bash', input: {} })
  f.projection.control(old, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'approval' })
  const latest = f.reply()
  f.projection.accept(f.update([text('new', 'New')]), latest)
  expect(f.projection.lastMessageId).toBe(latest)
  expect(f.projection.taskEvent({ event: 'notification', taskId: 'bg', toolUseId: 'A', status: 'completed' })).toBe(old)
})

it('routes a late tool event only to a reply owned by the reopened context', () => {
  const f = fixture()
  const tool = (toolCallId: string): CherryUIMessage['parts'][number] => ({
    type: 'dynamic-tool',
    toolCallId,
    toolName: 'Bash',
    state: 'input-available',
    input: {}
  })
  const elsewhere = f.reply()
  messages.replaceMessageParts(f.sessionId, elsewhere, [tool('shared'), tool('unowned')])
  const owner = f.reply()
  f.projection.accept(f.update([{ id: 'native', role: 'assistant', parts: [tool('shared')] }]), owner)
  f.save(owner)
  const projection = f.reopen()
  const done = { event: 'notification', taskId: 'task', status: 'completed' } as const
  using reads = vi.spyOn(messages, 'getStoredMessagePartFacts')
  expect(projection.taskEvent({ ...done, toolUseId: 'unowned' })).toBeUndefined()
  expect(projection.taskEvent({ ...done, toolUseId: 'shared' })).toBe(owner)
  expect(projection.parts(owner)).toContainEqual(expect.objectContaining({ type: 'data-agent-task-event' }))
  expect(reads.mock.calls.map(([, id]) => id)).toEqual([owner])
})

it('keeps the latest approval when its archived reply is first read after the decision', () => {
  const f = fixture()
  const owner = f.reply()
  f.projection.accept(
    f.update([
      {
        id: 'native',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'call',
            toolName: 'Bash',
            state: 'approval-responded',
            input: {},
            approval: { id: 'old', approved: true }
          }
        ]
      }
    ]),
    owner
  )
  f.save(owner)
  const reopened = f.reopen()
  using reads = vi.spyOn(messages, 'getStoredMessagePartFacts')
  reopened.resolveToolApproval('call', 'latest', false)
  expect(reads.mock.calls).toEqual([])
  expect(reopened.parts(owner)).toMatchObject([{ state: 'output-denied', approval: { id: 'latest', approved: false } }])
})

it('retires an approval when the task finishes after the parent was persisted', () => {
  const f = fixture()
  const id = f.reply()
  const source: CherryUIMessage = {
    id: 'native',
    role: 'assistant',
    parts: [{ type: 'dynamic-tool', toolName: 'Bash', toolCallId: 'A', state: 'input-available', input: {} }]
  }
  f.projection.accept(f.update([source]), id)
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'approval' })
  const prepared = f.projection.prepare({ id, role: 'assistant', parts: f.projection.parts(id)! }, 'success')
  messages.replaceMessageParts(
    f.sessionId,
    id,
    prepared.parts,
    f.projection.checkpoint(),
    f.projection.partPlacement(id)?.partIds,
    f.projection.partPlacement(id)?.positions
  )
  const restored = f.reopen()
  restored.taskEvent({ event: 'notification', taskId: 'bg', toolUseId: 'A', status: 'completed' })
  restored.retireToolApproval('A')
  expect(restored.parts(id)).toContainEqual(
    expect.objectContaining({ toolCallId: 'A', state: 'input-available', approval: undefined })
  )
  messages.replaceMessageParts(f.sessionId, id, restored.parts(id), restored.checkpoint())
  expect(f.reopen().parts(id)).toContainEqual(expect.objectContaining({ toolCallId: 'A', state: 'input-available' }))
})

it('finalizes a retired input on interruption without an approval decision', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('native', 'Running')]), id)
  f.projection.control(id, { type: 'tool-input-available', toolCallId: 'A', toolName: 'Bash', input: {} })
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'approval' })
  f.projection.taskEvent({ event: 'notification', taskId: 'bg', toolUseId: 'A', status: 'stopped' })
  expect(f.projection.retireToolApproval('A')).toBe(true)
  const prepared = f.projection.prepare({ id, role: 'assistant', parts: f.projection.parts(id)! }, 'paused')
  messages.replaceMessageParts(
    f.sessionId,
    id,
    prepared.parts,
    f.projection.checkpoint(),
    f.projection.partPlacement(id)?.partIds,
    f.projection.partPlacement(id)?.positions
  )
  const parts = f.reopen().parts(id)!
  expect(parts).toContainEqual(expect.objectContaining({ toolCallId: 'A', state: 'output-error', input: {} }))
  const tool = parts.find((part) => 'toolCallId' in part && part.toolCallId === 'A')!
  expect((tool as any).approval).toBeUndefined()
  expect((tool as any).approved).toBeUndefined()
  expect(parts.filter((part) => isToolUIPart(part) && part.state === 'approval-requested')).toEqual([])
  expect(parts.filter((part) => 'approval' in part)).toEqual([])
})

it.each([true, false])('projects a late native tool output according to the host approval (%s)', (approved) => {
  const f = fixture()
  const id = f.reply()
  const tool = { type: 'dynamic-tool', toolName: 'read', toolCallId: 'A', input: {} } as const
  f.projection.accept(
    f.update([{ id: 'native', role: 'assistant', parts: [{ ...tool, state: 'input-available' }] }]),
    id
  )
  f.projection.resolveToolApproval('A', 'decision', approved)
  const [change] = f.projection.changePart({
    type: 'message.tool-output',
    part: 0,
    ref: { session: { backendId: runtimeId('test'), id: runtimeId('thread') }, id: runtimeId('native') },
    tool: { ...tool, state: 'output-available', output: 'sensitive result' }
  })
  if (approved)
    expect(change?.patch).toMatchObject({
      part: { state: 'output-available', approval: { id: 'decision', approved: true } }
    })
  else {
    expect(change).toBeUndefined()
    expect(f.projection.parts(id)).toMatchObject([{ state: 'output-denied', output: undefined }])
  }
})

it.each([true, false])('keeps a real approval decision (%s) ahead of retirement', (approved) => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('native', 'Running')]), id)
  f.projection.control(id, { type: 'tool-input-available', toolCallId: 'A', toolName: 'Bash', input: {} })
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'A', approvalId: 'approval' })
  f.projection.resolveToolApproval('A', 'approval', approved)
  expect(f.projection.retireToolApproval('A')).toBe(false)
  expect(f.projection.parts(id)).toContainEqual(
    expect.objectContaining({
      toolCallId: 'A',
      state: approved ? 'approval-responded' : 'output-denied',
      approval: { id: 'approval', approved }
    })
  )
})

// Canonicalizing a pre-steer source must not move it to the new product reply.
it('keeps source ownership across steer, canonical replacement and replay', () => {
  const f = fixture()
  const first = f.reply()
  const second = f.reply()
  f.projection.accept(f.update([text('live:1', 'Before')]), first)
  f.projection.accept(
    f.update([text('native:1', 'Before'), text('native:2', 'After')], { replaces: { 'live:1': 'native:1' } }),
    second
  )
  expect(f.projection.parts(first)).toEqual(text('', 'Before').parts)
  expect(f.projection.parts(second)).toEqual(text('', 'After').parts)
  f.save(first)
  f.save(second)
  const restored = f.reopen()
  expect(
    restored.accept(f.update([text('native:1', 'Before'), text('native:2', 'After')], { live: [] }), second).size
  ).toBe(0)
  expect(restored.parts(first)).toEqual(text('', 'Before').parts)
  expect(restored.parts(second)).toEqual(text('', 'After').parts)
})

// Compaction narrows model context; only explicit retraction can hide saved content, even on reopen.
it('retains absent archive content but persists explicit removal', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('native:1', 'Withdrawn'), text('native:2', 'Retained')]), id)
  f.projection.accept(f.update([text('native:2', 'Retained')], { live: [] }), id)
  expect(f.projection.parts(id)).toHaveLength(2)
  f.projection.accept(f.update([text('native:2', 'Retained')], { live: [], removed: ['native:1'] }))
  f.save(id)
  const restored = f.reopen()
  restored.accept(f.update([text('native:1', 'Withdrawn')]), id)
  expect(restored.parts(id)).toEqual(text('', 'Retained').parts)
})

// A terminal AI SDK snapshot captured before a retraction must not restore the discarded body.
it('persists the latest replacement and checkpoint atomically at turn completion', () => {
  const f = fixture()
  const id = f.reply()
  const backend = new AgentSessionMessageBackend({
    sessionId: f.sessionId,
    assistantMessageId: id,
    projection: () => f.projection.checkpoint(),
    partPlacement: (messageId) => f.projection.partPlacement(messageId)
  })
  f.projection.accept(f.update([text('native:1', 'Old')]), id)
  f.projection.accept(f.update([text('native:2', 'New')], { removed: ['native:1'] }), id)
  backend.persistAssistant({
    finalMessage: { id, role: 'assistant', parts: f.projection.parts(id)! },
    status: 'success'
  })
  expect(messages.getSessionMessage(f.sessionId, id).data.parts).toEqual(text('', 'New').parts)
  expect(f.reopen().parts(id)).toEqual(text('', 'New').parts)
})

// A stale writer must not publish a checkpoint that references rolled-back message contents.
it('rolls back the message write when the checkpoint belongs to another session', () => {
  const f = fixture()
  const id = f.reply()
  const another = fixture()
  expect(() =>
    messages.replaceMessageParts(f.sessionId, id, text('', 'Invalid').parts, another.projection.checkpoint())
  ).toThrow()
  expect(messages.getSessionMessage(f.sessionId, id).data.parts).toEqual([])
})

// Whole native messages replace only legacy sources with a proven common product owner.
it('migrates saved block ownership without duplicating content or changing the product reply', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('uuid:0', 'Before'), text('uuid:1', 'After')]), id)
  f.save(id)
  const saved = f.projection.checkpoint()
  const baseline = f.projection.replyEntries(id)!
  contexts.saveRootProjectionTx(dbh.db, f.sessionId, {
    ...saved,
    root: {
      removed: [],
      sources: { 'uuid:0': { messageId: id, offset: 0, count: 1 }, 'uuid:1': { messageId: id, offset: 1, count: 1 } }
    }
  })
  const restored = f.reopen()
  const partsBefore = restored.replyEntries(id)!
  const message = { ...text('uuid', 'Before'), parts: [...text('', 'Before').parts, ...text('', 'After').parts] }
  const update = f.update([message], {
    live: [],
    legacy: { 'uuid:0': { messageId: 'uuid' }, 'uuid:1': { messageId: 'uuid' } }
  })
  const changed = restored.accept(update)
  expect([...changed.keys()]).toEqual([id])
  expect(partsBefore).toEqual(baseline)
  expect(changed.get(id)).toEqual(partsBefore)
  expect(restored.parts(id)).toEqual(message.parts)
  expect(Object.keys(restored.checkpoint().root.sources)).toEqual(['uuid'])
  expect(restored.checkpoint().root.version).toBe(3)
  expect(restored.accept(update).size).toBe(0)
})

// Child approvals have no native root part; their task attribution must survive projection.
it('preserves the source metadata of an unprojected child approval', () => {
  const f = fixture()
  const id = f.reply()
  f.projection.accept(f.update([text('root-answer', 'Delegating work')]), id)
  const metadata = {
    cherry: {
      transport: 'pi-agent',
      parentToolCallId: 'spawn',
      commandPolicy: { cwd: '/work', revision: '1', reason: 'Risky command', rules: [] }
    }
  }
  f.projection.control(id, {
    type: 'tool-input-available',
    toolCallId: 'child-shell',
    toolName: 'bash',
    input: { command: 'pwd' },
    providerExecuted: true,
    providerMetadata: metadata
  })
  f.projection.control(id, { type: 'tool-approval-request', toolCallId: 'child-shell', approvalId: 'approval-child' })
  expect(f.projection.parts(id)).toContainEqual(
    expect.objectContaining({ toolCallId: 'child-shell', callProviderMetadata: metadata })
  )
  f.save(id)
  expect(f.reopen().parts(id)).toContainEqual(
    expect.objectContaining({ toolCallId: 'child-shell', callProviderMetadata: metadata })
  )
})

// The approval request can arrive before its tool source; keep enough input to render the card.
it('builds an approval card from the approval input when no tool source was projected', () => {
  const f = fixture()
  const id = f.reply()
  const questions = [
    {
      question: 'Which database?',
      header: 'Database',
      options: [{ label: 'SQLite' }, { label: 'Postgres' }],
      multiSelect: false
    }
  ]
  f.projection.control(id, {
    type: 'tool-input-available',
    toolCallId: 'ask-1',
    toolName: 'AskUserQuestion',
    input: { questions },
    providerExecuted: true,
    dynamic: true
  })
  f.projection.control(id, { type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'ask-1' })

  expect(f.projection.parts(id)).toEqual([
    expect.objectContaining({
      type: 'dynamic-tool',
      toolName: 'AskUserQuestion',
      toolCallId: 'ask-1',
      state: 'approval-requested',
      input: { questions },
      approval: { id: 'approval-1' }
    })
  ])
})
