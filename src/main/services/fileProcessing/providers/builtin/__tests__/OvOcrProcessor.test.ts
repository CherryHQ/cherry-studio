/**
 * OvOcrProcessor Tests
 *
 * Tests for the OpenVINO OCR processor covering:
 * - Availability checks
 * - Text extraction flow
 * - Batch script execution
 * - Error handling
 */

import * as fs from 'node:fs'
import * as os from 'node:os'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'

import type { ProcessingContext } from '../../../types'
import { OvOcrProcessor } from '../OvOcrProcessor'

// Use vi.hoisted to define mock at hoisted level (vi.mock is hoisted to top)
const mockExecAsync = vi.hoisted(() => vi.fn())

// Mock child_process
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecAsync)
}))

vi.mock('@main/constant', () => ({
  isWin: true
}))

describe('OvOcrProcessor', () => {
  let processor: OvOcrProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new OvOcrProcessor()

    mockConfig = {
      id: 'ovocr',
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

    // Mock os.cpus to return Intel Ultra CPU
    vi.mocked(os.cpus).mockReturnValue([
      {
        model: 'Intel(R) Core(TM) Ultra 7 155H',
        speed: 3000,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
      }
    ])

    // Mock fs methods
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.promises.readFile).mockResolvedValue('Extracted OCR text')

    // Mock exec to succeed
    mockExecAsync.mockResolvedValue({ stdout: 'success', stderr: '' })
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('ovocr')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('ovocr')
    })
  })

  describe('isAvailable', () => {
    it('should return true when on Windows with Intel Ultra CPU and bat file exists', async () => {
      const available = await processor.isAvailable()
      expect(available).toBe(true)
    })

    it('should return false when CPU is not Intel Ultra', async () => {
      vi.mocked(os.cpus).mockReturnValue([
        {
          model: 'AMD Ryzen 9 5900X',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
        }
      ])

      const newProcessor = new OvOcrProcessor()
      const available = await newProcessor.isAvailable()
      expect(available).toBe(false)
    })

    it('should return false when bat file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const newProcessor = new OvOcrProcessor()
      const available = await newProcessor.isAvailable()
      expect(available).toBe(false)
    })
  })

  describe('extractText', () => {
    it('should extract text from image', async () => {
      const result = await processor.extractText(mockFile, mockConfig, mockContext)

      expect(result.text).toBe('Extracted OCR text')
    })

    it('should throw error for non-image files', async () => {
      const documentFile: FileMetadata = {
        ...mockFile,
        ext: '.pdf',
        type: FileTypes.DOCUMENT
      }

      await expect(processor.extractText(documentFile, mockConfig, mockContext)).rejects.toThrow(
        'OvOcrProcessor only supports image files'
      )
    })

    it('should throw error when not available', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const unavailableProcessor = new OvOcrProcessor()

      await expect(unavailableProcessor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow(
        'OV OCR is not available on this system'
      )
    })

    it('should check cancellation before batch execution', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.extractText(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })

    it('should throw error when output file not found', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        // Return true for bat file, false for output file
        return !String(path).includes('output')
      })

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow(
        'OV OCR output file not found'
      )
    })

    it('should throw error when batch execution fails', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('Batch execution failed'))

      await expect(processor.extractText(mockFile, mockConfig, mockContext)).rejects.toThrow('Failed to run OCR batch')
    })
  })
})
