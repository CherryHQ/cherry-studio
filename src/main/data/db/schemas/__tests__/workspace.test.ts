import { workspaceTable } from '@data/db/schemas/workspace'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('workspaceTable', () => {
  const dbh = setupTestDatabase()

  it('defaults workspace type to user at the database boundary', async () => {
    await dbh.db.insert(workspaceTable).values({
      id: 'workspace-default-type',
      name: 'Default Type',
      path: '/tmp/workspace-default-type',
      orderKey: 'a0'
    })

    const [row] = await dbh.db.select().from(workspaceTable).where(eq(workspaceTable.id, 'workspace-default-type'))
    expect(row.type).toBe('user')
  })

  it('rejects workspace type values outside the supported enum', async () => {
    await expect(
      dbh.db.insert(workspaceTable).values({
        id: 'workspace-invalid-type',
        name: 'Invalid Type',
        path: '/tmp/workspace-invalid-type',
        type: 'remote' as never,
        orderKey: 'a0'
      })
    ).rejects.toThrow()
  })
})
