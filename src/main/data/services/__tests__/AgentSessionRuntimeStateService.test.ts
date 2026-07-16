import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionRuntimeStateTable } from '@data/db/schemas/agentSessionRuntimeState'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import {
  AGENT_SESSION_RUNTIME_STATE_VERSION,
  agentSessionRuntimeStateService
} from '@data/services/AgentSessionRuntimeStateService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_ID = 'session-1'
const ANCHOR_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e001'
const ANCHOR_ID_2 = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e002'
const RUNTIME_TYPE = 'ai-sdk'

describe('AgentSessionRuntimeStateService', () => {
  const dbh = setupTestDatabase()

  async function seedSession(sessionId: string, orderKey = 'a0') {
    const workspaceId = `workspace-${sessionId}`
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: workspaceId,
      path: `/tmp/${workspaceId}`,
      type: 'user',
      orderKey: `workspace-${orderKey}`
    })
    await dbh.db.insert(agentSessionTable).values({ id: sessionId, name: sessionId, orderKey, workspaceId })
  }

  async function seedMessage(id: string, sessionId = SESSION_ID, createdAt = 100) {
    await dbh.db.insert(agentSessionMessageTable).values({
      id,
      sessionId,
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'row' }] },
      status: 'success',
      createdAt,
      updatedAt: createdAt
    })
  }

  function saveState(overrides: Partial<Parameters<typeof agentSessionRuntimeStateService.saveState>[0]> = {}) {
    return agentSessionRuntimeStateService.saveState({
      sessionId: SESSION_ID,
      runtimeType: RUNTIME_TYPE,
      compactedThroughMessageId: ANCHOR_ID,
      summary: 'summary of the old prefix',
      summaryTokenCount: 120,
      sourceTokenCount: 4000,
      compactionModelId: 'provider::model',
      ...overrides
    })
  }

  beforeEach(async () => {
    vi.restoreAllMocks()
    await seedSession(SESSION_ID)
    await seedMessage(ANCHOR_ID)
  })

  it('round-trips state through save and get with the current version stamped', () => {
    const saved = saveState()

    expect(saved.version).toBe(AGENT_SESSION_RUNTIME_STATE_VERSION)
    const read = agentSessionRuntimeStateService.getState(SESSION_ID, RUNTIME_TYPE)
    expect(read).toMatchObject({
      sessionId: SESSION_ID,
      runtimeType: RUNTIME_TYPE,
      compactedThroughMessageId: ANCHOR_ID,
      summary: 'summary of the old prefix',
      summaryTokenCount: 120,
      sourceTokenCount: 4000,
      compactionModelId: 'provider::model'
    })
  })

  it('returns null for a missing session, another runtime type, or another payload version', async () => {
    expect(agentSessionRuntimeStateService.getState('missing-session', RUNTIME_TYPE)).toBeNull()

    saveState()
    expect(agentSessionRuntimeStateService.getState(SESSION_ID, 'claude-code')).toBeNull()

    await dbh.db
      .update(agentSessionRuntimeStateTable)
      .set({ version: AGENT_SESSION_RUNTIME_STATE_VERSION + 1 })
      .where(eq(agentSessionRuntimeStateTable.sessionId, SESSION_ID))
    expect(agentSessionRuntimeStateService.getState(SESSION_ID, RUNTIME_TYPE)).toBeNull()
  })

  it('upserts in place: one row per session, stable createdAt, fresh updatedAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_000_500)
    await seedMessage(ANCHOR_ID_2, SESSION_ID, 200)

    saveState()
    saveState({ compactedThroughMessageId: ANCHOR_ID_2, summary: 'newer summary' })

    const rows = await dbh.db.select().from(agentSessionRuntimeStateTable)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      compactedThroughMessageId: ANCHOR_ID_2,
      summary: 'newer summary',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_500
    })
  })

  it('rejects state for a nonexistent session or anchor message', async () => {
    expect(() => saveState({ sessionId: 'missing-session' })).toThrowError()
    expect(() => saveState({ compactedThroughMessageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e0ff' })).toThrowError()
    expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
  })

  it('cascades away with the session', async () => {
    saveState()

    await dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
  })

  it('cascades away when the anchor message row is deleted directly', async () => {
    saveState()

    await dbh.db.delete(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, ANCHOR_ID))

    expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
  })

  describe('saveStateChecked (compaction write-after-read guard)', () => {
    function saveChecked(guard: { expectedUpdatedAt: number | null; sourceMessageIds: readonly string[] }) {
      return agentSessionRuntimeStateService.saveStateChecked(
        {
          sessionId: SESSION_ID,
          runtimeType: RUNTIME_TYPE,
          compactedThroughMessageId: ANCHOR_ID,
          summary: 'fresh summary',
          compactionModelId: 'provider::model'
        },
        guard
      )
    }

    it('writes when every summarized row still exists and no prior state was folded', () => {
      const row = saveChecked({ expectedUpdatedAt: null, sourceMessageIds: [ANCHOR_ID] })

      expect(row).toMatchObject({ summary: 'fresh summary' })
      expect(agentSessionRuntimeStateService.getState(SESSION_ID, RUNTIME_TYPE)).toMatchObject({
        summary: 'fresh summary'
      })
    })

    it('refuses to write when a summarized source row was deleted mid-summarization', async () => {
      await seedMessage(ANCHOR_ID_2, SESSION_ID, 200)
      await dbh.db.delete(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, ANCHOR_ID_2))

      const row = saveChecked({ expectedUpdatedAt: null, sourceMessageIds: [ANCHOR_ID, ANCHOR_ID_2] })

      expect(row).toBeNull()
      expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
    })

    it('refuses to write when the folded prior state was invalidated meanwhile', () => {
      const prior = saveState()

      // Simulate the same-transaction invalidation a message delete performs.
      agentSessionRuntimeStateService.invalidateStateTx(dbh.db, SESSION_ID)

      const row = saveChecked({ expectedUpdatedAt: prior.updatedAt, sourceMessageIds: [ANCHOR_ID] })

      expect(row).toBeNull()
      expect(agentSessionRuntimeStateService.getState(SESSION_ID, RUNTIME_TYPE)).toBeNull()
    })

    it('refuses to write when the prior state was replaced (updatedAt moved on)', () => {
      const prior = saveState()
      vi.spyOn(Date, 'now').mockReturnValue(prior.updatedAt + 1000)
      saveState({ summary: 'replaced summary' })

      const row = saveChecked({ expectedUpdatedAt: prior.updatedAt, sourceMessageIds: [ANCHOR_ID] })

      expect(row).toBeNull()
      expect(agentSessionRuntimeStateService.getState(SESSION_ID, RUNTIME_TYPE)).toMatchObject({
        summary: 'replaced summary'
      })
    })

    it('writes over the matching prior state when the guard holds', () => {
      const prior = saveState()

      const row = saveChecked({ expectedUpdatedAt: prior.updatedAt, sourceMessageIds: [ANCHOR_ID] })

      expect(row).toMatchObject({ summary: 'fresh summary' })
    })
  })
})
