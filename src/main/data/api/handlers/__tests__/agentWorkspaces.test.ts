import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

import { agentWorkspaceHandlers } from '../agentWorkspaces'

describe('agent workspace handlers', () => {
  setupTestDatabase()

  it('rejects an empty rename without changing the stored name', async () => {
    const workspace = agentWorkspaceService.findOrCreateByPath(path.resolve('handler-workspace'), { name: 'Original' })
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].PATCH({
        params: { workspaceId: workspace.id },
        body: {}
      } as never)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(agentWorkspaceService.getById(workspace.id).name).toBe('Original')
  })

  it('renames a workspace without changing its path or identity', async () => {
    const workspace = agentWorkspaceService.findOrCreateByPath(path.resolve('handler-workspace'))
    await agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].PATCH({
      params: { workspaceId: workspace.id },
      body: { name: 'Renamed' }
    })
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].GET({ params: { workspaceId: workspace.id } })
    ).resolves.toMatchObject({ id: workspace.id, path: workspace.path, name: 'Renamed', storage: { type: 'external' } })
  })
})
