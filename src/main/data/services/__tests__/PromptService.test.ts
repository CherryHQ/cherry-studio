import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock db - tx shares the same mocks since transaction passes tx to callback
const getDbMock = vi.fn()
const loggerInfoMock = vi.fn()

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: getDbMock }
  })
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: loggerInfoMock,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

const { promptService } = await import('../PromptService')

function makePromptRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '8d0be0c2-7a31-4d30-b2d4-fc4c0df3dd61',
    title: 'Prompt title',
    content: 'Prompt content',
    currentVersion: 1,
    sortOrder: 0,
    variables: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }
}

function makeVersionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'da6dd7d6-8a80-429f-b3ef-e36f96246af8',
    promptId: '8d0be0c2-7a31-4d30-b2d4-fc4c0df3dd61',
    version: 1,
    content: 'Prompt content',
    rollbackFrom: null,
    variables: null,
    createdAt: 1700000000000,
    ...overrides
  }
}

describe('PromptService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the existing prompt when update receives an empty patch', async () => {
    const existing = makePromptRow()
    const limitMock = vi.fn().mockResolvedValue([existing])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereMock })
    const tx = {
      select: vi.fn().mockReturnValue({ from: fromMock }),
      update: vi.fn(),
      insert: vi.fn()
    }
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx))
    }

    getDbMock.mockReturnValue(db)

    const result = await promptService.update(existing.id, {})

    expect(tx.update).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: existing.id,
      title: existing.title,
      content: existing.content,
      currentVersion: existing.currentVersion,
      sortOrder: existing.sortOrder,
      variables: null,
      createdAt: new Date(existing.createdAt).toISOString(),
      updatedAt: new Date(existing.updatedAt).toISOString()
    })
  })

  it('appends new prompts to the end of global ordering', async () => {
    const promptRow = makePromptRow({
      id: 'b13fe4c4-0706-4766-a5f5-6b47779c7f10',
      title: 'New prompt',
      content: 'New content',
      sortOrder: 3
    })
    const promptOrderLimitMock = vi.fn().mockResolvedValue([{ sortOrder: 2 }])
    const tx = {
      select: vi.fn().mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: promptOrderLimitMock
          })
        })
      })),
      insert: vi
        .fn()
        .mockImplementationOnce(() => ({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([promptRow])
          })
        }))
        .mockImplementationOnce(() => ({
          values: vi.fn().mockResolvedValue(undefined)
        }))
    }
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx))
    }

    getDbMock.mockReturnValue(db)

    await promptService.create({
      title: 'New prompt',
      content: 'New content'
    })

    const promptInsert = tx.insert.mock.results[0]?.value.values

    expect(promptOrderLimitMock).toHaveBeenCalledWith(1)
    expect(promptInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sortOrder: 3
      })
    )
  })

  it('looks up rollback targets with a single indexed query', async () => {
    const existing = makePromptRow({ currentVersion: 3, content: 'Current content' })
    const targetVersion = makeVersionRow({ version: 1, content: 'Rolled back content' })
    const updated = makePromptRow({
      content: 'Rolled back content',
      currentVersion: 4,
      updatedAt: 1700000000100
    })
    const existingLimitMock = vi.fn().mockResolvedValue([existing])
    const targetLimitMock = vi.fn().mockResolvedValue([targetVersion])
    const tx = {
      select: vi
        .fn()
        .mockImplementationOnce(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: existingLimitMock
            })
          })
        }))
        .mockImplementationOnce(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: targetLimitMock
            })
          })
        })),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated])
          })
        })
      })
    }
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx))
    }

    getDbMock.mockReturnValue(db)

    const result = await promptService.rollback(existing.id, { version: 1 })

    expect(targetLimitMock).toHaveBeenCalledWith(1)
    expect(tx.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({
        rollbackFrom: 1
      })
    )
    expect(result.content).toBe('Rolled back content')
    expect(result.currentVersion).toBe(4)
  })

  describe('reorder', () => {
    it('should update sortOrder for each prompt in a transaction', async () => {
      const setArgs: unknown[] = []
      const txUpdate = vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((arg: unknown) => {
          setArgs.push(arg)
          return { where: vi.fn().mockResolvedValue(undefined) }
        })
      }))
      const mockTx = { update: txUpdate }

      const db = {
        transaction: vi.fn(async (callback: (trx: typeof mockTx) => Promise<void>) => {
          await callback(mockTx)
        })
      }

      getDbMock.mockReturnValue(db)

      await promptService.reorder(['id-a', 'id-b', 'id-c'])

      expect(db.transaction).toHaveBeenCalledOnce()
      expect(txUpdate).toHaveBeenCalledTimes(3)
      expect(setArgs).toEqual([{ sortOrder: 0 }, { sortOrder: 1 }, { sortOrder: 2 }])
    })

    it('should handle empty array', async () => {
      const mockTx = {
        update: vi.fn()
      }

      const db = {
        transaction: vi.fn(async (callback: (trx: typeof mockTx) => Promise<void>) => {
          await callback(mockTx)
        })
      }

      getDbMock.mockReturnValue(db)

      await promptService.reorder([])

      expect(db.transaction).toHaveBeenCalledOnce()
      expect(mockTx.update).not.toHaveBeenCalled()
    })
  })
})
