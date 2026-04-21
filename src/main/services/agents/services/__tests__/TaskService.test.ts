import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
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
    MockMainDbServiceUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('throws when the task insert reports rowsAffected !== 1', async () => {
    const txInsert = vi.fn(() => ({
      values: vi.fn().mockResolvedValue({ rowsAffected: 0 })
    }))
    const database = {
      select: vi.fn(() => createConfigQuery([{ configuration: { soul_enabled: true } }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => callback({ insert: txInsert }))
    }
    MockMainDbServiceUtils.setDb(database)

    await expect(taskService.createTask('agent-1', baseRequest)).rejects.toThrow(
      /Failed to insert task .*: rowsAffected=0/
    )
    expect(database.transaction).toHaveBeenCalledTimes(1)
  })
})
