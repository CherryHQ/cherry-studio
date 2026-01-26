/**
 * File Processing API Handlers Tests
 *
 * Tests that the API handlers correctly forward requests to the FileProcessingService.
 */

import type { FileProcessorFeature } from '@shared/data/presets/fileProcessing'
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
      getResult: vi.fn(),
      cancel: vi.fn()
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

    it('should return null when processor not found', async () => {
      vi.mocked(fileProcessingService.getProcessor).mockReturnValue(null)

      const handler = fileProcessingHandlers['/file-processing/processors/:id'].GET
      const result = await handler({
        params: { id: 'unknown' }
      })

      expect(fileProcessingService.getProcessor).toHaveBeenCalledWith('unknown')
      expect(result).toBeNull()
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
        body: { apiKey: 'new-key' }
      })

      expect(fileProcessingService.updateProcessorConfig).toHaveBeenCalledWith('mineru', { apiKey: 'new-key' })
      expect(result).toEqual(mockUpdated)
    })

    it('should throw error when processor not found', async () => {
      vi.mocked(fileProcessingService.updateProcessorConfig).mockImplementation(() => {
        throw new Error('Processor not found')
      })

      const handler = fileProcessingHandlers['/file-processing/processors/:id'].PATCH

      await expect(
        handler({
          params: { id: 'unknown' },
          body: { apiKey: 'test' }
        })
      ).rejects.toThrow('Processor not found')
    })
  })

  describe('POST /file-processing/process', () => {
    it('should start processing and return requestId', async () => {
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

      const handler = fileProcessingHandlers['/file-processing/process'].POST
      const result = await handler({
        body: { file: mockFile, feature: 'text_extraction' }
      })

      expect(fileProcessingService.startProcess).toHaveBeenCalledWith({
        file: mockFile,
        feature: 'text_extraction'
      })
      expect(result).toEqual(mockResponse)
    })

    it('should throw validation error for invalid body', async () => {
      vi.mocked(fileProcessingService.startProcess).mockRejectedValue(new Error('Validation failed'))

      const handler = fileProcessingHandlers['/file-processing/process'].POST

      await expect(
        handler({
          body: { file: undefined as never, feature: 'text_extraction' }
        })
      ).rejects.toThrow('Validation failed')
    })
  })

  describe('GET /file-processing/result', () => {
    it('should return result for valid requestId', async () => {
      const mockResult = {
        requestId: 'abc-123',
        status: 'completed' as const,
        progress: 100,
        result: { text: 'Extracted text' }
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/result'].GET
      const result = await handler({
        query: { requestId: 'abc-123' }
      })

      expect(fileProcessingService.getResult).toHaveBeenCalledWith('abc-123')
      expect(result).toEqual(mockResult)
    })

    it('should return failed status for unknown requestId', async () => {
      const mockResult = {
        requestId: 'unknown',
        status: 'failed' as const,
        progress: 0,
        error: { code: 'not_found', message: 'Request not found' }
      }
      vi.mocked(fileProcessingService.getResult).mockResolvedValue(mockResult)

      const handler = fileProcessingHandlers['/file-processing/result'].GET
      const result = await handler({
        query: { requestId: 'unknown' }
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

      const handler = fileProcessingHandlers['/file-processing/result'].GET
      const result = await handler({
        query: { requestId: 'abc-123' }
      })

      expect(result).toEqual(mockResult)
    })
  })

  describe('POST /file-processing/cancel', () => {
    it('should cancel active processing', async () => {
      const mockResponse = { success: true, message: 'Cancelled' }
      vi.mocked(fileProcessingService.cancel).mockReturnValue(mockResponse)

      const handler = fileProcessingHandlers['/file-processing/cancel'].POST
      const result = await handler({
        body: { requestId: 'abc-123' }
      })

      expect(fileProcessingService.cancel).toHaveBeenCalledWith('abc-123')
      expect(result).toEqual(mockResponse)
    })

    it('should return failure for non-cancellable task', async () => {
      const mockResponse = { success: false, message: 'Cannot cancel' }
      vi.mocked(fileProcessingService.cancel).mockReturnValue(mockResponse)

      const handler = fileProcessingHandlers['/file-processing/cancel'].POST
      const result = await handler({
        body: { requestId: 'completed-task' }
      })

      expect(result).toEqual(mockResponse)
    })
  })
})
