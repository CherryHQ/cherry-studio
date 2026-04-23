import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn()
  },
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

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

import type { CreateTaskRequest } from '@types'

import { taskService } from '../TaskService'

function createConfigQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows)
      }))
    }))
  }
}

const baseRequest: CreateTaskRequest = {
  name: 'nightly report',
  prompt: 'summarise overnight alerts',
  schedule_type: 'interval',
  schedule_value: '60'
}

describe('TaskService silent-failure guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws a clear error when the agent configuration JSON is malformed', async () => {
    const database = {
      select: vi.fn(() => createConfigQuery([{ configuration: '{not valid json' }]))
    }

    vi.spyOn(taskService as never, 'getDatabase').mockResolvedValue(database as never)

    await expect(taskService.createTask('agent-1', baseRequest)).rejects.toThrow(
      /Agent agent-1 has a malformed configuration JSON and cannot be scheduled/
    )
  })

  it('throws when the task insert reports rowsAffected !== 1', async () => {
    const txInsert = vi.fn(() => ({
      values: vi.fn().mockResolvedValue({ rowsAffected: 0 })
    }))
    const database = {
      select: vi.fn(() => createConfigQuery([{ configuration: JSON.stringify({ soul_enabled: true }) }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => callback({ insert: txInsert }))
    }

    vi.spyOn(taskService as never, 'getDatabase').mockResolvedValue(database as never)

    await expect(taskService.createTask('agent-1', baseRequest)).rejects.toThrow(
      /Failed to insert task .*: rowsAffected=0/
    )
    expect(database.transaction).toHaveBeenCalledTimes(1)
  })
})
