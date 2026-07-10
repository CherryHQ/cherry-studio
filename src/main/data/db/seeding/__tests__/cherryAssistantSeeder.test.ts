import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { userModelTable } from '@data/db/schemas/userModel'
import { CherryAiDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, isNull, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

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
