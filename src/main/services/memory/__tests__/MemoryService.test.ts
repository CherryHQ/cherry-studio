import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Embeddings class before importing MemoryService
vi.mock('@main/knowledge/embedjs/embeddings/Embeddings', () => ({
  default: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    embedQuery: vi.fn().mockResolvedValue(new Array(1536).fill(0.1))
  }))
}))

import { memoryService } from '../MemoryService'

// Chainable mock db builder
function createMockDb() {
  const mockGet = vi.fn().mockResolvedValue(undefined)
  const mockAll = vi.fn().mockResolvedValue([])

  const chainable = () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        get: mockGet,
        all: mockAll,
        orderBy: vi.fn().mockReturnValue({
          all: mockAll
        })
      }),
      get: mockGet,
      all: mockAll,
      orderBy: vi.fn().mockReturnValue({
        all: mockAll,
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            all: mockAll
          }),
          all: mockAll
        })
      }),
      limit: vi.fn().mockReturnValue({
        offset: vi.fn().mockReturnValue({
          all: mockAll
        }),
        all: mockAll
      }),
      groupBy: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          all: mockAll
        })
      })
    })
  })

  return {
    select: vi.fn().mockImplementation(chainable),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined)
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
    }),
    transaction: vi.fn(async (fn: any) => {
      const tx = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue([])
            })
          })
        })),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      }
      await fn(tx)
    }),
    // Expose for assertions
    _mockGet: mockGet,
    _mockAll: mockAll
  }
}

// Set up the application mock to return our db
let mockDb: ReturnType<typeof createMockDb>

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn().mockImplementation(() => ({
      getDb: () => mockDb
    }))
  }
}))

describe('MemoryService', () => {
  const service = memoryService

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockDb()
    service.setConfig({} as any)
  })

  describe('migrateMemoryDb', () => {
    it('should be a noop', () => {
      expect(() => service.migrateMemoryDb()).not.toThrow()
    })
  })

  describe('add', () => {
    it('should add a new memory from string', async () => {
      const result = await service.add('Remember this', {
        userId: 'user-1'
      })

      expect(result.count).toBe(1)
      expect(result.memories).toHaveLength(1)
      expect(result.memories[0].memory).toBe('Remember this')
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('should add memories from array of messages', async () => {
      const messages = [
        { content: 'Memory one', role: 'assistant' as const },
        { content: 'Memory two', role: 'assistant' as const }
      ]

      const result = await service.add(messages as any, { userId: 'user-1' })
      expect(result.count).toBe(2)
      expect(result.memories).toHaveLength(2)
    })

    it('should skip empty strings', async () => {
      const result = await service.add('   ', { userId: 'user-1' })
      expect(result.count).toBe(0)
      expect(result.memories).toHaveLength(0)
    })

    it('should skip duplicate memories (existing active hash)', async () => {
      // Mock: existing non-deleted memory found
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'existing-id',
              memory: 'Remember this',
              hash: 'some-hash',
              deletedAt: null
            })
          })
        })
      })

      const result = await service.add('Remember this', { userId: 'user-1' })
      expect(result.count).toBe(0)
    })

    it('should restore deleted memory with same hash', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'deleted-id',
              memory: 'Old text',
              hash: 'some-hash',
              embedding: null,
              deletedAt: '2024-01-01T00:00:00.000Z',
              createdAt: '2023-12-01T00:00:00.000Z'
            })
          })
        })
      })

      const result = await service.add('Restored text', { userId: 'user-1' })
      expect(result.count).toBe(1)
      expect(result.memories[0].id).toBe('deleted-id')
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('should return error result on failure', async () => {
      mockDb.select = vi.fn().mockImplementation(() => {
        throw new Error('DB_ERROR')
      })

      const result = await service.add('test', { userId: 'user-1' })
      expect(result.count).toBe(0)
      expect(result.error).toContain('DB_ERROR')
    })
  })

  describe('list', () => {
    it('should return empty list by default', async () => {
      // Mock count query
      mockDb.select = vi.fn().mockImplementation((arg) => {
        if (arg) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ total: 0 }])
            })
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockReturnValue({
                    all: vi.fn().mockResolvedValue([])
                  })
                })
              })
            })
          })
        }
      })

      const result = await service.list()
      expect(result.memories).toEqual([])
      expect(result.count).toBe(0)
    })

    it('should return error on failure', async () => {
      mockDb.select = vi.fn().mockImplementation(() => {
        throw new Error('LIST_FAIL')
      })

      const result = await service.list()
      expect(result.error).toContain('LIST_FAIL')
    })
  })

  describe('delete', () => {
    it('should soft-delete an existing memory', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'mem-1',
              memory: 'Test memory',
              deletedAt: null
            })
          })
        })
      })

      await expect(service.delete('mem-1')).resolves.toBeUndefined()
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled() // history record
    })

    it('should throw when memory not found', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(undefined)
          })
        })
      })

      await expect(service.delete('nonexistent')).rejects.toThrow('Memory not found')
    })
  })

  describe('update', () => {
    it('should update memory content', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'mem-1',
              memory: 'Old text',
              userId: 'user-1',
              embedding: null,
              metadata: { existing: true },
              deletedAt: null
            })
          })
        })
      })

      await expect(service.update('mem-1', 'New text', { extra: 'data' })).resolves.toBeUndefined()
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled() // history
    })

    it('should throw when memory not found', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(undefined)
          })
        })
      })

      await expect(service.update('nonexistent', 'text')).rejects.toThrow('Memory not found')
    })
  })

  describe('get (history)', () => {
    it('should return history items', async () => {
      const historyRows = [
        {
          id: 1,
          memoryId: 'mem-1',
          previousValue: null,
          newValue: 'Hello',
          action: 'ADD',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          deletedAt: null
        }
      ]

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue(historyRows)
            })
          })
        })
      })

      const result = await service.get('mem-1')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 1,
        memoryId: 'mem-1',
        previousValue: undefined,
        newValue: 'Hello',
        action: 'ADD',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        isDeleted: false
      })
    })
  })

  describe('deleteAllMemoriesForUser', () => {
    it('should throw when userId is empty', async () => {
      await expect(service.deleteAllMemoriesForUser('')).rejects.toThrow('User ID is required')
    })

    it('should delete memories and history in transaction', async () => {
      const txDelete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })

      mockDb.transaction = vi.fn(async (fn: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                all: vi.fn().mockResolvedValue([{ id: 'mem-1' }, { id: 'mem-2' }])
              })
            })
          }),
          delete: txDelete
        }
        await fn(tx)
      })

      await service.deleteAllMemoriesForUser('user-1')

      expect(mockDb.transaction).toHaveBeenCalled()
      // 2 history deletes + 1 memory table delete
      expect(txDelete).toHaveBeenCalledTimes(3)
    })
  })

  describe('deleteUser', () => {
    it('should throw for default user', async () => {
      await expect(service.deleteUser('default-user')).rejects.toThrow('Cannot delete the default user')
    })

    it('should throw for empty userId', async () => {
      await expect(service.deleteUser('')).rejects.toThrow('User ID is required')
    })
  })

  describe('setConfig', () => {
    it('should update config and clear embeddings', () => {
      const config = {
        embeddingModel: { id: 'model-1', provider: 'openai' } as any,
        embeddingApiClient: {} as any,
        embeddingDimensions: 1536
      }

      expect(() => service.setConfig(config as any)).not.toThrow()
    })
  })

  describe('search', () => {
    it('should fall back to text search when no embedding model', async () => {
      const rows = [
        {
          id: 'mem-1',
          memory: 'hello world',
          hash: 'h1',
          metadata: null,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          deletedAt: null,
          embedding: null,
          userId: 'user-1',
          agentId: null,
          runId: null
        }
      ]

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue(rows)
            })
          })
        })
      })

      const result = await service.search('hello')
      expect(result.memories).toHaveLength(1)
      expect(result.memories[0].id).toBe('mem-1')
    })

    it('should filter by text match', async () => {
      const rows = [
        {
          id: 'mem-1',
          memory: 'hello world',
          hash: 'h1',
          metadata: null,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          deletedAt: null,
          embedding: null,
          userId: null,
          agentId: null,
          runId: null
        },
        {
          id: 'mem-2',
          memory: 'goodbye world',
          hash: 'h2',
          metadata: null,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          deletedAt: null,
          embedding: null,
          userId: null,
          agentId: null,
          runId: null
        }
      ]

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue(rows)
            })
          })
        })
      })

      const result = await service.search('hello')
      expect(result.memories).toHaveLength(1)
      expect(result.memories[0].id).toBe('mem-1')
    })

    it('should return error on failure', async () => {
      mockDb.select = vi.fn().mockImplementation(() => {
        throw new Error('SEARCH_FAIL')
      })

      const result = await service.search('test')
      expect(result.error).toContain('SEARCH_FAIL')
    })
  })

  describe('close', () => {
    it('should clear embeddings', async () => {
      await expect(service.close()).resolves.toBeUndefined()
    })
  })
})
