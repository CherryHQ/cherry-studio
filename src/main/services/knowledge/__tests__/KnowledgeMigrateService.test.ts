import type { KnowledgeBase } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockRmSync = vi.fn()
const mockRenameSync = vi.fn()

const mockCreateClient = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync,
  renameSync: mockRenameSync
}))

vi.mock('@main/utils', () => ({
  getDataPath: () => '/mock-data'
}))

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (id: string) => id
}))

vi.mock('@libsql/client', () => ({
  createClient: mockCreateClient
}))

vi.mock('@vectorstores/libsql', () => ({
  LibSQLVectorStore: vi.fn()
}))

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'base-1',
    name: 'Knowledge Base',
    model: {
      id: 'text-embedding-3-small',
      provider: 'openai',
      name: 'text-embedding-3-small'
    } as any,
    items: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    version: 2,
    ...overrides
  }
}

function defaultExists(path: string): boolean {
  if (path === '/mock-data/KnowledgeBase') return true
  if (path === '/mock-data/KnowledgeBase/base-1') return true
  return false
}

async function loadService() {
  const module = await import('../KnowledgeMigrateService')
  return module.knowledgeMigrateService
}

describe('KnowledgeMigrateService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockExistsSync.mockImplementation(defaultExists)
  })

  it('returns failure when database file does not exist', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/mock-data/KnowledgeBase')
    const service = await loadService()

    const result = await service.migrate(createBase())

    expect(result).toEqual({
      success: false,
      migratedCount: 0,
      error: 'Database not found'
    })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('returns failure when database is not embedjs format', async () => {
    const mockClient = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn()
    }
    mockCreateClient.mockReturnValue(mockClient)
    const service = await loadService()

    const result = await service.migrate(createBase())

    expect(result).toEqual({
      success: false,
      migratedCount: 0,
      error: 'Database is not in embedjs format'
    })
    expect(mockClient.execute).toHaveBeenCalledWith({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'",
      args: []
    })
    expect(mockClient.close).toHaveBeenCalledTimes(1)
  })

  it('returns success with zero count when embedjs has no vectors', async () => {
    const mockClient = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ name: 'vectors' }] })
        .mockResolvedValueOnce({ rows: [] }),
      close: vi.fn()
    }
    mockCreateClient.mockReturnValue(mockClient)
    const service = await loadService()

    const result = await service.migrate(createBase())

    expect(result).toEqual({
      success: true,
      migratedCount: 0
    })
    expect(mockCreateClient).toHaveBeenCalledWith({ url: 'file:/mock-data/KnowledgeBase/base-1' })
    expect(mockClient.close).toHaveBeenCalledTimes(1)
    expect(mockRmSync).not.toHaveBeenCalled()
    expect(mockRenameSync).not.toHaveBeenCalled()
  })
})
