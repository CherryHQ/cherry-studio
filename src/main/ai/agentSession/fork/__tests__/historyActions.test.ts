import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { PiForkCheckpointSchema } from '@main/ai/runtime/pi/forkCheckpoint'
import { PiDurableRuntimeDriver } from '@main/ai/runtime/piDurable/PiDurableRuntimeDriver'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentSessionRuntimeService } from '../../AgentSessionRuntimeService'
import { AgentSessionForkOperations } from '../AgentSessionForkOperations'

const dbh = setupTestDatabase()
let sessionId: string
let agentId: string
let runtime: AgentSessionRuntimeService
let previous: ReturnType<typeof runtimeDriverRegistry.getAgentSessionDriver>

beforeEach(() => {
  sessionId = randomUUID()
  agentId = randomUUID()
  BaseService.resetInstances()
  runtime = new AgentSessionRuntimeService()
  previous = runtimeDriverRegistry.getAgentSessionDriver('pi')
  runtimeDriverRegistry.register({
    type: 'pi',
    validateSession() {},
    isForkCheckpoint: (value) => PiForkCheckpointSchema.safeParse(value).success,
    async connect() {
      throw new Error('Reading history must not connect a runtime')
    },
    async fork() {
      throw new Error('Ineligible history must not prepare native resources')
    }
  })
  const workspaceId = randomUUID()
  dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'History', instructions: '', orderKey: 'a0' }).run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'History', type: 'user', path: '/test', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: sessionId, agentId, workspaceId, runtimeType: 'pi', name: 'History', orderKey: 'a0' })
    .run()
})

afterEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
  if (previous) runtimeDriverRegistry.register(previous)
})

function user(text: string) {
  return messages.saveMessage({ sessionId, message: { role: 'user', data: { parts: [{ type: 'text', text }] } } })
}

function answer(checkpoint?: unknown) {
  return messages.saveMessage({
    sessionId,
    ...(checkpoint === undefined ? {} : { runtimeAnchor: { checkpoint } }),
    message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Answer' }] } }
  })
}

it('offers native-backed boundaries and lets edit preparation use a predecessor outside the requested page', async () => {
  const first = user('First')
  const completed = answer({ runtime: 'pi', runtimeSessionId: 'native', leafId: 'leaf' })
  const next = user('Next')
  const page = messages.listSessionMessages(sessionId, { messageId: next.id, limit: 1 })
  expect(page.items.map((row) => row.id)).toEqual([next.id])
  expect(
    runtime
      .getHistoryActions(
        sessionId,
        page.items.map((row) => row.id)
      )
      .get(next.id)
  ).toEqual({ fork: 'not_turn_boundary', edit: null })
  const rows = messages.listSessionMessages(sessionId).items
  const actions = runtime.getHistoryActions(
    sessionId,
    rows.map((row) => row.id)
  )
  expect(actions.get(first.id)?.edit).toBeNull()
  expect(actions.get(completed.id)?.fork).toBeNull()
  expect(rows.every((row) => !('historyActions' in row))).toBe(true)
  expect(rows.find((row) => row.id === completed.id)?.data).not.toHaveProperty('runtimeAnchor')
  await expect(runtime.getEditTarget(sessionId, first.id)).resolves.toMatchObject({
    messageId: first.id,
    parts: [{ type: 'text', text: 'First' }]
  })
  await expect(runtime.getEditTarget(sessionId, next.id)).resolves.toMatchObject({
    messageId: next.id,
    parts: [{ type: 'text', text: 'Next' }]
  })
})

it('refuses legacy, malformed and foreign-runtime checkpoints consistently in listing and execution', async () => {
  user('First')
  const legacy = answer()
  const legacyEdit = user('Legacy edit')
  const malformed = answer({ runtime: 'pi', runtimeSessionId: 'native' })
  const malformedEdit = user('Malformed edit')
  const foreign = answer({
    runtime: 'claude-code',
    runtimeSessionId: randomUUID(),
    messageUuid: randomUUID(),
    configDir: '/test'
  })
  const foreignEdit = user('Foreign edit')
  const rows = messages.listSessionMessages(sessionId).items
  const availability = runtime.getHistoryActions(
    sessionId,
    rows.map((row) => row.id)
  )
  const actions = (id: string) => availability.get(id)
  expect(actions(legacy.id)?.fork).toBe('legacy_history')
  expect(actions(malformed.id)?.fork).toBe('unsupported_checkpoint')
  expect(actions(foreign.id)?.fork).toBe('unsupported_checkpoint')
  expect(actions(legacyEdit.id)?.edit).toBe('checkpoint_unsupported')
  expect(actions(malformedEdit.id)?.edit).toBe('checkpoint_unsupported')
  expect(actions(foreignEdit.id)?.edit).toBe('checkpoint_unsupported')
  for (const reply of [legacy, malformed, foreign]) {
    await expect(new AgentSessionForkOperations().fork(sessionId, reply.id)).rejects.toMatchObject({
      reason: actions(reply.id)?.fork
    })
  }
  for (const input of [legacyEdit, malformedEdit, foreignEdit]) {
    await expect(runtime.getEditTarget(sessionId, input.id)).rejects.toMatchObject({ reason: 'checkpoint_unsupported' })
    const target = { messageId: input.id, version: messages.readEditSnapshotTx(dbh.db, sessionId, input.id).version }
    await expect(
      new AgentSessionForkOperations().edit(
        sessionId,
        target,
        async () => {},
        () => {}
      )
    ).rejects.toMatchObject({
      reason: 'checkpoint_unsupported'
    })
  }
  expect(rows.filter((row) => row.role === 'assistant').every((row) => row.status === 'success')).toBe(true)
  expect(messages.listSessionMessages(sessionId).items).toEqual(rows)
})

it('keeps unsupported harness history readable and rejects execution, including the first input', async () => {
  dbh.db.update(agentSessionTable).set({ runtimeType: 'pi-durable' }).where(eq(agentSessionTable.id, sessionId)).run()
  const first = user('Durable input')
  const completed = answer()
  const rows = messages.listSessionMessages(sessionId).items
  const actions = runtime.getHistoryActions(
    sessionId,
    rows.map((row) => row.id)
  )
  expect(actions.get(first.id)?.edit).toBe('checkpoint_unsupported')
  expect(actions.get(completed.id)?.fork).toBe('unsupported_checkpoint')
  expect(rows).toHaveLength(2)
  await expect(runtime.getEditTarget(sessionId, first.id)).rejects.toMatchObject({ reason: 'checkpoint_unsupported' })
  await expect(new AgentSessionForkOperations().fork(sessionId, completed.id)).rejects.toMatchObject({
    reason: 'unsupported_checkpoint'
  })
  const target = { messageId: first.id, version: messages.readEditSnapshotTx(dbh.db, sessionId, first.id).version }
  await expect(
    new AgentSessionForkOperations().edit(
      sessionId,
      target,
      async () => {},
      () => {}
    )
  ).rejects.toMatchObject({ reason: 'checkpoint_unsupported' })
  expect(messages.listSessionMessages(sessionId).items.map((row) => row.id)).toEqual(rows.map((row) => row.id))
})

it('refuses a missing edit parent without treating the input as a first message', async () => {
  const input = user('Disconnected input')
  dbh.db
    .update(agentSessionMessageTable)
    .set({ parentId: randomUUID() })
    .where(eq(agentSessionMessageTable.id, input.id))
    .run()
  expect(runtime.getHistoryActions(sessionId, [input.id]).get(input.id)?.edit).toBe('checkpoint_unsupported')
  await expect(runtime.getEditTarget(sessionId, input.id)).rejects.toMatchObject({ reason: 'checkpoint_unsupported' })
  const target = { messageId: input.id, version: messages.readEditSnapshotTx(dbh.db, sessionId, input.id).version }
  await expect(
    new AgentSessionForkOperations().edit(
      sessionId,
      target,
      async () => {},
      () => {}
    )
  ).rejects.toMatchObject({ reason: 'checkpoint_unsupported' })
})

it('rejects delivery edits and keeps boundary reads scoped to the requested session and IDs', async () => {
  const first = user('Human input')
  const delivered = user('Delivered input')
  dbh.db
    .update(agentSessionMessageTable)
    .set({
      delivery: {
        version: 1,
        sender: { agentId, sessionId: 'sender-session' },
        receiver: { agentId, sessionId },
        replyPolicy: 'completion',
        sourceMessageId: null,
        outcome: null,
        error: null,
        statusAt: new Date().toISOString()
      },
      deliveryStatus: 'consumed'
    })
    .where(eq(agentSessionMessageTable.id, delivered.id))
    .run()
  expect(runtime.getHistoryActions(sessionId, [delivered.id]).get(delivered.id)?.edit).toBe('invalid_target')
  await expect(runtime.getEditTarget(sessionId, delivered.id)).rejects.toMatchObject({ reason: 'invalid_target' })
  const other = randomUUID()
  const session = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).get()!
  dbh.db
    .insert(agentSessionTable)
    .values({ id: other, agentId, workspaceId: session.workspaceId, name: 'Other', orderKey: 'a1' })
    .run()
  const foreign = messages.saveMessage({ sessionId: other, message: { role: 'user', data: { parts: [] } } })
  const actions = runtime.getHistoryActions(sessionId, [first.id, foreign.id])
  expect([...actions.keys()]).toEqual([first.id])
  expect(runtime.getHistoryActions(sessionId, []).size).toBe(0)
})

// Durable edits need either a fresh first-input context or a valid predecessor checkpoint.
it('enables Durable edits at first inputs and committed predecessor boundaries', async () => {
  dbh.db.update(agentSessionTable).set({ runtimeType: 'pi-durable' }).where(eq(agentSessionTable.id, sessionId)).run()
  runtimeDriverRegistry.register(new PiDurableRuntimeDriver())
  const first = user('First Durable input')
  const completed = answer({ runtime: 'pi-durable', backendId: randomUUID(), conversationId: '1', entryId: '2' })
  const later = user('Later Durable input')
  const malformed = answer({ runtime: 'pi-durable', backendId: randomUUID(), conversationId: '1', entryId: '0' })
  const legacy = answer()
  const actions = runtime.getHistoryActions(sessionId, [first.id, completed.id, later.id, malformed.id, legacy.id])
  expect(actions.get(completed.id)?.fork).toBeNull()
  expect(actions.get(malformed.id)?.fork).toBe('unsupported_checkpoint')
  expect(actions.get(legacy.id)?.fork).toBe('legacy_history')
  expect(actions.get(first.id)?.edit).toBeNull()
  expect(actions.get(later.id)?.edit).toBeNull()
  expect((await runtime.getEditTarget(sessionId, first.id)).parts).toEqual(first.data.parts)
  expect((await runtime.getEditTarget(sessionId, later.id)).parts).toEqual(later.data.parts)
})
