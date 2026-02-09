import { act, renderHook } from '@testing-library/react'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileProcess } from '../useFileProcessing'

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

const createMockFile = (): FileMetadata => ({
  id: 'file-1',
  name: 'test.png',
  origin_name: 'test.png',
  path: '/path/to/test.png',
  size: 1024,
  ext: '.png',
  type: FileTypes.IMAGE,
  created_at: new Date().toISOString(),
  count: 1
})

describe('useFileProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when polling returns an error', async () => {
    const trigger = vi.fn().mockResolvedValue({ requestId: 'req-1' })
    const queryState: { data?: unknown; error?: unknown } = {}

    mocks.useMutation.mockReturnValue({ trigger })
    mocks.useQuery.mockImplementation((_path: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) {
        return { data: undefined, error: undefined }
      }
      return { data: queryState.data, error: queryState.error }
    })

    const { result, rerender } = renderHook(() => useFileProcess())
    const processPromise = result.current.processFile(createMockFile(), 'text_extraction')
    const rejection = processPromise.then(
      () => new Error('Expected promise to reject'),
      (error) => error
    )

    await vi.waitFor(() => {
      expect(trigger).toHaveBeenCalled()
    })

    await vi.waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith('/file-processing/requests/req-1', expect.anything())
    })

    queryState.error = new Error('poll failed')
    await act(async () => {
      rerender()
    })

    const error = await rejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('poll failed')
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'File processing polling failed',
      expect.objectContaining({ requestId: 'req-1' })
    )
  })

  it('rejects when completed status has no result', async () => {
    const trigger = vi.fn().mockResolvedValue({ requestId: 'req-2' })
    const queryState: { data?: unknown; error?: unknown } = {}

    mocks.useMutation.mockReturnValue({ trigger })
    mocks.useQuery.mockImplementation((_path: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) {
        return { data: undefined, error: undefined }
      }
      return { data: queryState.data, error: queryState.error }
    })

    const { result, rerender } = renderHook(() => useFileProcess())
    const processPromise = result.current.processFile(createMockFile(), 'text_extraction')
    const rejection = processPromise.then(
      () => new Error('Expected promise to reject'),
      (error) => error
    )

    await vi.waitFor(() => {
      expect(trigger).toHaveBeenCalled()
    })

    await vi.waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith('/file-processing/requests/req-2', expect.anything())
    })

    queryState.data = {
      requestId: 'req-2',
      status: 'completed',
      progress: 100
    }

    await act(async () => {
      rerender()
    })

    const error = await rejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Processing completed but result is missing')
  })

  it('rejects with backend error message on failed status', async () => {
    const trigger = vi.fn().mockResolvedValue({ requestId: 'req-3' })
    const queryState: { data?: unknown; error?: unknown } = {}

    mocks.useMutation.mockReturnValue({ trigger })
    mocks.useQuery.mockImplementation((_path: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) {
        return { data: undefined, error: undefined }
      }
      return { data: queryState.data, error: queryState.error }
    })

    const { result, rerender } = renderHook(() => useFileProcess())
    const processPromise = result.current.processFile(createMockFile(), 'text_extraction')
    const rejection = processPromise.then(
      () => new Error('Expected promise to reject'),
      (error) => error
    )

    await vi.waitFor(() => {
      expect(trigger).toHaveBeenCalled()
    })

    await vi.waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith('/file-processing/requests/req-3', expect.anything())
    })

    queryState.data = {
      requestId: 'req-3',
      status: 'failed',
      progress: 0,
      error: { code: 'processing_failed', message: 'Backend failed' }
    }

    await act(async () => {
      rerender()
    })

    const error = await rejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Backend failed')
  })

  it('rejects with fallback message when failed status lacks message', async () => {
    const trigger = vi.fn().mockResolvedValue({ requestId: 'req-4' })
    const queryState: { data?: unknown; error?: unknown } = {}

    mocks.useMutation.mockReturnValue({ trigger })
    mocks.useQuery.mockImplementation((_path: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) {
        return { data: undefined, error: undefined }
      }
      return { data: queryState.data, error: queryState.error }
    })

    const { result, rerender } = renderHook(() => useFileProcess())
    const processPromise = result.current.processFile(createMockFile(), 'text_extraction')
    const rejection = processPromise.then(
      () => new Error('Expected promise to reject'),
      (error) => error
    )

    await vi.waitFor(() => {
      expect(trigger).toHaveBeenCalled()
    })

    await vi.waitFor(() => {
      expect(mocks.useQuery).toHaveBeenCalledWith('/file-processing/requests/req-4', expect.anything())
    })

    queryState.data = {
      requestId: 'req-4',
      status: 'failed',
      progress: 0,
      error: { code: 'processing_failed' }
    }

    await act(async () => {
      rerender()
    })

    const error = await rejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Processing failed')
  })
})
