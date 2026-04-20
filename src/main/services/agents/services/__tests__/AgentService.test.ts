import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetModels, mockInitSkillsForAgent } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockInitSkillsForAgent: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: mockGetModels
  }
}))

vi.mock('../../skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: mockInitSkillsForAgent
  }
}))

import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'

import { agentService } from '../AgentService'

function createSelectQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows)
      }))
    }))
  }
}

describe('AgentService built-in agent lifecycle', () => {
  const service = agentService

  beforeEach(() => {
    MockMainDbServiceUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('skips recreating a built-in agent that was soft-deleted by the user', async () => {
    const database = {
      select: vi.fn(() =>
        createSelectQuery([{ id: 'cherry-assistant-default', deletedAt: '2026-04-15T00:00:00.000Z' }])
      )
    }
    MockMainDbServiceUtils.setDb(database)

    const result = await service.initBuiltinAgent({
      id: 'cherry-assistant-default',
      builtinRole: 'assistant',
      provisionWorkspace: vi.fn()
    })

    expect(result).toEqual({ agentId: null, skippedReason: 'deleted' })
    expect(mockGetModels).not.toHaveBeenCalled()
  })

  it('soft-deletes built-in agents while preserving the row', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      select: vi.fn(() => createSelectQuery([{ id: 'cherry-claw-default', deleted_at: null }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({ delete: txDelete, update: txUpdate })
      ),
      delete: vi.fn(() => ({ where: deleteWhere }))
    }
    MockMainDbServiceUtils.setDb(database)

    const deleted = await service.deleteAgent('cherry-claw-default')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txDelete).toHaveBeenCalledTimes(3)
    expect(txUpdate).toHaveBeenCalledTimes(2)
    expect(database.delete).not.toHaveBeenCalled()
    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ agentId: null }))
    expect(txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(Number),
        updatedAt: expect.any(Number)
      })
    )
  })
})
