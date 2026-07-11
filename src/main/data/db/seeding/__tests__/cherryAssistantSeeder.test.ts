import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { userModelTable } from '@data/db/schemas/userModel'
import { seeders } from '@data/db/seeding/seederRegistry'
import { CherryAiDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { ISeeder } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, isNull, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

function builtinAgents(db: ReturnType<typeof setupTestDatabase>['db']) {
  return db
    .select()
    .from(agentTable)
    .where(sql`json_extract(${agentTable.configuration}, '$.builtin_role') = 'assistant'`)
    .all()
}

describe('CherryAssistantSeeder', () => {
  const dbh = setupTestDatabase()

  it('uses a constant version so preset changes cannot bypass deletion memory', () => {
    expect(new CherryAssistantSeeder().version).toBe('1')
  })

  it('registers the CherryAI default model before Cherry Assistant in the production registry', () => {
    const modelSeederIndex = seeders.findIndex((seeder) => seeder instanceof CherryAiDefaultModelSeeder)
    const assistantSeederIndex = seeders.findIndex((seeder) => seeder instanceof CherryAssistantSeeder)

    expect(modelSeederIndex).toBeGreaterThanOrEqual(0)
    expect(assistantSeederIndex).toBeGreaterThanOrEqual(0)
    expect(modelSeederIndex).toBeLessThan(assistantSeederIndex)
  })

  function insertOrdinaryAgent(): string {
    const id = 'ordinary-agent'
    dbh.db
      .insert(agentTable)
      .values({
        id,
        type: 'claude-code',
        name: 'Ordinary Agent',
        description: '',
        instructions: 'Ordinary instructions',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    return id
  }

  it('creates the builtin agent with a default system session and workspace in a fresh library', () => {
    new CherryAssistantSeeder().run(dbh.db)

    const [agent] = builtinAgents(dbh.db)
    expect(agent).toMatchObject({
      type: 'claude-code',
      name: 'Cherry Assistant',
      description: '',
      instructions: '',
      model: null
    })
    expect(agent.configuration).toMatchObject({
      avatar: '🍒',
      permission_mode: 'default',
      max_turns: 100,
      env_vars: {},
      builtin_role: 'assistant'
    })

    const [session] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.agentId, agent.id)).all()
    expect(session).toMatchObject({ agentId: agent.id, name: '' })
    const [workspace] = dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
      .all()
    expect(workspace).toMatchObject({ type: AGENT_WORKSPACE_TYPE.SYSTEM })
  })

  it('skips when any active agent exists and SeedRunner still journals the one-time eligibility check', () => {
    insertOrdinaryAgent()

    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder()])

    expect(builtinAgents(dbh.db)).toHaveLength(0)
    const [journal] = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:cherryAssistant')).all()
    expect(journal?.value).toMatchObject({ version: new CherryAssistantSeeder().version })
  })

  it('skips when only soft-deleted agents exist', () => {
    const ordinaryAgentId = insertOrdinaryAgent()
    dbh.db
      .update(agentTable)
      .set({ deletedAt: Date.UTC(2026, 0, 1) })
      .where(eq(agentTable.id, ordinaryAgentId))
      .run()

    new CherryAssistantSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()).toHaveLength(0)
    expect(builtinAgents(dbh.db)).toHaveLength(0)
  })

  it('skips when an orphan session records prior library history before the first seed journal', () => {
    const agentId = 'historical-agent'
    const sessionId = 'historical-session'

    dbh.db.transaction((tx) => {
      agentService.createAgentTx(tx, agentId, {
        id: agentId,
        type: 'claude-code',
        name: 'Historical Agent',
        description: '',
        instructions: 'Historical instructions',
        model: null,
        configuration: {}
      })
      agentSessionService.createTx(tx, sessionId, {
        agentId,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
      agentService.deleteAgentTx(tx, agentId)
    })

    const [orphan] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).all()
    expect(orphan?.agentId).toBeNull()

    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder()])

    expect(builtinAgents(dbh.db)).toHaveLength(0)
    expect(dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:cherryAssistant')).all()).toHaveLength(
      1
    )
  })

  it('seeds after an unrelated seeder closes bootstrap with no prior library history', () => {
    const unrelatedSeeder: ISeeder = {
      name: 'unrelated',
      version: '1',
      description: 'Close the bootstrap window without creating agent history',
      run: vi.fn()
    }
    const runner = new SeedRunner(dbh.db)

    runner.runAll([unrelatedSeeder])
    runner.runAll([new CherryAssistantSeeder()])

    expect(builtinAgents(dbh.db)).toHaveLength(1)
    const [journal] = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:cherryAssistant')).all()
    expect(journal?.value).toMatchObject({ version: new CherryAssistantSeeder().version })
  })

  it('does not create later after the journal is written even if all agents are deleted', () => {
    const ordinaryAgentId = insertOrdinaryAgent()
    const runner = new SeedRunner(dbh.db)
    runner.runAll([new CherryAssistantSeeder()])
    dbh.db.delete(agentTable).where(eq(agentTable.id, ordinaryAgentId)).run()

    runner.runAll([new CherryAssistantSeeder()])

    expect(dbh.db.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()).toHaveLength(0)
    expect(builtinAgents(dbh.db)).toHaveLength(0)
  })

  it('falls back to a null model when the CherryAI default model is absent', () => {
    new CherryAssistantSeeder().run(dbh.db)

    const [agent] = builtinAgents(dbh.db)
    expect(agent.model).toBeNull()
  })

  it('references the CherryAI default model when seeded after CherryAiDefaultModelSeeder', () => {
    new SeedRunner(dbh.db).runAll([new CherryAiDefaultModelSeeder(), new CherryAssistantSeeder()])

    const [model] = dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .all()
    const [agent] = builtinAgents(dbh.db)
    expect(model).toBeDefined()
    expect(agent.model).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })
})
