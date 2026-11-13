import { setupTestDatabase } from '@test-helpers/db'
import { eq, isNull, sql } from 'drizzle-orm'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { ISeeder } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

function builtinAgents(db: ReturnType<typeof setupTestDatabase>['db']) {
  return db
    .select()
    .from(agentTable)
    .where(sql`json_extract(${agentTable.configuration}, '$.builtin_role') = 'assistant'`)
    .all()
}

describe('CherryAssistantSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(['en-US'])
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
    expect(agent.configuration).toMatchObject({
      builtin_role: 'assistant'
    })
    const [session] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.agentId, agent.id)).all()
    expect(session).toMatchObject({ agentId: agent.id })
    const [workspace] = dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
      .all()
    expect(workspace).toMatchObject({ type: AGENT_WORKSPACE_TYPE.SYSTEM })
  })

  it('seeds successfully when preferred system languages are unavailable', () => {
    vi.mocked(app.getPreferredSystemLanguages).mockImplementation(() => {
      throw new Error('preferred languages unavailable')
    })

    expect(() => new CherryAssistantSeeder().run(dbh.db)).not.toThrow()
  })

  it('preserves an existing permission mode when the seeder reruns', () => {
    new CherryAssistantSeeder().run(dbh.db)
    const [assistant] = builtinAgents(dbh.db)
    dbh.db
      .update(agentTable)
      .set({ configuration: { ...assistant.configuration, permission_mode: 'default' } })
      .where(eq(agentTable.id, assistant.id))
      .run()
    dbh.db
      .insert(appStateTable)
      .values({ key: 'seed:cherryAssistant', value: { version: '1' } })
      .run()

    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder()])

    expect(builtinAgents(dbh.db)).toHaveLength(1)
    const [updated] = builtinAgents(dbh.db)
    expect(updated.configuration).toMatchObject({ permission_mode: 'default' })
    const [journal] = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:cherryAssistant')).all()
    expect(journal?.value).toMatchObject({ version: '2' })
  })

  it('adds Cherry Assistant after a version 1 skip in an existing library and journals the rollout', () => {
    insertOrdinaryAgent()
    dbh.db
      .insert(appStateTable)
      .values({ key: 'seed:cherryAssistant', value: { version: '1' } })
      .run()

    new SeedRunner(dbh.db).runAll([new CherryAssistantSeeder()])

    expect(dbh.db.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()).toHaveLength(2)
    expect(builtinAgents(dbh.db)).toHaveLength(1)
    const [journal] = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:cherryAssistant')).all()
    expect(journal?.value).toMatchObject({ version: new CherryAssistantSeeder().version })
  })

  it('adds Cherry Assistant when only soft-deleted ordinary agents exist', () => {
    const ordinaryAgentId = insertOrdinaryAgent()
    dbh.db
      .update(agentTable)
      .set({ deletedAt: Date.UTC(2026, 0, 1) })
      .where(eq(agentTable.id, ordinaryAgentId))
      .run()

    new CherryAssistantSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()).toHaveLength(1)
    expect(builtinAgents(dbh.db)).toHaveLength(1)
  })

  it('adds Cherry Assistant when orphan sessions record prior library history', () => {
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

    expect(builtinAgents(dbh.db)).toHaveLength(1)
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

  it('does not recreate a soft-deleted Cherry Assistant during the library-wide rollout', () => {
    const runner = new SeedRunner(dbh.db)
    new CherryAssistantSeeder().run(dbh.db)
    const [assistant] = builtinAgents(dbh.db)
    dbh.db
      .update(agentTable)
      .set({ deletedAt: Date.UTC(2026, 0, 1) })
      .where(eq(agentTable.id, assistant.id))
      .run()
    dbh.db
      .insert(appStateTable)
      .values({ key: 'seed:cherryAssistant', value: { version: '1' } })
      .run()

    runner.runAll([new CherryAssistantSeeder()])

    expect(dbh.db.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()).toHaveLength(0)
    expect(builtinAgents(dbh.db)).toHaveLength(1)
    const [journal] = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:cherryAssistant')).all()
    expect(journal?.value).toMatchObject({ version: '2' })
  })
})
