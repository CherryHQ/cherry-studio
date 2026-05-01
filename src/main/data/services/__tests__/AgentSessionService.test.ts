import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionService, buildSessionUpdateData } from '@data/services/AgentSessionService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────
// buildSessionUpdateData — pure function, no DB needed
// ─────────────────────────────────────────────────────────

describe('buildSessionUpdateData', () => {
  it('includes slashCommands in session updates', () => {
    const updateData = buildSessionUpdateData(
      {
        name: 'Updated session',
        slashCommands: [{ command: '/ship', description: 'Ship it' }]
      },
      123
    )

    expect(updateData).toMatchObject({
      updatedAt: 123,
      name: 'Updated session',
      slashCommands: [{ command: '/ship', description: 'Ship it' }]
    })
  })

  it('normalizes explicit undefined fields to null', () => {
    const updateData = buildSessionUpdateData({ description: undefined }, 456)

    expect(updateData).toMatchObject({
      updatedAt: 456,
      description: null
    })
  })
})

// ─────────────────────────────────────────────────────────
// AgentSessionService — DB-backed tests
// ─────────────────────────────────────────────────────────

describe('AgentSessionService', () => {
  const dbh = setupTestDatabase()

  /**
   * Seed a user_model row whose id matches the canonical FK shape
   * (`provider::modelId`), so tests that exercise model behavior on the
   * agent/session FK columns have a valid target.
   */
  async function seedUserModel(providerId: string, modelId: string): Promise<string> {
    await dbh.db.insert(userProviderTable).values({ providerId, name: providerId }).onConflictDoNothing()
    const id = `${providerId}::${modelId}`
    await dbh.db.insert(userModelTable).values({ id, providerId, modelId }).onConflictDoNothing()
    return id
  }

  async function insertAgent(id: string, opts: { model?: string | null } = {}) {
    // `model` defaults to NULL because most tests don't exercise model behavior
    // and would otherwise need a user_model fixture for the FK.
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      model: opts.model ?? null,
      sortOrder: 0
    })
    return id
  }

  describe('createSession', () => {
    it('creates a session inheriting agent defaults', async () => {
      const modelId = await seedUserModel('anthropic', 'claude-3-5-sonnet')
      const agentId = await insertAgent(`agent_${Date.now()}_create`, { model: modelId })
      const session = await agentSessionService.createSession(agentId)

      expect(session).not.toBeNull()
      expect(session!.agentId).toBe(agentId)
      expect(session!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(session!.model).toBe(modelId)
      expect(session!.agentType).toBe('claude-code')
    })

    it('overrides agent defaults with provided fields', async () => {
      const agentModel = await seedUserModel('anthropic', 'claude-3-5-sonnet')
      const overrideModel = await seedUserModel('anthropic', 'claude-3-opus')
      const agentId = await insertAgent(`agent_${Date.now()}_override`, { model: agentModel })
      const session = await agentSessionService.createSession(agentId, {
        name: 'Custom Session',
        model: overrideModel
      })

      expect(session!.name).toBe('Custom Session')
      expect(session!.model).toBe(overrideModel)
    })

    it('throws NOT_FOUND when agent does not exist', async () => {
      await expect(agentSessionService.createSession('nonexistent-agent')).rejects.toMatchObject({
        code: 'NOT_FOUND'
      })
    })

    it('places newly created sessions at the top of asc(sortOrder) listings', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_prepend`)
      await agentSessionService.createSession(agentId, { name: 'older-1' })
      await agentSessionService.createSession(agentId, { name: 'older-2' })
      const newest = await agentSessionService.createSession(agentId, { name: 'newest' })

      const { sessions } = await agentSessionService.listSessions(agentId)
      expect(sessions[0]?.id).toBe(newest!.id)
    })
  })

  describe('getSession', () => {
    it('returns session by agentId and sessionId', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_get`)
      const created = await agentSessionService.createSession(agentId, { name: 'Get Test' })

      const found = await agentSessionService.getSession(agentId, created!.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created!.id)
      expect(found!.name).toBe('Get Test')
    })

    it('returns null when session does not exist', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_getmiss`)
      const result = await agentSessionService.getSession(agentId, 'nonexistent')
      expect(result).toBeNull()
    })

    it('returns null when agentId does not match', async () => {
      const agentId1 = await insertAgent(`agent_${Date.now()}_ga`)
      const agentId2 = await insertAgent(`agent_${Date.now()}_gb`)
      const session = await agentSessionService.createSession(agentId1)

      const result = await agentSessionService.getSession(agentId2, session!.id)
      expect(result).toBeNull()
    })
  })

  describe('listSessions', () => {
    it('lists sessions for an agent', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_list`)
      await agentSessionService.createSession(agentId, { name: 'S1' })
      await agentSessionService.createSession(agentId, { name: 'S2' })

      const { sessions, total } = await agentSessionService.listSessions(agentId)
      expect(total).toBe(2)
      expect(sessions).toHaveLength(2)
    })

    it('respects limit and offset', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_paginate`)
      await agentSessionService.createSession(agentId, { name: 'P1' })
      await agentSessionService.createSession(agentId, { name: 'P2' })
      await agentSessionService.createSession(agentId, { name: 'P3' })

      const { sessions, total } = await agentSessionService.listSessions(agentId, { limit: 2, offset: 0 })
      expect(total).toBe(3)
      expect(sessions).toHaveLength(2)
    })
  })

  describe('updateSession', () => {
    it('updates session fields', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_upd`)
      const session = await agentSessionService.createSession(agentId, { name: 'Before' })

      const updated = await agentSessionService.updateSession(agentId, session!.id, { name: 'After' })
      expect(updated!.name).toBe('After')
    })

    it('returns null when session does not exist', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_updmiss`)
      const result = await agentSessionService.updateSession(agentId, 'nonexistent', { name: 'x' })
      expect(result).toBeNull()
    })

    it('rejects empty accessiblePaths', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_paths`)
      const session = await agentSessionService.createSession(agentId)

      await expect(
        agentSessionService.updateSession(agentId, session!.id, { accessiblePaths: [] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })
  })

  describe('deleteSession', () => {
    it('deletes a session and returns true', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_del`)
      const session = await agentSessionService.createSession(agentId)

      const deleted = await agentSessionService.deleteSession(agentId, session!.id)
      expect(deleted).toBe(true)

      const found = await agentSessionService.getSession(agentId, session!.id)
      expect(found).toBeNull()
    })

    it('returns false when session does not exist', async () => {
      const agentId = await insertAgent(`agent_${Date.now()}_delmiss`)
      const result = await agentSessionService.deleteSession(agentId, 'nonexistent')
      expect(result).toBe(false)
    })
  })
})
