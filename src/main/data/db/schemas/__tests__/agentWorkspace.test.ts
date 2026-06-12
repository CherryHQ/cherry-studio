import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('agentWorkspaceTable', () => {
  const dbh = setupTestDatabase()

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
