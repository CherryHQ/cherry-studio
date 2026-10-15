import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'

describe('agentWorkspaceTable', () => {
  const dbh = setupTestDatabase()

  it('preserves existing workspace rows when adding multiple-directory support', () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'existing', name: 'Existing', path: '/existing', orderKey: 'a0' })
      .run()
    dbh.sqlite.transaction(() => {
      dbh.sqlite.exec('ALTER TABLE agent_workspace DROP COLUMN additional_directories')
      dbh.sqlite.exec(readFileSync(join(resolveMigrationsPath(), '0027_futuristic_sleepwalker.sql'), 'utf8'))
    })()
    expect(dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, 'existing')).get()).toMatchObject(
      {
        name: 'Existing',
        path: '/existing',
        additionalDirectories: []
      }
    )
  })

  it('defaults workspace type to user at the database boundary', async () => {
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'workspace-default-type',
      name: 'Default Type',
      path: '/tmp/workspace-default-type',
      orderKey: 'a0'
    })

    const [row] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, 'workspace-default-type'))
    expect(row.type).toBe('user')
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
