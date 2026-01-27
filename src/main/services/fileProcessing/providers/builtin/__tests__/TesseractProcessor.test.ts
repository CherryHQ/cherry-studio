/**
 * TesseractProcessor Tests
 *
 * Tests for the Tesseract OCR processor covering:
 * - Worker management
 * - Language configuration
 * - Error propagation
 * - Text extraction
 */

import * as fs from 'node:fs'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'

import type { ProcessingContext } from '../../../types'
import { TesseractProcessor } from '../TesseractProcessor'

// Mock dependencies
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockImplementation(() =>
    Promise.resolve({
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'Recognized text from image' }
      }),
      terminate: vi.fn().mockResolvedValue(undefined)
    })
  )
}))

vi.mock('@main/utils/ocr', () => ({
  loadOcrImage: vi.fn().mockResolvedValue(Buffer.from('mock image content'))
}))

vi.mock('@main/utils/ipService', () => ({
  getIpCountry: vi.fn().mockResolvedValue('US')
}))

describe('TesseractProcessor', () => {
  let processor: TesseractProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new TesseractProcessor()

    mockConfig = {
      id: 'tesseract',
      type: 'builtin',
      capabilities: [
        {
          feature: 'text_extraction',
          input: 'image',
          output: 'text'
        }
      ],
      options: {
        langs: ['eng', 'chi_sim']
      }
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

    // Mock fs methods
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1024 } as fs.Stats)
    vi.mocked(fs.promises.access).mockResolvedValue(undefined)
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await processor.dispose()
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('tesseract')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('tesseract')
    })
  })

  describe('extractText', () => {
    it('should extract text from image', async () => {
      const result = await processor.extractText(mockFile, mockConfig, mockContext)

      expect(result.text).toBe('Recognized text from image')
    })

    it('should throw error for non-image files', async () => {
      const documentFile: FileMetadata = {
        ...mockFile,
        ext: '.pdf',
        type: FileTypes.DOCUMENT
      }

      await expect(processor.extractText(documentFile, mockConfig, mockContext)).rejects.toThrow(
        'TesseractProcessor only supports image files'
      )
    })

    it('should throw error for files exceeding size limit', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 60 * 1024 * 1024 } as fs.Stats) // 60MB

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow(/too large/)
    })

    it('should check cancellation before processing', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.extractText(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })

    it('should use default languages when not configured', async () => {
      const configWithoutLangs = { ...mockConfig, options: undefined }

      const result = await processor.extractText(mockFile, configWithoutLangs, mockContext)

      expect(result.text).toBe('Recognized text from image')

      const { createWorker } = await import('tesseract.js')
      expect(createWorker).toHaveBeenCalledWith(['chi_sim', 'chi_tra', 'eng'], undefined, expect.any(Object))
    })

    it('should parse langs from object format', async () => {
      const configWithObjectLangs = {
        ...mockConfig,
        options: {
          langs: { eng: true, fra: true }
        }
      }

      await processor.extractText(mockFile, configWithObjectLangs, mockContext)

      const { createWorker } = await import('tesseract.js')
      expect(createWorker).toHaveBeenCalledWith(['eng', 'fra'], undefined, expect.any(Object))
    })

    it('should parse langs from array format', async () => {
      const configWithArrayLangs = {
        ...mockConfig,
        options: {
          langs: ['deu', 'spa']
        }
      }

      await processor.extractText(mockFile, configWithArrayLangs, mockContext)

      const { createWorker } = await import('tesseract.js')
      expect(createWorker).toHaveBeenCalledWith(['deu', 'spa'], undefined, expect.any(Object))
    })
  })

  describe('worker management', () => {
    it('should reuse worker for same language configuration', async () => {
      await processor.extractText(mockFile, mockConfig, mockContext)
      await processor.extractText(mockFile, mockConfig, mockContext)

      const { createWorker } = await import('tesseract.js')
      // Worker should be created only once
      expect(createWorker).toHaveBeenCalledTimes(1)
    })

    it('should reinitialize worker when language changes', async () => {
      await processor.extractText(mockFile, mockConfig, mockContext)

      const newConfig = {
        ...mockConfig,
        options: { langs: ['jpn'] }
      }
      await processor.extractText(mockFile, newConfig, mockContext)

      const { createWorker } = await import('tesseract.js')
      expect(createWorker).toHaveBeenCalledTimes(2)
    })

    it('should dispose worker properly', async () => {
      await processor.extractText(mockFile, mockConfig, mockContext)

      const { createWorker } = await import('tesseract.js')
      const mockWorker = await vi.mocked(createWorker).mock.results[0].value

      await processor.dispose()

      expect(mockWorker.terminate).toHaveBeenCalled()
    })
  })

  describe('error propagation', () => {
    it('should propagate worker initialization errors', async () => {
      const { createWorker } = await import('tesseract.js')

      // Create a new processor to get fresh mock
      const newProcessor = new TesseractProcessor()

      // Set up the worker to trigger error handler during init

      vi.mocked(createWorker).mockImplementationOnce(async (_langs: any, _oem: any, options: any) => {
        // Simulate error during worker creation
        if (options?.errorHandler) {
          options.errorHandler(new Error('Worker initialization failed'))
        }
        return {
          recognize: vi.fn(),
          terminate: vi.fn()
        } as any
      })

      await expect(newProcessor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow(
        /Worker initialization failed/
      )
    })

    it('should propagate recognition errors', async () => {
      const { createWorker } = await import('tesseract.js')

      vi.mocked(createWorker).mockImplementationOnce(
        async () =>
          ({
            recognize: vi.fn().mockRejectedValue(new Error('Recognition failed')),
            terminate: vi.fn()
          }) as any
      )

      const newProcessor = new TesseractProcessor()

      await expect(newProcessor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow('Recognition failed')
    })
  })

  describe('getLangPath', () => {
    it('should return CN URL for Chinese users', async () => {
      const { getIpCountry } = await import('@main/utils/ipService')
      vi.mocked(getIpCountry).mockResolvedValueOnce('CN')

      // Create new processor to test lang path
      const newProcessor = new TesseractProcessor()
      await newProcessor.extractText(mockFile, mockConfig, mockContext)

      const { createWorker } = await import('tesseract.js')
      const lastCall = vi.mocked(createWorker).mock.calls[vi.mocked(createWorker).mock.calls.length - 1]
      const options = lastCall[2] as { langPath: string }
      expect(options.langPath).toContain('gitcode.com')
    })

    it('should return empty string for non-CN users', async () => {
      const { getIpCountry } = await import('@main/utils/ipService')
      vi.mocked(getIpCountry).mockResolvedValueOnce('US')

      const newProcessor = new TesseractProcessor()
      await newProcessor.extractText(mockFile, mockConfig, mockContext)

      const { createWorker } = await import('tesseract.js')
      const lastCall = vi.mocked(createWorker).mock.calls[vi.mocked(createWorker).mock.calls.length - 1]
      const options = lastCall[2] as { langPath: string }
      expect(options.langPath).toBe('')
    })
  })
})
