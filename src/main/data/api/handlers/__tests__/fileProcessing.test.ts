/**
 * File Processing API Handlers Tests
 *
 * Tests that the API handlers correctly forward requests to the FileProcessingService.
 */

import { DataApiError, ErrorCode } from '@shared/data/api'
import type { FileProcessorFeature } from '@shared/data/presets/file-processing'
import type { ProcessResultResponse } from '@shared/data/types/fileProcessing'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileProcessingHandlers } from '../fileProcessing'

// Mock the file processing service
vi.mock('@main/services/fileProcessing', () => {
  return {
    fileProcessingService: {
      listAvailableProcessors: vi.fn(),
      getProcessor: vi.fn(),
      updateProcessorConfig: vi.fn(),
      startProcess: vi.fn(),
      getResult: vi.fn()
    },
    FileProcessingService: {
      getInstance: vi.fn()
    }
  }
})

// Import the mocked service
import { fileProcessingService } from '@main/services/fileProcessing'

describe('fileProcessingHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  describe('GET /file-processing/processors', () => {
    it('should list all available processors', async () => {
      const mockProcessors = [
        { id: 'tesseract', type: 'builtin', capabilities: [] },
        { id: 'mineru', type: 'api', capabilities: [] }
      ]
      vi.mocked(fileProcessingService.listAvailableProcessors).mockResolvedValue(mockProcessors as never)

      const handler = fileProcessingHandlers['/file-processing/processors'].GET
      const result = await handler({})

      expect(fileProcessingService.listAvailableProcessors).toHaveBeenCalledWith(undefined)
      expect(result).toEqual(mockProcessors)
    })

    it('should filter by feature when query param provided', async () => {
      const mockProcessors = [{ id: 'tesseract', type: 'builtin', capabilities: [] }]
      vi.mocked(fileProcessingService.listAvailableProcessors).mockResolvedValue(mockProcessors as never)

      const handler = fileProcessingHandlers['/file-processing/processors'].GET
      const feature: FileProcessorFeature = 'text_extraction'
      // Type assertion needed due to schema's optional query handling
      const result = await handler({
        query: { feature }
      } as never)

      expect(fileProcessingService.listAvailableProcessors).toHaveBeenCalledWith('text_extraction')
      expect(result).toEqual(mockProcessors)
    })

    it('should return empty array when no processors available', async () => {
      vi.mocked(fileProcessingService.listAvailableProcessors).mockResolvedValue([])

      const handler = fileProcessingHandlers['/file-processing/processors'].GET
      const result = await handler({})

      expect(result).toEqual([])
    })
  })

  describe('GET /file-processing/processors/:id', () => {
    it('should return processor config when found', async () => {
      const mockProcessor = {
        id: 'tesseract',
        type: 'builtin',
        capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
      }
      vi.mocked(fileProcessingService.getProcessor).mockReturnValue(mockProcessor as never)

      const handler = fileProcessingHandlers['/file-processing/processors/:id'].GET
      const result = await handler({
        params: { id: 'tesseract' }
      })

      expect(fileProcessingService.getProcessor).toHaveBeenCalledWith('tesseract')
      expect(result).toEqual(mockProcessor)
    })

    it('should throw error when processor not found', async () => {
      vi.mocked(fileProcessingService.getProcessor).mockReturnValue(null)

      const handler = fileProcessingHandlers['/file-processing/processors/:id'].GET
      let thrown: unknown

      try {
        await handler({
          params: { id: 'tesseract' }
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(DataApiError)
      const dataError = thrown as DataApiError
      expect(dataError.code).toBe(ErrorCode.NOT_FOUND)
      expect(dataError.status).toBe(404)
      expect(dataError.details).toEqual({ resource: 'Processor', id: 'tesseract' })
      expect(fileProcessingService.getProcessor).toHaveBeenCalledWith('tesseract')
    })
  })

  describe('PATCH /file-processing/processors/:id', () => {
    it('should update processor config', async () => {
      const mockUpdated = {
        id: 'mineru',
        type: 'api',
        apiKey: 'new-key',
        capabilities: []
      }
      vi.mocked(fileProcessingService.updateProcessorConfig).mockReturnValue(mockUpdated as never)

      const handler = fileProcessingHandlers['/file-processing/processors/:id'].PATCH
      const result = await handler({
        params: { id: 'mineru' },
        body: { apiKeys: ['new-key'] }
      })

      expect(fileProcessingService.updateProcessorConfig).toHaveBeenCalledWith('mineru', { apiKeys: ['new-key'] })
      expect(result).toEqual(mockUpdated)
    })

    it('should throw error when processor not found', async () => {
      vi.mocked(fileProcessingService.updateProcessorConfig).mockImplementation(() => {
        throw new Error('Processor not found')
      })

      const handler = fileProcessingHandlers['/file-processing/processors/:id'].PATCH

      await expect(
        handler({
          params: { id: 'tesseract' },
          body: { apiKeys: ['test'] }
        })
      ).rejects.toThrow('Processor not found')
    })
  })

  describe('POST /file-processing/requests', () => {
    it('should create processing request and return requestId with 202 status', async () => {
      const mockResponse = { requestId: 'abc-123', status: 'pending' as const }
      vi.mocked(fileProcessingService.startProcess).mockResolvedValue(mockResponse)

      const mockFile: FileMetadata = {
        id: 'file-1',
        name: 'test.png',
        origin_name: 'test.png',
        path: '/path/to/test.png',
        size: 1024,
        ext: '.png',
        type: FileTypes.IMAGE,
        created_at: new Date().toISOString(),
        count: 1
      }

      const handler = fileProcessingHandlers['/file-processing/requests'].POST
      const result = await handler({
        body: { file: mockFile, feature: 'text_extraction' }
      })

      expect(fileProcessingService.startProcess).toHaveBeenCalledWith({
        file: mockFile,
        feature: 'text_extraction'
      })
      // Handler returns custom status for async task acceptance
      expect(result).toEqual({ data: mockResponse, status: 202 })
    })

    it('should throw validation error for invalid body', async () => {
      vi.mocked(fileProcessingService.startProcess).mockRejectedValue(new Error('Validation failed'))

      const handler = fileProcessingHandlers['/file-processing/requests'].POST

      await expect(
        handler({
          body: { file: undefined as never, feature: 'text_extraction' }
        })
      ).rejects.toThrow('Validation failed')
    })
  })

  describe('GET /file-processing/requests/:requestId', () => {
    it('should return result for valid requestId', async () => {
      const mockResult = {
        requestId: 'abc-123',
        status: 'completed' as const,
        progress: 100,
        result: { text: 'Extracted text' }
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/requests/:requestId'].GET
      const result = await handler({
        params: { requestId: 'abc-123' }
      })

      expect(fileProcessingService.getResult).toHaveBeenCalledWith('abc-123')
      expect(result).toEqual(mockResult)
    })

    it('should return failed status for unknown requestId', async () => {
      const mockResult: ProcessResultResponse = {
        requestId: 'unknown',
        status: 'failed' as const,
        progress: 0,
        error: { code: 'not_found', message: 'Request not found' }
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/requests/:requestId'].GET
      const result = await handler({
        params: { requestId: 'unknown' }
      })

      expect(result).toEqual(mockResult)
    })

    it('should return expired status when request has expired', async () => {
      const mockResult: ProcessResultResponse = {
        requestId: 'expired-id',
        status: 'failed' as const,
        progress: 0,
        error: { code: 'expired', message: 'Request result has expired' }
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/requests/:requestId'].GET
      const result = await handler({
        params: { requestId: 'expired-id' }
      })

      expect(result).toEqual(mockResult)
    })

    it('should return failed status when status query fails', async () => {
      const mockResult: ProcessResultResponse = {
        requestId: 'status-fail-id',
        status: 'failed' as const,
        progress: 0,
        error: { code: 'status_query_failed', message: 'Provider API error' }
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/requests/:requestId'].GET
      const result = await handler({
        params: { requestId: 'status-fail-id' }
      })

      expect(result).toEqual(mockResult)
    })

    it('should return processing status with progress', async () => {
      const mockResult = {
        requestId: 'abc-123',
        status: 'processing' as const,
        progress: 50
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/requests/:requestId'].GET
      const result = await handler({
        params: { requestId: 'abc-123' }
      })

      expect(result).toEqual(mockResult)
    })
  })
})
