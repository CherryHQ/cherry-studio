import { resolve } from 'node:path'

import { seedSessionRoot, setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentPlanHistoryTable, agentPlanStepIdentityTable, agentPlanTable } from '@data/db/schemas/agentPlan'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentPlanService } from '@data/services/AgentPlanService'

describe('host plan migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0043_regular_bloodstorm' })

  it('keeps existing sessions/messages unchanged, starts empty and preserves new plans on repeated boot', () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Existing', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', workspaceId: 'workspace', name: 'Existing', orderKey: 'a0' })
      .run()
    const parentId = seedSessionRoot(dbh.db, 'session')
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'message',
        parentId,
        sessionId: 'session',
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Existing native plan remains a transcript artifact' }] }
      })
      .run()
    const sessions = dbh.db.select().from(agentSessionTable).all()
    const messages = dbh.db.select().from(agentSessionMessageTable).all()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual(sessions)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messages)
    expect(agentPlanService.get('session')).toBeNull()
    expect(dbh.db.select().from(agentPlanHistoryTable).all()).toEqual([])
    expect(dbh.db.select().from(agentPlanStepIdentityTable).all()).toEqual([])
    const { plan } = dbh.db.transaction((tx) =>
      agentPlanService.replaceTx(tx, 'session', {
        expectedRevision: 0,
        objective: 'Explicit user plan',
        steps: []
      })
    )
    const history = dbh.db.select().from(agentPlanHistoryTable).all()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(agentPlanService.get('session')).toEqual(plan)
    expect(dbh.db.select().from(agentPlanTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentPlanHistoryTable).all()).toEqual(history)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messages)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
