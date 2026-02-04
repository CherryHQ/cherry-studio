/**
 * PaddleProcessor Tests
 *
 * Tests for the PaddleOCR processor covering:
 * - extractText flow
 * - API calls
 * - Response validation
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

const assertTextResult = (result: ProcessingResult): Extract<ProcessingResult, { text: string }> => {
  if (!('text' in result) || typeof result.text !== 'string') {
    throw new Error('Expected text in processing result')
  }
  return result
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
          apiHost: 'http://localhost:8080/ocr'
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
    it('should extract text from image', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            ocrResults: [
              {
                prunedResult: {
                  rec_texts: ['Hello', 'World']
                }
              }
            ]
          }
        })
      } as Response)

      const result = await processor.extractText(mockFile, mockConfig, mockContext)

      expect(assertTextResult(result).text).toBe('Hello\nWorld')
    })

    it('should return empty text when no OCR results', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            ocrResults: []
          }
        })
      } as Response)

      const result = await processor.extractText(mockFile, mockConfig, mockContext)

      expect(assertTextResult(result).text).toBe('')
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
        'OCR service error: 500 Internal Server Error'
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

    it('should work without API key', async () => {
      const configWithoutKey = { ...mockConfig, apiKeys: undefined }

      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            ocrResults: [
              {
                prunedResult: {
                  rec_texts: ['Test text']
                }
              }
            ]
          }
        })
      } as Response)

      const result = await processor.extractText(mockFile, configWithoutKey, mockContext)

      expect(assertTextResult(result).text).toBe('Test text')

      // Verify Authorization header is not set
      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['Authorization']).toBeUndefined()
    })

    it('should include Authorization header when API key is provided', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            ocrResults: [
              {
                prunedResult: {
                  rec_texts: ['Test']
                }
              }
            ]
          }
        })
      } as Response)

      await processor.extractText(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['Authorization']).toBe('token test-api-key')
    })

    it('should send correct payload structure', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            ocrResults: [
              {
                prunedResult: {
                  rec_texts: ['Test']
                }
              }
            ]
          }
        })
      } as Response)

      await processor.extractText(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const body = JSON.parse(options.body as string)

      expect(body.file).toBeDefined() // base64 encoded image
      expect(body.fileType).toBe(1) // FILE_TYPE_IMAGE
      expect(body.useDocOrientationClassify).toBe(false)
      expect(body.useDocUnwarping).toBe(false)
      expect(body.visualize).toBe(false)
    })

    it('should handle network errors', async () => {
      vi.mocked(net.fetch).mockRejectedValueOnce(new Error('Network error'))

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow('Network error')
    })
  })
})
