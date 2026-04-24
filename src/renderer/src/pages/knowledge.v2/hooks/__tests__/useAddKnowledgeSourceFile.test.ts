import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../../tests/__mocks__/RendererLoggerService'
import { useAddKnowledgeSourceFile } from '../useAddKnowledgeSourceFile'

const mockUploadFiles = vi.fn()
const mockUseMutation = vi.fn()
const mockUseInvalidateCache = vi.fn()
const mockCreateKnowledgeItems = vi.fn()
const mockInvalidateCache = vi.fn()
const mockGetPathForFile = vi.fn()
const mockGetFile = vi.fn()
const mockAddItems = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    uploadFiles: (...args: unknown[]) => mockUploadFiles(...args)
  }
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useInvalidateCache: () => mockUseInvalidateCache()
}))

const createBrowserFile = (name: string, size = 1024) => {
  return new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })
}

const createFileMetadata = ({ id, name, path }: { id: string; name: string; path: string }) => ({
  id,
  name,
  origin_name: name,
  path,
  size: 1024,
  ext: '.pdf',
  type: 'document' as const,
  created_at: '2026-04-23T10:00:00+08:00',
  count: 1
})

describe('useAddKnowledgeSourceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockReturnValue({
      trigger: mockCreateKnowledgeItems,
      isLoading: false,
      error: undefined
    })
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockGetPathForFile.mockImplementation((file: File) => `/external/${file.name}`)
    mockAddItems.mockResolvedValue(undefined)
    mockInvalidateCache.mockResolvedValue(undefined)
    ;(window as any).api = {
      file: {
        getPathForFile: mockGetPathForFile,
        get: mockGetFile
      },
      knowledgeRuntime: {
        addItems: mockAddItems
      }
    }
  })

  it('resolves browser files, uploads them, creates knowledge items, refreshes the list, and enqueues indexing', async () => {
    const selectedFiles = [createBrowserFile('alpha.pdf'), createBrowserFile('beta.pdf')]
    const resolvedFiles = [
      createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' }),
      createFileMetadata({ id: 'external-2', name: 'beta.pdf', path: '/external/beta.pdf' })
    ]
    const uploadedFiles = [
      createFileMetadata({ id: 'uploaded-1', name: 'alpha.pdf', path: '/library/uploaded-1.pdf' }),
      createFileMetadata({ id: 'uploaded-2', name: 'beta.pdf', path: '/library/uploaded-2.pdf' })
    ]

    mockGetFile.mockResolvedValueOnce(resolvedFiles[0]).mockResolvedValueOnce(resolvedFiles[1])
    mockUploadFiles.mockResolvedValueOnce(uploadedFiles)
    mockCreateKnowledgeItems.mockResolvedValueOnce({
      items: [
        { id: 'item-1', type: 'file' },
        { id: 'item-2', type: 'file' }
      ]
    })

    const { result } = renderHook(() => useAddKnowledgeSourceFile('base-1', selectedFiles))

    await act(async () => {
      await result.current.submit()
    })

    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/knowledge-bases/:id/items')
    expect(mockGetPathForFile).toHaveBeenNthCalledWith(1, selectedFiles[0])
    expect(mockGetPathForFile).toHaveBeenNthCalledWith(2, selectedFiles[1])
    expect(mockGetFile).toHaveBeenNthCalledWith(1, '/external/alpha.pdf')
    expect(mockGetFile).toHaveBeenNthCalledWith(2, '/external/beta.pdf')
    expect(mockUploadFiles).toHaveBeenCalledWith(resolvedFiles)
    expect(mockCreateKnowledgeItems).toHaveBeenCalledWith({
      params: { id: 'base-1' },
      body: {
        items: [
          {
            type: 'file',
            data: { file: uploadedFiles[0] }
          },
          {
            type: 'file',
            data: { file: uploadedFiles[1] }
          }
        ]
      }
    })
    expect(mockAddItems).toHaveBeenCalledWith('base-1', ['item-1', 'item-2'])
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
    expect(result.current.error).toBeUndefined()
    expect(result.current.isSubmitting).toBe(false)
  })

  it('rethrows upload errors and records them', async () => {
    const selectedFiles = [createBrowserFile('alpha.pdf')]
    const resolvedFile = createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    const uploadError = new Error('upload failed')

    mockGetFile.mockResolvedValueOnce(resolvedFile)
    mockUploadFiles.mockRejectedValueOnce(uploadError)

    const { result } = renderHook(() => useAddKnowledgeSourceFile('base-1', selectedFiles))
    let caughtError: Error | undefined

    await act(async () => {
      try {
        await result.current.submit()
      } catch (error) {
        caughtError = error as Error
      }
    })

    expect(caughtError).toBe(uploadError)
    expect(mockCreateKnowledgeItems).not.toHaveBeenCalled()
    expect(mockAddItems).not.toHaveBeenCalled()
    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to add file knowledge sources', {
      baseId: 'base-1',
      fileCount: 1,
      error: uploadError
    })
    await waitFor(() => {
      expect(result.current.error).toBe(uploadError)
    })
  })

  it('rethrows DataApi creation errors and records them', async () => {
    const selectedFiles = [createBrowserFile('alpha.pdf')]
    const resolvedFile = createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    const uploadedFile = createFileMetadata({ id: 'uploaded-1', name: 'alpha.pdf', path: '/library/uploaded-1.pdf' })
    const createError = new Error('create failed')

    mockGetFile.mockResolvedValueOnce(resolvedFile)
    mockUploadFiles.mockResolvedValueOnce([uploadedFile])
    mockCreateKnowledgeItems.mockRejectedValueOnce(createError)

    const { result } = renderHook(() => useAddKnowledgeSourceFile('base-1', selectedFiles))
    let caughtError: Error | undefined

    await act(async () => {
      try {
        await result.current.submit()
      } catch (error) {
        caughtError = error as Error
      }
    })

    expect(caughtError).toBe(createError)
    expect(mockAddItems).not.toHaveBeenCalled()
    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to add file knowledge sources', {
      baseId: 'base-1',
      fileCount: 1,
      error: createError
    })
    await waitFor(() => {
      expect(result.current.error).toBe(createError)
    })
  })

  it('does not wait for runtime indexing before completing submit', async () => {
    const selectedFiles = [createBrowserFile('alpha.pdf')]
    const resolvedFile = createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    const uploadedFile = createFileMetadata({ id: 'uploaded-1', name: 'alpha.pdf', path: '/library/uploaded-1.pdf' })
    let resolveRuntime!: () => void
    const runtimePromise = new Promise<void>((resolve) => {
      resolveRuntime = resolve
    })

    mockGetFile.mockResolvedValueOnce(resolvedFile)
    mockUploadFiles.mockResolvedValueOnce([uploadedFile])
    mockCreateKnowledgeItems.mockResolvedValueOnce({
      items: [{ id: 'item-1', type: 'file' }]
    })
    mockAddItems.mockReturnValueOnce(runtimePromise)

    const { result } = renderHook(() => useAddKnowledgeSourceFile('base-1', selectedFiles))

    await act(async () => {
      await result.current.submit()
    })

    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
    expect(mockAddItems).toHaveBeenCalledWith('base-1', ['item-1'])
    expect(result.current.error).toBeUndefined()
    expect(result.current.isSubmitting).toBe(false)

    resolveRuntime()
    await runtimePromise
  })

  it('records runtime indexing errors without failing submit', async () => {
    const selectedFiles = [createBrowserFile('alpha.pdf')]
    const resolvedFile = createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    const uploadedFile = createFileMetadata({ id: 'uploaded-1', name: 'alpha.pdf', path: '/library/uploaded-1.pdf' })
    const runtimeError = new Error('runtime failed')

    mockGetFile.mockResolvedValueOnce(resolvedFile)
    mockUploadFiles.mockResolvedValueOnce([uploadedFile])
    mockCreateKnowledgeItems.mockResolvedValueOnce({
      items: [{ id: 'item-1', type: 'file' }]
    })
    mockAddItems.mockRejectedValueOnce(runtimeError)

    const { result } = renderHook(() => useAddKnowledgeSourceFile('base-1', selectedFiles))

    await act(async () => {
      await result.current.submit()
    })

    expect(mockAddItems).toHaveBeenCalledWith('base-1', ['item-1'])
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
    expect(result.current.error).toBeUndefined()
    await waitFor(() => {
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to enqueue file knowledge sources for indexing', {
        baseId: 'base-1',
        itemIds: ['item-1'],
        error: runtimeError
      })
    })
  })
})
