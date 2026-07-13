import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
// Importing the singleton loads AgentGlobalSkillService so it self-registers in the
// data-service registry, which createAgent resolves lazily for skill validation/join.
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { pinService } from '@data/services/PinService'
import { generateOrderKeyBetween, generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api/errors'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// The data-service layer is synchronous under better-sqlite3: failing calls
// throw inline instead of rejecting a promise. Capture the thrown error so we
// can assert on its shape.
function captureError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('Expected the call to throw, but it returned normally')
}

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

describe('AgentService', () => {
  const dbh = setupTestDatabase()
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  // Seed a user_model row whose id is the canonical FK form, so createAgent
  // calls with `model: <canonical id>` satisfy the FK.
  const TEST_MODEL_ID = 'anthropic::claude-3-5-sonnet'
  beforeEach(async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'anthropic', name: 'anthropic', orderKey: generateOrderKeyBetween(null, null) })
      .onConflictDoNothing()
    await dbh.db
      .insert(userModelTable)
      .values({
        id: TEST_MODEL_ID,
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        name: 'claude-3-5-sonnet',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .onConflictDoNothing()
  })

  async function insertAgent(
    overrides: Partial<typeof agentTable.$inferInsert> & { mcps?: string[] } = {}
  ): Promise<{ id: string }> {
    const id = overrides.id ?? `agent_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const { mcps, ...rest } = overrides
    const base: typeof agentTable.$inferInsert = {
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      // FK to user_model.id; tests insert NULL since they don't exercise model behavior.
      model: null,
      orderKey: 'a0',
      ...rest,
      id
    }
    await dbh.db.insert(agentTable).values(base)
    // Insert junction rows for MCP associations
    if (mcps && mcps.length > 0) {
      await dbh.db.insert(agentMcpServerTable).values(mcps.map((mcpId) => ({ agentId: id, mcpServerId: mcpId })))
    }
    return { id }
  }

  async function seedModelRefs() {
    await dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'anthropic',
        name: 'Anthropic',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .onConflictDoNothing()
    await dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId('anthropic', 'claude-sonnet-4-5'),
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        presetModelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        isEnabled: true,
        isHidden: false,
        orderKey: generateOrderKeyBetween(null, null)
      })
      .onConflictDoNothing()
  }

  async function insertMcpServer(id: string, name?: string): Promise<void> {
    await dbh.db
      .insert(mcpServerTable)
      .values({ id, name: name ?? id, sortOrder: 0, isActive: false })
      .onConflictDoNothing()
  }

  async function insertGlobalSkill(id: string, folderName?: string, source: string = 'local'): Promise<void> {
    await dbh.db
      .insert(agentGlobalSkillTable)
      .values({ id, name: id, folderName: folderName ?? id, source, contentHash: `hash-${id}` })
      .onConflictDoNothing()
  }

  describe('createAgent', () => {
    it('generates a UUID v4 agent ID', async () => {
      const agent = agentService.createAgent({
        type: 'claude-code',
        name: 'UUID ID Test',
        model: TEST_MODEL_ID
      })

      expect(agent.id).toMatch(uuidV4Pattern)
    })

    it('persists plan and small models when provided', async () => {
      const agent = agentService.createAgent({
        type: 'claude-code',
        name: 'Model Roles Test',
        model: TEST_MODEL_ID,
        planModel: TEST_MODEL_ID,
        smallModel: TEST_MODEL_ID
      })

      expect(agent).toMatchObject({
        model: TEST_MODEL_ID,
        planModel: TEST_MODEL_ID,
        smallModel: TEST_MODEL_ID
      })
    })

    it('does not mislabel non-skill FK failures as stale selected skills', async () => {
      const error = captureError(() =>
        agentService.createAgent({
          type: 'claude-code',
          name: 'Missing Model',
          model: 'anthropic::missing-model'
        })
      )
      expect(error).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'Agent' },
        message: expect.not.stringContaining('selected skill no longer exists')
      })

      const agents = await dbh.db.select().from(agentTable).where(eq(agentTable.name, 'Missing Model'))
      expect(agents).toHaveLength(0)
    })

    it('places newly created agents by default orderKey sort', async () => {
      await insertAgent({ id: 'agent_existing_a' })
      await insertAgent({ id: 'agent_existing_b' })

      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Newest',
        model: TEST_MODEL_ID
      })

      const { agents } = agentService.listAgents()
      expect(agents.at(-1)?.id).toBe(created.id)
    })

    it('defaults disabledTools to an empty array (opt-out, backward-safe)', async () => {
      const agent = agentService.createAgent({
        type: 'claude-code',
        name: 'Disabled Tools Default',
        model: TEST_MODEL_ID
      })
      const reloaded = agentService.getAgent(agent.id)
      expect(reloaded?.disabledTools).toEqual([])
    })
  })

  describe('builtin_role write protection', () => {
    it('rejects createAgent when configuration carries a builtin_role', async () => {
      const error = captureError(() =>
        agentService.createAgent({
          type: 'claude-code',
          name: 'Forged Assistant',
          model: TEST_MODEL_ID,
          configuration: { builtin_role: 'assistant' }
        })
      )
      expect(error).toMatchObject({
        code: ErrorCode.INVALID_OPERATION,
        message: expect.stringContaining('builtin_role')
      })

      const agents = await dbh.db.select().from(agentTable).where(eq(agentTable.name, 'Forged Assistant'))
      expect(agents).toHaveLength(0)
    })

    it('rejects updateAgent adding a builtin_role to an ordinary agent', async () => {
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Ordinary Agent',
        model: TEST_MODEL_ID
      })

      const error = captureError(() =>
        agentService.updateAgent(created.id, { configuration: { builtin_role: 'assistant' } })
      )
      expect(error).toMatchObject({ code: ErrorCode.INVALID_OPERATION })
      expect(agentService.getAgent(created.id)?.configuration?.builtin_role).toBeUndefined()
    })

    it('rejects updateAgent changing an existing builtin_role', async () => {
      // Seed through the internal tx path, as the Cherry Assistant seeder does.
      const agentId = 'agent_builtin_change'
      await insertAgent({ id: agentId, configuration: { builtin_role: 'assistant' } })

      const error = captureError(() => agentService.updateAgent(agentId, { configuration: { builtin_role: 'other' } }))
      expect(error).toMatchObject({ code: ErrorCode.INVALID_OPERATION })
      expect(agentService.getAgent(agentId)?.configuration?.builtin_role).toBe('assistant')
    })

    it('preserves the builtin_role when an update omits it from configuration', async () => {
      const agentId = 'agent_builtin_preserve'
      await insertAgent({ id: agentId, configuration: { builtin_role: 'assistant', avatar: '🍒' } })

      const updated = agentService.updateAgent(agentId, { configuration: { avatar: '🅰️' } })
      expect(updated?.configuration?.builtin_role).toBe('assistant')
      expect(updated?.configuration?.avatar).toBe('🅰️')
    })

    it('accepts an update that carries the existing builtin_role unchanged', async () => {
      const agentId = 'agent_builtin_roundtrip'
      await insertAgent({ id: agentId, configuration: { builtin_role: 'assistant' } })

      const updated = agentService.updateAgent(agentId, {
        configuration: { builtin_role: 'assistant', avatar: '🍒' }
      })
      expect(updated?.configuration?.builtin_role).toBe('assistant')
      expect(updated?.configuration?.avatar).toBe('🍒')
    })
  })

  describe('disabledTools round-trip', () => {
    it('persists disabledTools on create and update', async () => {
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Disabled Tools',
        model: TEST_MODEL_ID,
        disabledTools: ['Bash']
      })
      expect(created.disabledTools).toEqual(['Bash'])

      const updated = agentService.updateAgent(created.id, { disabledTools: ['Bash', 'Workflow'] })
      expect(updated?.disabledTools).toEqual(['Bash', 'Workflow'])

      const reloaded = agentService.getAgent(created.id)
      expect(reloaded?.disabledTools).toEqual(['Bash', 'Workflow'])
    })
  })

  describe('mcps round-trip', () => {
    it('persists mcps on create through the service', async () => {
      await insertMcpServer('mcp_a')
      await insertMcpServer('mcp_b')

      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Create',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a', 'mcp_b']
      })
      expect([...(created.mcps ?? [])].sort()).toEqual(['mcp_a', 'mcp_b'])

      const reloaded = agentService.getAgent(created.id)
      expect([...(reloaded?.mcps ?? [])].sort()).toEqual(['mcp_a', 'mcp_b'])
    })

    it('replaces mcps when update provides a new array', async () => {
      await insertMcpServer('mcp_a')
      await insertMcpServer('mcp_b')
      await insertMcpServer('mcp_c')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Replace',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a', 'mcp_b']
      })

      const updated = agentService.updateAgent(created.id, { mcps: ['mcp_c'] })
      expect(updated?.mcps).toEqual(['mcp_c'])

      const reloaded = agentService.getAgent(created.id)
      expect(reloaded?.mcps).toEqual(['mcp_c'])
    })

    // Load-bearing: the `if (newMcps !== undefined)` guard in updateAgent. If it
    // ever regressed to an unconditional delete, every unrelated update (e.g. a
    // rename) would wipe an agent's MCP servers — the exact data-loss class this
    // PR fixes.
    it('preserves existing mcps when update omits the field', async () => {
      await insertMcpServer('mcp_a')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Preserve',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a']
      })

      const updated = agentService.updateAgent(created.id, { name: 'Renamed' })
      expect(updated?.name).toBe('Renamed')
      expect(updated?.mcps).toEqual(['mcp_a'])

      const reloaded = agentService.getAgent(created.id)
      expect(reloaded?.mcps).toEqual(['mcp_a'])
    })

    it('clears mcps when update passes an empty array', async () => {
      await insertMcpServer('mcp_a')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'MCP Clear',
        model: TEST_MODEL_ID,
        mcps: ['mcp_a']
      })

      const updated = agentService.updateAgent(created.id, { mcps: [] })
      expect(updated?.mcps).toEqual([])

      const reloaded = agentService.getAgent(created.id)
      expect(reloaded?.mcps).toEqual([])
    })
  })

  describe('skill enablement round-trip', () => {
    it('enables the provided global skills for the new agent on create', async () => {
      await insertGlobalSkill('skill_a')
      await insertGlobalSkill('skill_b')

      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Skill Create',
        model: TEST_MODEL_ID,
        skillIds: ['skill_a', 'skill_b', 'skill_a'] // duplicate is deduped
      })

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, created.id))
      expect(rows.map((r) => r.skillId).sort()).toEqual(['skill_a', 'skill_b'])
      expect(rows.every((r) => r.isEnabled)).toBe(true)
    })

    it('writes no skill rows when skillIds is omitted or empty', async () => {
      const omitted = agentService.createAgent({ type: 'claude-code', name: 'No Skills', model: TEST_MODEL_ID })
      const empty = agentService.createAgent({
        type: 'claude-code',
        name: 'Empty Skills',
        model: TEST_MODEL_ID,
        skillIds: []
      })

      for (const id of [omitted.id, empty.id]) {
        const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, id))
        expect(rows).toHaveLength(0)
      }
    })

    it('rejects with NOT_FOUND and persists no agent when a skillId does not exist', async () => {
      const error = captureError(() =>
        agentService.createAgent({
          type: 'claude-code',
          name: 'Bad Skill',
          model: TEST_MODEL_ID,
          skillIds: ['does_not_exist']
        })
      )
      expect(error).toMatchObject({ code: ErrorCode.NOT_FOUND })

      const agents = await dbh.db.select().from(agentTable).where(eq(agentTable.name, 'Bad Skill'))
      expect(agents).toHaveLength(0)
    })

    it('reports a stale selected skill if the FK races after pre-validation', async () => {
      await insertGlobalSkill('skill_race')
      const originalGetById = agentGlobalSkillService.getById.bind(agentGlobalSkillService)
      const getByIdSpy = vi.spyOn(agentGlobalSkillService, 'getById').mockImplementationOnce((skillId) => {
        const skill = originalGetById(skillId)
        dbh.db.delete(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, skillId)).run()
        return skill
      })

      try {
        const error = captureError(() =>
          agentService.createAgent({
            type: 'claude-code',
            name: 'Raced Skill',
            model: TEST_MODEL_ID,
            skillIds: ['skill_race']
          })
        )
        expect(error).toMatchObject({
          code: ErrorCode.INVALID_OPERATION,
          message: expect.stringContaining('selected skill no longer exists')
        })
      } finally {
        getByIdSpy.mockRestore()
      }

      const agents = await dbh.db.select().from(agentTable).where(eq(agentTable.name, 'Raced Skill'))
      expect(agents).toHaveLength(0)
    })

    it('leaves skill rows unchanged when update omits skillUpdates', async () => {
      await insertGlobalSkill('skill_a')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Skill Preserve',
        model: TEST_MODEL_ID,
        skillIds: ['skill_a']
      })

      agentService.updateAgent(created.id, { name: 'Renamed Skill Preserve' })

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, created.id))
      expect(rows.map((r) => r.skillId)).toEqual(['skill_a'])
      expect(rows.every((r) => r.isEnabled)).toBe(true)
    })

    it('applies skillUpdates without replacing omitted skill rows', async () => {
      await insertGlobalSkill('skill_a')
      await insertGlobalSkill('skill_b')
      await insertGlobalSkill('skill_c')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Skill Replace',
        model: TEST_MODEL_ID,
        skillIds: ['skill_a', 'skill_b']
      })

      agentService.updateAgent(created.id, {
        skillUpdates: [
          { skillId: 'skill_a', isEnabled: false },
          { skillId: 'skill_c', isEnabled: true }
        ]
      })

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, created.id))
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skillId: 'skill_a', isEnabled: false }),
          expect.objectContaining({ skillId: 'skill_b', isEnabled: true }),
          expect.objectContaining({ skillId: 'skill_c', isEnabled: true })
        ])
      )
      expect(rows).toHaveLength(3)
    })

    it('writes an explicit disabled row when a builtin skill is disabled', async () => {
      await insertGlobalSkill('skill_builtin', undefined, 'builtin')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Builtin Disable',
        model: TEST_MODEL_ID
      })

      agentService.updateAgent(created.id, {
        skillUpdates: [{ skillId: 'skill_builtin', isEnabled: false }]
      })

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, created.id))
      expect(rows).toEqual([expect.objectContaining({ skillId: 'skill_builtin', isEnabled: false })])
    })

    it('preserves disabled builtin rows when applying other skill updates', async () => {
      await insertGlobalSkill('skill_builtin', undefined, 'builtin')
      await insertGlobalSkill('skill_regular')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Builtin Preserve',
        model: TEST_MODEL_ID
      })
      await dbh.db.insert(agentSkillTable).values({ agentId: created.id, skillId: 'skill_builtin', isEnabled: false })

      agentService.updateAgent(created.id, {
        skillUpdates: [{ skillId: 'skill_regular', isEnabled: true }]
      })

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, created.id))
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skillId: 'skill_builtin', isEnabled: false }),
          expect.objectContaining({ skillId: 'skill_regular', isEnabled: true })
        ])
      )
      expect(rows).toHaveLength(2)
    })

    it('rejects update skillUpdates when a selected skill does not exist', async () => {
      await insertGlobalSkill('skill_a')
      const created = agentService.createAgent({
        type: 'claude-code',
        name: 'Skill Bad Update',
        model: TEST_MODEL_ID,
        skillIds: ['skill_a']
      })

      const error = captureError(() =>
        agentService.updateAgent(created.id, { skillUpdates: [{ skillId: 'missing_skill', isEnabled: true }] })
      )
      expect(error).toMatchObject({ code: ErrorCode.NOT_FOUND })

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, created.id))
      expect(rows.map((r) => r.skillId)).toEqual(['skill_a'])
    })
  })

  describe('deleteAgent', () => {
    it('hard-deletes an agent and removes the row', async () => {
      const { id } = await insertAgent({ id: 'agent_regular_test_001' })

      const result = agentService.deleteAgent(id)

      expect(result.deleted).toBe(true)
      expect(result.deletedSessionIds).toBeUndefined()
      const rows = await dbh.db.select().from(agentTable)
      expect(rows.find((r) => r.id === id)).toBeUndefined()
    })

    it('purges agent pins on delete (pin table has no FK)', async () => {
      const { id } = await insertAgent({ id: 'agent_with_pin_001' })
      const otherAgent = await insertAgent({ id: 'agent_other_002' })
      pinService.pin({ entityType: 'agent', entityId: id })
      const otherPin = pinService.pin({ entityType: 'agent', entityId: otherAgent.id })

      agentService.deleteAgent(id)

      const remaining = pinService.listByEntityType('agent')
      expect(remaining.map((p) => p.entityId)).toEqual([otherPin.entityId])
    })

    it('deletes agent sessions atomically when requested', async () => {
      const { id } = await insertAgent({ id: 'agent_with_sessions_001' })
      const otherAgent = await insertAgent({ id: 'agent_with_sessions_002' })
      await dbh.db.insert(agentWorkspaceTable).values([
        { id: 'workspace-agent-delete-1', name: 'Workspace 1', path: '/tmp/agent-delete-1', orderKey: 'a0' },
        { id: 'workspace-agent-delete-2', name: 'Workspace 2', path: '/tmp/agent-delete-2', orderKey: 'a1' }
      ])
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'session-delete-with-agent',
          agentId: id,
          name: '',
          workspaceId: 'workspace-agent-delete-1',
          orderKey: 'a0'
        },
        {
          id: 'session-keep-with-other-agent',
          agentId: otherAgent.id,
          name: '',
          workspaceId: 'workspace-agent-delete-2',
          orderKey: 'a1'
        }
      ])

      const result = agentService.deleteAgent(id, { deleteSessions: true })

      expect(result.deleted).toBe(true)
      expect(result.deletedSessionIds).toEqual(['session-delete-with-agent'])
      const agentRows = await dbh.db.select().from(agentTable).where(eq(agentTable.id, id))
      expect(agentRows).toHaveLength(0)
      const sessionRows = await dbh.db.select().from(agentSessionTable)
      expect(sessionRows.map((row) => row.id)).toEqual(['session-keep-with-other-agent'])
    })

    it('rolls back the already-deleted sessions when a later delete step fails', async () => {
      const { id } = await insertAgent({ id: 'agent_delete_rollback_001' })
      await dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: 'workspace-rollback-1', name: 'Workspace', path: '/tmp/agent-rollback-1', orderKey: 'a0' })
      await dbh.db.insert(agentSessionTable).values({
        id: 'session-rollback-1',
        agentId: id,
        name: '',
        workspaceId: 'workspace-rollback-1',
        orderKey: 'a0'
      })

      // Run the delete inside a real transaction so a mid-transaction failure rolls back;
      // the default DbService mock just passes the callback through without one.
      ;(application.get('DbService').withWriteTx as Mock).mockImplementationOnce((fn) =>
        dbh.db.transaction(fn as never)
      )
      // Fail *after* deleteByAgentIdTx has already removed the session rows, so the assertions
      // below can only pass if that earlier delete is rolled back with the agent delete.
      const deleteAgentSpy = vi.spyOn(agentService, 'deleteAgentTx').mockImplementationOnce(() => {
        throw new Error('agent delete failed')
      })

      try {
        expect(() => agentService.deleteAgent(id, { deleteSessions: true })).toThrow('agent delete failed')
      } finally {
        deleteAgentSpy.mockRestore()
      }

      const agentRows = await dbh.db.select().from(agentTable).where(eq(agentTable.id, id))
      expect(agentRows).toHaveLength(1)
      const sessionRows = await dbh.db
        .select()
        .from(agentSessionTable)
        .where(eq(agentSessionTable.id, 'session-rollback-1'))
      expect(sessionRows).toHaveLength(1)
    })
  })

  describe('McpServerService.delete() cascade', () => {
    it('removes a deleted MCP server and cascade-removes references from all agents', async () => {
      const mcpId = 'mcp_to_delete'
      await insertMcpServer(mcpId)
      await insertMcpServer('mcp_keep')
      await insertAgent({ id: 'agent_with_mcp_1', mcps: [mcpId, 'mcp_keep'] })
      await insertAgent({ id: 'agent_with_mcp_2', mcps: [mcpId] })
      await insertAgent({ id: 'agent_without_mcp', mcps: ['mcp_keep'] })

      const events: Array<{ agentId: string; mcps: string[] }> = []
      const disposable = agentService.onAgentUpdated((e) => {
        if (e.updates.mcps) events.push({ agentId: e.agentId, mcps: e.updates.mcps })
      })

      mcpServerService.delete(mcpId)

      // MCP server row should be deleted
      const remainingMcps = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, mcpId))
      expect(remainingMcps).toHaveLength(0)

      const agent1 = agentService.getAgent('agent_with_mcp_1')
      const agent2 = agentService.getAgent('agent_with_mcp_2')
      const agent3 = agentService.getAgent('agent_without_mcp')

      expect(agent1?.mcps).toEqual(['mcp_keep'])
      expect(agent2?.mcps).toEqual([])
      expect(agent3?.mcps).toEqual(['mcp_keep'])

      expect(events).toHaveLength(2)
      expect(events.find((e) => e.agentId === 'agent_with_mcp_1')?.mcps).toEqual(['mcp_keep'])
      expect(events.find((e) => e.agentId === 'agent_with_mcp_2')?.mcps).toEqual([])

      disposable.dispose()
    })

    it('emits no events when no agents reference the deleted MCP', async () => {
      await insertMcpServer('mcp_alone')
      await insertMcpServer('mcp_other')
      await insertAgent({ id: 'agent_no_ref', mcps: ['mcp_other'] })

      const events: Array<{ agentId: string; mcps: string[] }> = []
      const disposable = agentService.onAgentUpdated((e) => {
        if (e.updates.mcps) events.push({ agentId: e.agentId, mcps: e.updates.mcps })
      })

      mcpServerService.delete('mcp_alone')

      const agent = agentService.getAgent('agent_no_ref')
      expect(agent?.mcps).toEqual(['mcp_other'])

      expect(events).toHaveLength(0)

      disposable.dispose()
    })

    it('handles agents with empty mcps arrays gracefully', async () => {
      await insertMcpServer('mcp_standalone')
      await insertAgent({ id: 'agent_empty_mcps' })

      const events: Array<{ agentId: string; mcps: string[] }> = []
      const disposable = agentService.onAgentUpdated((e) => {
        if (e.updates.mcps) events.push({ agentId: e.agentId, mcps: e.updates.mcps })
      })

      mcpServerService.delete('mcp_standalone')

      const agent = agentService.getAgent('agent_empty_mcps')
      expect(agent?.mcps).toEqual([])

      expect(events).toHaveLength(0)

      disposable.dispose()
    })
  })

  describe('listAgents', () => {
    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await insertAgent({ name: `Agent ${i}` })
      }

      const page1 = agentService.listAgents({ limit: 2, offset: 0 })
      const page2 = agentService.listAgents({ limit: 2, offset: 2 })

      expect(page1.agents).toHaveLength(2)
      expect(page2.agents).toHaveLength(2)
      expect(page1.total).toBe(5)
      // Pages should not overlap
      const ids1 = page1.agents.map((a) => a.id)
      const ids2 = page2.agents.map((a) => a.id)
      expect(ids1.some((id) => ids2.includes(id))).toBe(false)
    })

    it('sorts by name ascending when sortBy=name and sortOrder=asc', async () => {
      await insertAgent({ name: 'Zebra' })
      await insertAgent({ name: 'Alpha' })
      await insertAgent({ name: 'Mango' })

      const { agents } = agentService.listAgents({ sortBy: 'name', sortOrder: 'asc' })

      const names = agents.map((a) => a.name)
      expect(names).toEqual([...names].sort())
    })

    it('sorts unpinned agents by orderKey by default', async () => {
      await insertAgent({ id: 'agent_order_c', name: 'C', orderKey: 'c' })
      await insertAgent({ id: 'agent_order_a', name: 'A', orderKey: 'a' })
      await insertAgent({ id: 'agent_order_b', name: 'B', orderKey: 'b' })

      const { agents } = agentService.listAgents()

      expect(agents.map((agent) => agent.id)).toEqual(['agent_order_a', 'agent_order_b', 'agent_order_c'])
    })

    it('surfaces pinned agents ahead of unpinned agents under the default orderKey sort', async () => {
      await insertAgent({ id: 'agent_pin_a', name: 'A', orderKey: 'a' })
      await insertAgent({ id: 'agent_pin_b', name: 'B', orderKey: 'b' })
      await insertAgent({ id: 'agent_pin_c', name: 'C', orderKey: 'c' })
      pinService.pin({ entityType: 'agent', entityId: 'agent_pin_c' })
      pinService.pin({ entityType: 'agent', entityId: 'agent_pin_b' })

      const { agents } = agentService.listAgents()

      expect(agents.map((agent) => agent.id)).toEqual(['agent_pin_b', 'agent_pin_c', 'agent_pin_a'])
    })

    it('orders rows with equal updatedAt by id using the requested direction (tiebreaker)', async () => {
      await insertAgent({ id: 'agent_aaa', name: 'A', updatedAt: 5000, createdAt: 5000 })
      await insertAgent({ id: 'agent_zzz', name: 'Z', updatedAt: 5000, createdAt: 5000 })

      const { agents } = agentService.listAgents({ sortBy: 'updatedAt', sortOrder: 'desc' })

      const ids = agents.map((a) => a.id)
      expect(ids.indexOf('agent_zzz')).toBeLessThan(ids.indexOf('agent_aaa'))
    })

    it('sorts by updatedAt without pin-first ordering', async () => {
      await insertAgent({ id: 'agent_updated_old', name: 'Old', updatedAt: 100, createdAt: 100 })
      await insertAgent({ id: 'agent_updated_new', name: 'New', updatedAt: 200, createdAt: 200 })
      pinService.pin({ entityType: 'agent', entityId: 'agent_updated_old' })

      const { agents } = agentService.listAgents({ sortBy: 'updatedAt', sortOrder: 'desc' })

      expect(agents.map((agent) => agent.id).slice(0, 2)).toEqual(['agent_updated_new', 'agent_updated_old'])
    })

    it('does not expose tags in agent rows', async () => {
      const { id: taggedId } = await insertAgent({ id: 'agent_tag_test_1', name: 'tagged' })
      const { id: untaggedId } = await insertAgent({ id: 'agent_tag_test_2', name: 'untagged' })

      const { agents } = agentService.listAgents()

      const tagged = agents.find((agent) => agent.id === taggedId)
      const untagged = agents.find((agent) => agent.id === untaggedId)
      expect(tagged).toBeDefined()
      expect(untagged).toBeDefined()
      expect('tags' in (tagged as object)).toBe(false)
      expect('tags' in (untagged as object)).toBe(false)
    })

    it('embeds modelName resolved from user_model', async () => {
      await seedModelRefs()
      const deletedModelId = createUniqueModelId('anthropic', 'deleted-model')
      await dbh.db.insert(userModelTable).values({
        id: deletedModelId,
        providerId: 'anthropic',
        modelId: 'deleted-model',
        name: 'Deleted Model',
        orderKey: generateOrderKeyBetween(null, null)
      })

      const bound = await insertAgent({
        id: 'agent_model_test_1',
        name: 'bound',
        model: 'anthropic::claude-sonnet-4-5'
      })
      const unbound = await insertAgent({
        id: 'agent_model_test_2',
        name: 'missing',
        model: deletedModelId
      })

      // Drop the row; FK is `ON DELETE set null`, so agent.model becomes NULL.
      await dbh.db.delete(userModelTable).where(eq(userModelTable.id, deletedModelId))

      const { agents } = agentService.listAgents()
      const byId = new Map(agents.map((agent) => [agent.id, agent]))

      expect(byId.get(bound.id)?.modelName).toBe('Claude Sonnet 4.5')
      expect(byId.get(unbound.id)?.modelName).toBeNull()
    })

    it('filters by search against name OR description', async () => {
      await insertAgent({ id: 'agent_search_1', name: 'Research Bot' })
      await insertAgent({ id: 'agent_search_2', name: 'unrelated', description: 'used for research' })
      await insertAgent({ id: 'agent_search_3', name: 'noise' })

      const { agents } = agentService.listAgents({ search: 'research' })

      expect(agents.map((agent) => agent.id).sort()).toEqual(['agent_search_1', 'agent_search_2'])
    })

    it('searches the localized blank builtin description server-side and returns it for display', async () => {
      await insertAgent({
        id: 'agent_builtin_assistant',
        name: 'Cherry Assistant',
        description: '',
        configuration: { builtin_role: 'assistant' }
      })

      const { agents, total } = agentService.listAgents({ search: 'diagnose issues' })

      expect(total).toBe(1)
      expect(agents).toEqual([
        expect.objectContaining({
          id: 'agent_builtin_assistant',
          // Preserve the persistence contract: renderer display fallback must not
          // masquerade as a user-owned database description.
          description: ''
        })
      ])
    })
  })

  describe('search', () => {
    it('returns lean navigation items ordered by updatedAt', async () => {
      await insertAgent({
        id: 'agent_search_old',
        name: 'Needle Old Agent',
        description: 'old agent',
        configuration: { avatar: 'A' },
        updatedAt: 100
      })
      await insertAgent({
        id: 'agent_search_new',
        name: 'Needle New Agent',
        description: 'new agent',
        configuration: { avatar: 'B' },
        updatedAt: 200
      })
      await insertAgent({ id: 'agent_search_miss', name: 'Other', updatedAt: 300 })

      const result = agentService.search({ q: 'Needle', limit: 5 })

      expect(result).toEqual([
        {
          type: 'agent',
          id: 'agent_search_new',
          title: 'Needle New Agent',
          subtitle: 'new agent',
          emoji: 'B',
          updatedAt: '1970-01-01T00:00:00.200Z',
          target: { agentId: 'agent_search_new' }
        },
        {
          type: 'agent',
          id: 'agent_search_old',
          title: 'Needle Old Agent',
          subtitle: 'old agent',
          emoji: 'A',
          updatedAt: '1970-01-01T00:00:00.100Z',
          target: { agentId: 'agent_search_old' }
        }
      ])
      expect(result[0]).not.toHaveProperty('modelName')
    })

    it('matches and displays the localized blank builtin description in global search', async () => {
      await insertAgent({
        id: 'agent_builtin_global_search',
        name: 'Cherry Assistant',
        description: '',
        configuration: { builtin_role: 'assistant' },
        updatedAt: 100
      })

      expect(agentService.search({ q: 'collect FAQs', limit: 5 })).toEqual([
        expect.objectContaining({
          id: 'agent_builtin_global_search',
          subtitle:
            'Built-in Cherry Studio advisor. Diagnose issues, guide operations, collect FAQs, submit bugs/feature requests, and search/create Skills'
        })
      ])
    })
  })

  describe('reorder', () => {
    async function listAgentIds() {
      const { agents } = agentService.listAgents()
      return agents.map((agent) => agent.id)
    }

    it('moves a single active agent by orderKey', async () => {
      const [firstKey, secondKey, thirdKey] = generateOrderKeySequence(3)
      await insertAgent({ id: 'agent_reorder_a', name: 'A', orderKey: firstKey })
      await insertAgent({ id: 'agent_reorder_b', name: 'B', orderKey: secondKey })
      await insertAgent({ id: 'agent_reorder_c', name: 'C', orderKey: thirdKey })

      agentService.reorder('agent_reorder_c', { before: 'agent_reorder_a' })

      expect(await listAgentIds()).toEqual(['agent_reorder_c', 'agent_reorder_a', 'agent_reorder_b'])
    })

    it('rejects a soft-deleted single target without mutating active order', async () => {
      const [firstKey, secondKey, deletedKey] = generateOrderKeySequence(3)
      await insertAgent({ id: 'agent_reorder_a', name: 'A', orderKey: firstKey })
      await insertAgent({ id: 'agent_reorder_b', name: 'B', orderKey: secondKey })
      await insertAgent({ id: 'agent_reorder_deleted', name: 'Deleted', orderKey: deletedKey, deletedAt: 123 })

      const beforeRejectedMove = await listAgentIds()
      expect(captureError(() => agentService.reorder('agent_reorder_deleted', { position: 'first' }))).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
      expect(await listAgentIds()).toEqual(beforeRejectedMove)
    })

    it('applies batch moves and rejects soft-deleted targets without mutating active order', async () => {
      const [firstKey, secondKey, thirdKey, deletedKey] = generateOrderKeySequence(4)
      await insertAgent({ id: 'agent_reorder_a', name: 'A', orderKey: firstKey })
      await insertAgent({ id: 'agent_reorder_b', name: 'B', orderKey: secondKey })
      await insertAgent({ id: 'agent_reorder_c', name: 'C', orderKey: thirdKey })
      await insertAgent({ id: 'agent_reorder_deleted', name: 'Deleted', orderKey: deletedKey, deletedAt: 123 })

      agentService.reorderBatch([
        { id: 'agent_reorder_b', anchor: { position: 'first' } },
        { id: 'agent_reorder_c', anchor: { after: 'agent_reorder_b' } }
      ])
      expect(await listAgentIds()).toEqual(['agent_reorder_b', 'agent_reorder_c', 'agent_reorder_a'])

      const beforeRejectedMove = await listAgentIds()
      expect(
        captureError(() =>
          agentService.reorderBatch([
            { id: 'agent_reorder_a', anchor: { position: 'first' } },
            { id: 'agent_reorder_deleted', anchor: { position: 'last' } }
          ])
        )
      ).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
      expect(await listAgentIds()).toEqual(beforeRejectedMove)
    })
  })
})
