import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { getForkAvailability } from '../availability'

describe('fork availability', () => {
  const dbh = setupTestDatabase()
  let sessionId: string
  beforeEach(() => {
    const agentId = randomUUID(),
      workspaceId = randomUUID()
    sessionId = randomUUID()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Workspace', path: '/workspace', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, agentId, workspaceId, name: 'Source', orderKey: 'a0' })
      .run()
  })
  afterEach(() => runtimeDriverRegistry.clearForTest())
  it('reports legacy, non-boundary and missing messages independently and deduplicates', async () => {
    const assistant = randomUUID(),
      user = randomUUID(),
      missing = randomUUID()
    for (const [id, role] of [
      [assistant, 'assistant'],
      [user, 'user']
    ] as const) {
      agentSessionMessageService.saveMessage({
        sessionId,
        message: { id, role, status: 'success', data: { parts: [] } }
      })
    }
    expect(await getForkAvailability(sessionId, [assistant, user, missing, assistant])).toEqual({
      items: [
        { messageId: assistant, availability: { enabled: false, reason: 'legacy_history' } },
        { messageId: user, availability: { enabled: false, reason: 'not_turn_boundary' } },
        { messageId: missing, availability: { enabled: false, reason: 'source_missing' } }
      ]
    })
  })
  it('leaves marked sessions untouched and preserves the boundary guard', async () => {
    const assistant = randomUUID(),
      user = randomUUID()
    for (const [id, role] of [
      [assistant, 'assistant'],
      [user, 'user']
    ] as const) {
      agentSessionMessageService.saveMessage({
        sessionId,
        message: { id, role, status: 'success', data: { parts: [] } }
      })
    }
    dbh.db
      .insert(appStateTable)
      .values({ key: `agent-runtime-migration:${sessionId}`, value: { sessionId, resumeToken: randomUUID() } })
      .run()
    const before = JSON.stringify([
      dbh.db.select().from(agentSessionMessageTable).all(),
      dbh.db.select().from(appStateTable).all()
    ])
    expect(await getForkAvailability(sessionId, [assistant, user])).toEqual({
      items: [
        { messageId: assistant, availability: { enabled: null, reason: 'operation_failed' } },
        { messageId: user, availability: { enabled: false, reason: 'not_turn_boundary' } }
      ]
    })
    expect(
      JSON.stringify([dbh.db.select().from(agentSessionMessageTable).all(), dbh.db.select().from(appStateTable).all()])
    ).toBe(before)
  })
  it('uses the complete product prefix and detects workspace changes during probing', async () => {
    const first = randomUUID(),
      second = randomUUID()
    const context = preparePiBranch(sessionId, undefined, 'native').id
    for (const id of [first, second]) {
      agentSessionMessageService.saveMessage({
        sessionId,
        nativeContextId: context,
        runtimeResumeToken: 'native',
        runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: 'native', leafId: id } },
        message: { id, role: 'assistant', status: 'success', data: { parts: [] } }
      })
    }
    runtimeDriverRegistry.register({
      type: 'pi',
      capabilities: ['agent-session'],
      validateSession() {},
      async listAvailableTools() {
        return []
      },
      async connect() {
        throw new Error('must not connect')
      },
      async fork() {
        throw new Error('must not fork')
      },
      async probeFork(candidates) {
        expect(candidates[0].checkpoints.map((checkpoint) => checkpoint.leafId)).toEqual([first, second])
        const session = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).get()!
        dbh.db
          .update(agentWorkspaceTable)
          .set({ path: '/changed' })
          .where(eq(agentWorkspaceTable.id, session.workspaceId))
          .run()
        return new Map([[second, { enabled: true }]])
      }
    })
    expect(await getForkAvailability(sessionId, [second])).toEqual({
      items: [{ messageId: second, availability: { enabled: false, reason: 'source_changed' } }]
    })
  })
})
