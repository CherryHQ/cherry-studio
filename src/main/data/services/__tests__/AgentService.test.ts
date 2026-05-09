import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { pinService } from '@data/services/PinService'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: vi.fn()
  }
}))

vi.mock('@main/services/agents/skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: vi.fn()
  }
}))

// Mock workspace seeding — filesystem ops not needed in unit tests
vi.mock('@main/services/agents/services/cherryclaw/seedWorkspace', () => ({
  seedWorkspaceTemplates: vi.fn()
}))

// Mock agentUtils functions that call external services
vi.mock('@main/services/agents/agentUtils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    validateAgentModels: vi.fn().mockResolvedValue(undefined),
    resolveAccessiblePaths: vi.fn((paths: string[]) => paths)
  }
})

describe('AgentService', () => {
  const dbh = setupTestDatabase()
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  // Seed a user_model row whose id is the canonical FK form, so createAgent
  // calls with `model: <canonical id>` satisfy the FK.
  const TEST_MODEL_ID = 'anthropic::claude-3-5-sonnet'
  beforeEach(async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'anthropic' }).onConflictDoNothing()
    await dbh.db
      .insert(userModelTable)
      .values({ id: TEST_MODEL_ID, providerId: 'anthropic', modelId: 'claude-3-5-sonnet' })
      .onConflictDoNothing()
  })

  async function insertAgent(overrides: Partial<typeof agentTable.$inferInsert> = {}): Promise<{ id: string }> {
    const id = overrides.id ?? `agent_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const base: typeof agentTable.$inferInsert = {
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      // FK to user_model.id; tests insert NULL since they don't exercise model behavior.
      model: null,
      orderKey: 'a0',
      ...overrides,
      id
    }
    await dbh.db.insert(agentTable).values(base)
    return { id }
  }

  describe('createAgent', () => {
    it('generates a UUID v4 agent ID', async () => {
      const agent = await agentService.createAgent({
        type: 'claude-code',
        name: 'UUID ID Test',
        model: TEST_MODEL_ID
      })

      expect(agent.id).toMatch(uuidV4Pattern)
    })

    it('places newly created agents at the top of asc(orderKey) listings', async () => {
      await insertAgent({ id: 'agent_existing_a', orderKey: 'a1' })
      await insertAgent({ id: 'agent_existing_b', orderKey: 'a2' })

      const created = await agentService.createAgent({
        type: 'claude-code',
        name: 'Newest',
        model: TEST_MODEL_ID
      })

      const { agents } = await agentService.listAgents()
      expect(agents[0]?.id).toBe(created.id)
    })
  })

  describe('deleteAgent', () => {
    it('hard-deletes an agent and removes the row', async () => {
      const { id } = await insertAgent({ id: 'agent_regular_test_001' })

      const deleted = await agentService.deleteAgent(id)

      expect(deleted).toBe(true)
      const rows = await dbh.db.select().from(agentTable)
      expect(rows.find((r) => r.id === id)).toBeUndefined()
    })

    it('purges agent pins on delete (pin table has no FK)', async () => {
      const { id } = await insertAgent({ id: 'agent_with_pin_001' })
      const otherAgent = await insertAgent({ id: 'agent_other_002' })
      await pinService.pin({ entityType: 'agent', entityId: id })
      const otherPin = await pinService.pin({ entityType: 'agent', entityId: otherAgent.id })

      await agentService.deleteAgent(id)

      const remaining = await pinService.listByEntityType('agent')
      expect(remaining.map((p) => p.entityId)).toEqual([otherPin.entityId])
    })
  })

  describe('listAgents', () => {
    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await insertAgent({ name: `Agent ${i}`, orderKey: `a${i}` })
      }

      const page1 = await agentService.listAgents({ limit: 2, offset: 0 })
      const page2 = await agentService.listAgents({ limit: 2, offset: 2 })

      expect(page1.agents).toHaveLength(2)
      expect(page2.agents).toHaveLength(2)
      expect(page1.total).toBe(5)
      // Pages should not overlap
      const ids1 = page1.agents.map((a) => a.id)
      const ids2 = page2.agents.map((a) => a.id)
      expect(ids1.some((id) => ids2.includes(id))).toBe(false)
    })

    it('sorts by name ascending when sortBy=name and orderBy=asc', async () => {
      await insertAgent({ name: 'Zebra', orderKey: 'a0' })
      await insertAgent({ name: 'Alpha', orderKey: 'a1' })
      await insertAgent({ name: 'Mango', orderKey: 'a2' })

      const { agents } = await agentService.listAgents({ sortBy: 'name', orderBy: 'asc' })

      const names = agents.map((a) => a.name)
      expect(names).toEqual([...names].sort())
    })
  })
})
