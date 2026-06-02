import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@main/utils/markdownParser', () => ({
  parsePluginMetadata: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn()
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

import { channelsTable, sessionMessagesTable, sessionsTable, taskRunLogsTable } from '../../database/schema'
import { SessionService } from '../SessionService'

describe('SessionService deleteSession', () => {
  const service = SessionService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cleans associated data and then deletes the session row in one transaction', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<boolean>) =>
        callback({
          delete: txDelete,
          update: txUpdate
        })
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteSession('agent-1', 'session-1')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txUpdate).toHaveBeenCalledWith(channelsTable)
    expect(txUpdate).toHaveBeenCalledWith(taskRunLogsTable)
    expect(txUpdateSet).toHaveBeenCalledWith({ sessionId: null })
    expect(txUpdateSet).toHaveBeenCalledWith({ session_id: null })
    expect(txDelete).toHaveBeenNthCalledWith(1, sessionMessagesTable)
    expect(txDelete).toHaveBeenNthCalledWith(2, sessionsTable)
  })

  it('returns false when the session does not belong to the agent', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 0 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<boolean>) =>
        callback({
          delete: txDelete,
          update: txUpdate
        })
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteSession('agent-1', 'session-1')

    expect(deleted).toBe(false)
    expect(txDelete).toHaveBeenCalledTimes(2)
    expect(txDelete).toHaveBeenCalledWith(sessionMessagesTable)
    expect(txDelete).toHaveBeenCalledWith(sessionsTable)
    expect(txUpdate).toHaveBeenCalledWith(channelsTable)
    expect(txUpdate).toHaveBeenCalledWith(taskRunLogsTable)
  })
})
