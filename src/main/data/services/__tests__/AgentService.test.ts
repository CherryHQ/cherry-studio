import path from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentService } from '@data/services/AgentService'
import { pinService } from '@data/services/PinService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

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
    listMcpTools: vi.fn().mockResolvedValue({ tools: [], legacyIdMap: {} }),
    validateAgentModels: vi.fn().mockResolvedValue(undefined),
    resolveAccessiblePaths: vi.fn((paths: string[]) => paths)
  }
})

describe('AgentService', () => {
  const dbh = setupTestDatabase()
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  async function insertAgent(overrides: Partial<typeof agentTable.$inferInsert> = {}): Promise<{ id: string }> {
    const id = overrides.id ?? `agent_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const base: typeof agentTable.$inferInsert = {
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      model: 'claude-3-5-sonnet',
      sortOrder: 0,
      ...overrides,
      id
    }
    await dbh.db.insert(agentTable).values(base)
    return { id }
  }

  describe('createAgent', () => {
    it('uses a UUID workspace directory instead of deriving it from the agent id', async () => {
      const agent = await agentService.createAgent({
        type: 'claude-code',
        name: 'Workspace Test',
        model: 'claude-3-5-sonnet'
      })

      expect(agent.accessiblePaths).toHaveLength(1)
      const workspace = agent.accessiblePaths[0]
      expect(path.dirname(workspace)).toBe('/mock/feature.agents.workspaces')
      expect(path.basename(workspace)).toMatch(uuidV4Pattern)
      expect(path.basename(workspace)).not.toBe(agent.id.slice(-9))
    })
  })

  describe('deleteAgent', () => {
    it('hard-deletes a non-builtin agent and removes the row', async () => {
      const { id } = await insertAgent({ id: 'agent_regular_test_001' })

      const deleted = await agentService.deleteAgent(id)

      expect(deleted).toBe(true)
      const rows = await dbh.db.select().from(agentTable)
      expect(rows.find((r) => r.id === id)).toBeUndefined()
    })

    it('soft-deletes a builtin agent by setting deletedAt', async () => {
      await insertAgent({ id: 'cherry-claw-default' })

      const deleted = await agentService.deleteAgent('cherry-claw-default')

      expect(deleted).toBe(true)
      const [row] = await dbh.db.select().from(agentTable)
      expect(row?.deletedAt).toBeTruthy()
      // Row still exists in the table
      expect(row?.id).toBe('cherry-claw-default')
    })

    it('purges agent pins on hard delete (pin table has no FK)', async () => {
      const { id } = await insertAgent({ id: 'agent_with_pin_001' })
      const otherAgent = await insertAgent({ id: 'agent_other_002' })
      await pinService.pin({ entityType: 'agent', entityId: id })
      const otherPin = await pinService.pin({ entityType: 'agent', entityId: otherAgent.id })

      await agentService.deleteAgent(id)

      const remaining = await pinService.listByEntityType('agent')
      expect(remaining.map((p) => p.entityId)).toEqual([otherPin.entityId])
    })

    it('purges agent pins on builtin soft delete (pin table has no FK)', async () => {
      await insertAgent({ id: 'cherry-claw-default' })
      await pinService.pin({ entityType: 'agent', entityId: 'cherry-claw-default' })

      await agentService.deleteAgent('cherry-claw-default')

      const remaining = await pinService.listByEntityType('agent')
      expect(remaining).toEqual([])
    })
  })

  describe('listAgents', () => {
    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await insertAgent({ name: `Agent ${i}`, sortOrder: i })
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
      await insertAgent({ name: 'Zebra', sortOrder: 0 })
      await insertAgent({ name: 'Alpha', sortOrder: 1 })
      await insertAgent({ name: 'Mango', sortOrder: 2 })

      const { agents } = await agentService.listAgents({ sortBy: 'name', orderBy: 'asc' })

      const names = agents.map((a) => a.name)
      expect(names).toEqual([...names].sort())
    })
  })
})
