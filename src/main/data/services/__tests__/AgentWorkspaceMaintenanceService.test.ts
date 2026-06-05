import { application } from '@application'
import { AgentWorkspaceMaintenanceService } from '@data/services/AgentWorkspaceMaintenanceService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('AgentWorkspaceMaintenanceService', () => {
  setupTestDatabase()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-maintenance-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sweeps orphan system workspaces on init', async () => {
    const service = new AgentWorkspaceMaintenanceService()
    const workspace = await agentWorkspaceService.createSystemWorkspaceForSession('maintenance-orphan-session')

    await (service as unknown as { onInit(): Promise<void> }).onInit()

    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspace.path)).rejects.toThrow()
  })
})
