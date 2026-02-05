/**
 * PaddleProcessor Tests
 *
 * Tests for the PaddleOCR processor covering:
 * - async job submission
 * - API calls
 * - Error handling
 */

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { net } from 'electron'

import type { ProcessingContext } from '../../../types'
import { PaddleProcessor } from '../PaddleProcessor'

// net.fetch is mocked in global setup (tests/main.setup.ts)

vi.mock('@main/utils/ocr', () => ({
  loadOcrImage: vi.fn().mockResolvedValue(Buffer.from('mock image content'))
}))

const assertPendingResult = (
  result: ProcessingResult
): Extract<ProcessingResult, { metadata: { providerTaskId: string } }> => {
  if (!('metadata' in result) || !result.metadata?.providerTaskId) {
    throw new Error('Expected providerTaskId in processing result')
  }
  return result as Extract<ProcessingResult, { metadata: { providerTaskId: string } }>
}

describe('PaddleProcessor', () => {
  let processor: PaddleProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new PaddleProcessor()

    mockConfig = {
      id: 'paddleocr',
      type: 'api',
      capabilities: [
        {
          feature: 'text_extraction',
          input: 'image',
          output: 'text',
          apiHost: 'https://paddleocr.aistudio-app.com',
          modelId: 'PP-OCRv5'
        }
      ],
      apiKeys: ['test-api-key']
    }

    mockFile = {
      id: 'test-file-id',
      name: 'test.png',
      origin_name: 'test.png',
      path: '/path/to/test.png',
      size: 1024,
      ext: '.png',
      type: FileTypes.IMAGE,
      created_at: new Date().toISOString(),
      count: 1
    }

    mockContext = {
      requestId: 'test-request-id',
      signal: new AbortController().signal
    }
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('paddleocr')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('paddleocr')
    })
  })

  describe('extractText', () => {
    it('should submit async job and return providerTaskId', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          msg: 'Success',
          data: {
            jobId: 'job-123'
          }
        })
      } as Response)

      const result = await processor.extractText(mockFile, mockConfig, mockContext)
      const payload = JSON.parse(assertPendingResult(result).metadata.providerTaskId) as Record<string, unknown>

      expect(payload.jobId).toBe('job-123')
      expect(payload.feature).toBe('text_extraction')
      expect(payload.fileId).toBe(mockFile.id)
      expect(payload.originalName).toBe(mockFile.origin_name)
      expect(payload.modelId).toBe('PP-OCRv5')
    })

    it('should include Authorization header when API key is provided', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            jobId: 'job-123'
          }
        })
      } as Response)

      await processor.extractText(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer test-api-key')
    })

    it('should send multipart payload', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            jobId: 'job-123'
          }
        })
      } as Response)

      await processor.extractText(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>

      expect(headers['content-type'] ?? headers['Content-Type']).toContain('multipart/form-data')
    })

    it('should include optionalPayload when metadata provides it', async () => {
      const optionalPayload = { useDocUnwarping: true, useDocOrientationClassify: false }
      mockConfig = {
        ...mockConfig,
        capabilities: [
          {
            ...mockConfig.capabilities[0],
            metadata: {
              optionalPayload
            }
          }
        ]
      }

      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            jobId: 'job-123'
          }
        })
      } as Response)

      await processor.extractText(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const bodyText = Buffer.from(options.body as Uint8Array).toString('utf8')
      expect(bodyText).toContain('name="optionalPayload"')
      expect(bodyText).toContain(JSON.stringify(optionalPayload))
    })

    it('should omit optionalPayload when metadata does not provide it', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            jobId: 'job-123'
          }
        })
      } as Response)

      await processor.extractText(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const bodyText = Buffer.from(options.body as Uint8Array).toString('utf8')
      expect(bodyText).not.toContain('name="optionalPayload"')
    })

    it('should throw error for non-image files', async () => {
      const documentFile: FileMetadata = {
        ...mockFile,
        ext: '.pdf',
        type: FileTypes.DOCUMENT
      }

      await expect(processor.extractText(documentFile, mockConfig, mockContext)).rejects.toMatchObject({
        code: 'unsupported_input',
        message: 'PaddleProcessor only supports image files'
      })
    })

    it('should throw error when API returns error', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error details'
      } as Response)

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow(
        'PaddleOCR async job error: 500 Internal Server Error'
      )
    })

    it('should throw error when response validation fails', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invalid: 'response'
        })
      } as Response)

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow()
    })

    it('should check cancellation', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.extractText(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })

    it('should throw when API key is missing', async () => {
      const configWithoutKey = { ...mockConfig, apiKeys: undefined }

      await expect(processor.extractText(mockFile, configWithoutKey, mockContext)).rejects.toThrow(
        'API key is required for paddleocr processor'
      )
    })

    it('should handle network errors', async () => {
      vi.mocked(net.fetch).mockRejectedValueOnce(new Error('Network error'))

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow('Network error')
    })
  })
})
