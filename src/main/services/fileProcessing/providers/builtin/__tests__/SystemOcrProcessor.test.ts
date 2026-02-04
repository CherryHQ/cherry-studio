/**
 * SystemOcrProcessor Tests
 *
 * Tests for the System OCR processor covering:
 * - Platform-specific availability
 * - Text extraction flow
 * - Language configuration
 * - Error handling
 */

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'

import type { ProcessingContext } from '../../../types'
import { SystemOcrProcessor } from '../SystemOcrProcessor'

// Mock dependencies
vi.mock('@main/constant', () => ({
  isLinux: false,
  isWin: false
}))

vi.mock('@main/utils/ocr', () => ({
  loadOcrImage: vi.fn().mockResolvedValue(Buffer.from('mock image content'))
}))

const assertTextResult = (result: ProcessingResult): Extract<ProcessingResult, { text: string }> => {
  if (!('text' in result) || typeof result.text !== 'string') {
    throw new Error('Expected text in processing result')
  }
  return result
}

// Use vi.hoisted to define mock at hoisted level (vi.mock is hoisted to top)
const mockRecognize = vi.hoisted(() => vi.fn().mockResolvedValue({ text: 'Recognized system OCR text' }))

vi.mock('@napi-rs/system-ocr', () => ({
  OcrAccuracy: {
    Accurate: 1
  },
  recognize: mockRecognize
}))

describe('SystemOcrProcessor', () => {
  let processor: SystemOcrProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new SystemOcrProcessor()

    mockConfig = {
      id: 'system',
      type: 'builtin',
      capabilities: [
        {
          feature: 'text_extraction',
          input: 'image',
          output: 'text'
        }
      ]
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

    mockRecognize.mockResolvedValue({ text: 'Recognized system OCR text' })
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('system')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('system')
    })
  })

  describe('isAvailable', () => {
    it('should return true when not on Linux', async () => {
      const available = await processor.isAvailable()
      expect(available).toBe(true)
    })
  })

  describe('extractText', () => {
    it('should extract text from image', async () => {
      const result = await processor.extractText(mockFile, mockConfig, mockContext)

      expect(assertTextResult(result).text).toBe('Recognized system OCR text')
    })

    it('should throw error for non-image files', async () => {
      const documentFile: FileMetadata = {
        ...mockFile,
        ext: '.pdf',
        type: FileTypes.DOCUMENT
      }

      await expect(processor.extractText(documentFile, mockConfig, mockContext)).rejects.toMatchObject({
        code: 'unsupported_input',
        message: 'SystemOcrProcessor only supports image files'
      })
    })

    it('should check cancellation before processing', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.extractText(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })

    it('should call recognize with correct parameters', async () => {
      await processor.extractText(mockFile, mockConfig, mockContext)

      expect(mockRecognize).toHaveBeenCalledWith(expect.any(Buffer), 1, undefined)
    })

    it('should handle recognition errors', async () => {
      mockRecognize.mockRejectedValueOnce(new Error('Recognition failed'))

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow('Recognition failed')
    })
  })
})
