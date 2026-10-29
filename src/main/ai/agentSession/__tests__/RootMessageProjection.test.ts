import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { CherryUIMessage } from '@shared/data/types/message'

import { AgentSessionMessageBackend } from '../persistence/AgentSessionMessageBackend'
import { RootMessageProjection } from '../RootMessageProjection'

const dbh = setupTestDatabase()
function fixture() {
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: `/test/${workspaceId}`, orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  const context = contexts.prepareClaudeBranch(sessionId, '/test/claude')
  const projection = new RootMessageProjection(context.id)
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
  const save = (id: string) =>
    messages.replaceMessageParts(sessionId, id, projection.parts(id), projection.checkpoint())
  return { sessionId, context, projection, reply, update, save }
}
const text = (id: string, value: string): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: value, state: 'done' }]
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
  stale.parts.push({ type: 'data-knowledge-scope', data: { baseIds: ['knowledge'] } })
  f.save(id)
  const terminal = {
    event: 'notification' as const,
    taskId: 'child',
    toolUseId: 'spawn',
    status: 'completed' as const,
    summary: 'Full child report belongs to its own projection'
  }
  expect(f.projection.taskEvent(terminal)?.messageId).toBe(id)
  f.projection.accept(f.update([source], { live: [] }))
  new AgentSessionMessageBackend({
    sessionId: f.sessionId,
    assistantMessageId: id,
    projection: (message) => {
      if (message) f.projection.retain(message)
      return f.projection.checkpoint()
    }
  }).persistAssistant({
    finalMessage: { ...stale, parts: [...f.projection.parts(id)!, stale.parts.at(-1)!] },
    status: 'success'
  })
  f.projection.taskEvent({ ...terminal, usage: { totalTokens: 100 } })
  f.save(id)
  const restored = new RootMessageProjection(f.context.id)
  const taskParts = restored.parts(id)!.filter((part) => part.type === 'data-agent-task-event')
  expect(taskParts).toHaveLength(1)
  expect(taskParts[0].data).toMatchObject({ status: 'completed', taskId: 'child', toolUseId: 'spawn' })
  expect(JSON.stringify(restored.parts(id))).not.toContain(terminal.summary)
  expect(restored.parts(id)).toContainEqual({ type: 'data-knowledge-scope', data: { baseIds: ['knowledge'] } })
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
  const restored = new RootMessageProjection(f.context.id)
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
  const restored = new RootMessageProjection(f.context.id)
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
    projection: () => f.projection.checkpoint()
  })
  f.projection.accept(f.update([text('native:1', 'Old')]), id)
  f.projection.accept(f.update([text('native:2', 'New')], { removed: ['native:1'] }), id)
  backend.persistAssistant({
    finalMessage: { id, role: 'assistant', parts: f.projection.parts(id)! },
    status: 'success'
  })
  expect(messages.getSessionMessage(f.sessionId, id).data.parts).toEqual(text('', 'New').parts)
  expect(new RootMessageProjection(f.context.id).parts(id)).toEqual(text('', 'New').parts)
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
  const root = { ...saved.root }
  delete root.version
  contexts.saveRootProjectionTx(dbh.db, f.sessionId, { ...saved, root })
  const restored = new RootMessageProjection(f.context.id)
  const message = { ...text('uuid', 'Before'), parts: [...text('', 'Before').parts, ...text('', 'After').parts] }
  const update = f.update([message], {
    live: [],
    legacy: { 'uuid:0': { messageId: 'uuid', parts: [0] }, 'uuid:1': { messageId: 'uuid', parts: [1] } }
  })
  expect(restored.accept(update)).toEqual(new Map([[id, message.parts]]))
  expect(restored.parts(id)).toEqual(message.parts)
  expect(Object.keys(restored.checkpoint().root.sources)).toEqual(['uuid'])
  expect(restored.checkpoint().root.version).toBe(2)
  expect(restored.accept(update).size).toBe(0)
})
