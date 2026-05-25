import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetModels, mockInitSkillsForAgent } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockInitSkillsForAgent: vi.fn()
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: mockGetModels
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/app')
  },
  BrowserWindow: vi.fn(),
  dialog: {},
  ipcMain: {},
  nativeTheme: {
    on: vi.fn(),
    themeSource: 'system',
    shouldUseDarkColors: false
  },
  screen: {},
  session: {},
  shell: {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    macOS: false,
    windows: false,
    linux: true
  }
}))

vi.mock('../../skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: mockInitSkillsForAgent
  }
}))

import { AgentService } from '../AgentService'

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
  const service = AgentService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips recreating a built-in agent that was soft-deleted by the user', async () => {
    const database = {
      select: vi.fn(() =>
        createSelectQuery([{ id: 'cherry-assistant-default', deleted_at: '2026-04-15T00:00:00.000Z' }])
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

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

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteAgent('cherry-claw-default')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txDelete).toHaveBeenCalledTimes(3)
    expect(txUpdate).toHaveBeenCalledTimes(2)
    expect(database.delete).not.toHaveBeenCalled()
    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ agentId: null }))
    expect(txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(String),
        updated_at: expect.any(String)
      })
    )
  })
})
