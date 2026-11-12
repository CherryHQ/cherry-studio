import { replayMigration, setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'

describe('agentWorkspaceTable', () => {
  const dbh = setupTestDatabase()

  it('preserves populated workspaces when adding additional directories', () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'existing', name: 'Existing', path: '/existing', orderKey: 'a0' })
      .run()
    dbh.sqlite.exec('ALTER TABLE agent_workspace DROP COLUMN additional_directories')
    replayMigration(dbh, '0038_gifted_khan')
    expect(dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, 'existing')).get()).toMatchObject(
      {
        name: 'Existing',
        path: '/existing',
        additionalDirectories: []
      }
    )
  })

  it('rejects workspace type values outside the supported enum', async () => {
    await expect(
      dbh.db.insert(agentWorkspaceTable).values({
        id: 'workspace-invalid-type',
        name: 'Invalid Type',
        path: '/tmp/workspace-invalid-type',
        type: 'remote' as never,
        orderKey: 'a0'
      })
    ).rejects.toThrow()
  })
})
