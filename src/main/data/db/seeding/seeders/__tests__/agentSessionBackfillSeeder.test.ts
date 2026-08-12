import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentSessionBackfillSeeder } from '@data/db/seeding/seeders/agentSessionBackfillSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { agentSessionService } from '@data/services/AgentSessionService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('AgentSessionBackfillSeeder', () => {
  const dbh = setupTestDatabase()

  function insertAgent(id: string, { deleted = false }: { deleted?: boolean } = {}): string {
    dbh.db
      .insert(agentTable)
      .values({
        id,
        type: 'claude-code',
        name: id,
        description: '',
        instructions: 'Instructions',
        orderKey: generateOrderKeyBetween(null, null),
        deletedAt: deleted ? Date.now() : null
      })
      .run()
    return id
  }

  function sessionsOf(agentId: string) {
    return dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.agentId, agentId)).all()
  }

  it('gives an agent stranded without any session a system-workspace one', () => {
    insertAgent('stranded')

    new AgentSessionBackfillSeeder().run(dbh.db)

    const sessions = sessionsOf('stranded')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].name).toBe('')
    const [workspace] = dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, sessions[0].workspaceId))
      .all()
    expect(workspace.type).toBe(AGENT_WORKSPACE_TYPE.SYSTEM)
  })

  it('leaves an agent that already has a session alone', () => {
    insertAgent('reachable')
    dbh.db.transaction((tx) => {
      agentSessionService.createTx(tx, 'existing-session', {
        agentId: 'reachable',
        name: 'Existing',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })

    new AgentSessionBackfillSeeder().run(dbh.db)

    expect(sessionsOf('reachable').map((s) => s.id)).toEqual(['existing-session'])
  })

  it('does not resurrect a deleted agent', () => {
    insertAgent('deleted', { deleted: true })

    new AgentSessionBackfillSeeder().run(dbh.db)

    expect(sessionsOf('deleted')).toHaveLength(0)
  })

  it('backfills once, so a later user deletion of that session sticks', () => {
    insertAgent('stranded')
    const seeders = [new AgentSessionBackfillSeeder()]

    new SeedRunner(dbh.db).runAll(seeders)
    const [seeded] = sessionsOf('stranded')
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, seeded.id)).run()

    new SeedRunner(dbh.db).runAll(seeders)

    expect(sessionsOf('stranded')).toHaveLength(0)
  })
})
