/**
 * FileManager.deleteFile v1-frozen path tests.
 *
 * Locks the v1-swallow contract that v1 callers still depend on during
 * Phase 2 (until Batch E migrates messages):
 *  - file-not-found / refcount>1 short-circuit (no IPC call)
 *  - terminal-ref case delegates physical delete to legacy IPC
 *  - force=true bypasses the refcount guard
 *  - IPC failures use the FM_DELETE_IPC_FAILED anchor and do NOT rethrow
 *    (v1 callers use Promise.all and would otherwise tear down batch
 *    deletes on first failure)
 *
 * Mirrors FileManager.addFile.test.ts / .uploadFile.test.ts setup style.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: mockLoggerError,
      debug: vi.fn()
    })
  }
}))

const mockDbGet = vi.fn()
vi.mock('@renderer/databases', () => ({
  default: {
    files: {
      hook: vi.fn(),
      get: mockDbGet,
      add: vi.fn(),
      update: vi.fn()
    }
  }
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: vi.fn().mockReturnValue('/mock/files')
  }
}))

const mockLegacyDelete = vi.fn()
vi.stubGlobal('api', {
  file: {
    delete: mockLegacyDelete,
    createInternalEntry: vi.fn(),
    getPhysicalPath: vi.fn(),
    upload: vi.fn()
  }
})

const FileManager = (await import('../FileManager')).default

const makeFile = (overrides: Partial<{ count: number; ext: string }> = {}) => ({
  id: 'orig-id-001',
  name: 'doc',
  origin_name: 'doc.pdf',
  path: '/Users/u/doc.pdf',
  size: 100,
  ext: '.pdf',
  type: 'document' as const,
  created_at: new Date().toISOString(),
  count: 1,
  ...overrides
})

describe('FileManager.deleteFile — v1-frozen path contract', () => {
  beforeEach(() => {
    mockDbGet.mockReset()
    mockLegacyDelete.mockReset()
    mockLoggerError.mockReset()
  })

  it('returns early when file not in Dexie (no IPC call)', async () => {
    mockDbGet.mockResolvedValue(null)

    await FileManager.deleteFile('missing-id')

    expect(mockLegacyDelete).not.toHaveBeenCalled()
  })

  it('returns early when count > 1 and force=false (refcount short-circuit)', async () => {
    mockDbGet.mockResolvedValue(makeFile({ count: 3 }))

    await FileManager.deleteFile('orig-id-001')

    expect(mockLegacyDelete).not.toHaveBeenCalled()
  })

  it('calls legacy IPC delete with id+ext when count = 1', async () => {
    mockDbGet.mockResolvedValue(makeFile({ count: 1, ext: '.pdf' }))
    mockLegacyDelete.mockResolvedValue(undefined)

    await FileManager.deleteFile('orig-id-001')

    expect(mockLegacyDelete).toHaveBeenCalledOnce()
    expect(mockLegacyDelete).toHaveBeenCalledWith('orig-id-001.pdf')
  })

  it('calls legacy IPC delete when force=true even if count > 1', async () => {
    mockDbGet.mockResolvedValue(makeFile({ count: 5, ext: '.png' }))
    mockLegacyDelete.mockResolvedValue(undefined)

    await FileManager.deleteFile('orig-id-001', true)

    expect(mockLegacyDelete).toHaveBeenCalledOnce()
    expect(mockLegacyDelete).toHaveBeenCalledWith('orig-id-001.png')
  })

  it('does NOT rethrow on IPC failure; logs via FM_DELETE_IPC_FAILED anchor', async () => {
    mockDbGet.mockResolvedValue(makeFile({ count: 1, ext: '.txt' }))
    const ipcErr = new Error('EBUSY')
    mockLegacyDelete.mockRejectedValue(ipcErr)

    await expect(FileManager.deleteFile('orig-id-001')).resolves.toBeUndefined()

    expect(mockLoggerError).toHaveBeenCalledOnce()
    expect(mockLoggerError).toHaveBeenCalledWith(
      'FM_DELETE_IPC_FAILED',
      ipcErr,
      expect.objectContaining({
        fileId: 'orig-id-001',
        ext: '.txt',
        physicalName: 'orig-id-001.txt'
      })
    )
  })
})
