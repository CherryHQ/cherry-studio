import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { PiForkCheckpointSchema } from '@main/ai/runtime/pi/forkCheckpoint'

const dbh = setupTestDatabase()
let sessionId: string
const validate = (value: unknown) => PiForkCheckpointSchema.safeParse(value).success

beforeEach(() => {
  sessionId = randomUUID()
  const workspaceId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'History', type: 'user', path: '/test', orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'History', orderKey: 'a0' }).run()
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

it('offers only native-backed boundaries and evaluates an edit predecessor outside the requested page', () => {
  const first = user('First')
  const completed = answer({ runtime: 'pi', runtimeSessionId: 'native', leafId: 'leaf' })
  const next = user('Next')
  const page = messages.listSessionMessages(sessionId, { messageId: next.id, limit: 1 }, validate)
  expect(page.items[0].historyActions).toEqual({ fork: 'not_turn_boundary', edit: null })
  const rows = messages.listSessionMessages(sessionId, {}, validate).items
  expect(rows.find((row) => row.id === first.id)?.historyActions?.edit).toBeNull()
  expect(rows.find((row) => row.id === completed.id)?.historyActions?.fork).toBeNull()
  expect(rows.find((row) => row.id === completed.id)?.data).not.toHaveProperty('runtimeAnchor')
})

it('preserves successful answers but refuses legacy, malformed and foreign-runtime checkpoints', () => {
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
  const rows = messages.listSessionMessages(sessionId, {}, validate).items
  const actions = (id: string) => rows.find((row) => row.id === id)?.historyActions
  expect(actions(legacy.id)?.fork).toBe('legacy_history')
  expect(actions(malformed.id)?.fork).toBe('unsupported_checkpoint')
  expect(actions(foreign.id)?.fork).toBe('unsupported_checkpoint')
  expect(actions(legacyEdit.id)?.edit).toBe('checkpoint_unsupported')
  expect(actions(malformedEdit.id)?.edit).toBe('checkpoint_unsupported')
  expect(rows.filter((row) => row.role === 'assistant').every((row) => row.status === 'success')).toBe(true)
})

it('keeps unsupported harness history readable while disabling fork and edit, including the first input', () => {
  const first = user('Durable input')
  const completed = answer()
  const rows = messages.listSessionMessages(sessionId).items
  expect(rows.find((row) => row.id === first.id)?.historyActions?.edit).toBe('checkpoint_unsupported')
  expect(rows.find((row) => row.id === completed.id)?.historyActions?.fork).toBe('unsupported_checkpoint')
  expect(rows).toHaveLength(2)
})
