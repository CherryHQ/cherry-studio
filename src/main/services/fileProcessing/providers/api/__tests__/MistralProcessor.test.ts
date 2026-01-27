/**
 * MistralProcessor Tests
 *
 * Tests for the Mistral document processor covering:
 * - convertToMarkdown flow
 * - Document preparation (PDF and image)
 * - OCR response processing
 * - Image extraction
 */

import * as fs from 'node:fs'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'

import type { ProcessingContext } from '../../../types'
import { MistralProcessor } from '../MistralProcessor'

// Mock dependencies
vi.mock('@main/services/FileStorage', () => ({
  fileStorage: {
    getFilePathById: vi.fn().mockReturnValue('/path/to/test.pdf')
  }
}))

vi.mock('@main/services/MistralClientManager', () => ({
  MistralClientManager: {
    getInstance: vi.fn().mockReturnValue({
      initializeClient: vi.fn(),
      getClient: vi.fn().mockReturnValue({
        files: {
          getSignedUrl: vi.fn().mockResolvedValue({ url: 'https://signed.url' })
        },
        ocr: {
          process: vi.fn()
        }
      })
    })
  }
}))

vi.mock('@main/services/remotefile/MistralService', () => ({
  MistralService: vi.fn().mockImplementation(() => ({
    uploadFile: vi.fn().mockResolvedValue({
      status: 'success',
      fileId: 'test-file-id',
      displayName: 'test.pdf'
    })
  }))
}))

describe('MistralProcessor', () => {
  let processor: MistralProcessor
  let mockConfig: FileProcessorMerged
  let mockPdfFile: FileMetadata
  let mockImageFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new MistralProcessor()

    mockConfig = {
      id: 'mistral',
      type: 'api',
      capabilities: [
        {
          feature: 'markdown_conversion',
          input: 'document',
          output: 'markdown',
          apiHost: 'https://api.mistral.ai',
          modelId: 'mistral-ocr-latest'
        }
      ],
      apiKeys: ['test-api-key']
    }

    mockPdfFile = {
      id: 'test-file-id',
      name: 'test.pdf',
      origin_name: 'test.pdf',
      path: '/path/to/test.pdf',
      size: 1024,
      ext: '.pdf',
      type: FileTypes.DOCUMENT,
      created_at: new Date().toISOString(),
      count: 1
    }

    mockImageFile = {
      id: 'test-image-id',
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
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mock image content'))
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('mock pdf content'))
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('mistral')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('mistral')
    })
  })

  describe('convertToMarkdown', () => {
    it('should process PDF and return markdown path', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      vi.mocked(mockClient.ocr.process).mockResolvedValue({
        pages: [{ markdown: '# Test Document\n\nThis is a test.', images: [] }]
      } as any)

      const result = await processor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)

      expect(result.markdownPath).toBeDefined()
      expect(result.markdownPath).toContain('.md')
    })

    it('should process image file with base64 encoding', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      vi.mocked(mockClient.ocr.process).mockResolvedValue({
        pages: [{ markdown: 'Text from image', images: [] }]
      } as any)

      const result = await processor.convertToMarkdown(mockImageFile, mockConfig, mockContext)

      expect(result.markdownPath).toBeDefined()
    })

    it('should throw error when OCR response is empty', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      vi.mocked(mockClient.ocr.process).mockResolvedValue(null as never)

      await expect(processor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)).rejects.toThrow(
        'OCR processing failed: response is empty'
      )
    })

    it('should throw error when API key is missing', async () => {
      const configWithoutKey = { ...mockConfig, apiKeys: undefined }

      await expect(processor.convertToMarkdown(mockPdfFile, configWithoutKey, mockContext)).rejects.toThrow(
        /API key.*required/i
      )
    })

    it('should throw error when model ID is missing', async () => {
      const configWithoutModel = {
        ...mockConfig,
        capabilities: [
          {
            feature: 'markdown_conversion' as const,
            input: 'document' as const,
            output: 'markdown' as const,
            apiHost: 'https://api.mistral.ai'
            // modelId missing
          }
        ]
      }

      await expect(processor.convertToMarkdown(mockPdfFile, configWithoutModel, mockContext)).rejects.toThrow(
        /Model ID.*required/i
      )
    })

    it('should check cancellation', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.convertToMarkdown(mockPdfFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })

    it('should throw error when file upload fails', async () => {
      const { MistralService } = await import('@main/services/remotefile/MistralService')

      vi.mocked(MistralService).mockImplementationOnce(
        () =>
          ({
            uploadFile: vi.fn().mockResolvedValue({
              status: 'failed',
              displayName: 'test.pdf'
            })
          }) as never
      )

      // Create a new processor to pick up the new mock
      const newProcessor = new MistralProcessor()

      await expect(newProcessor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)).rejects.toThrow(
        /Failed to upload file/
      )
    })
  })

  describe('processOcrResponse with images', () => {
    it('should extract and save embedded images', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      vi.mocked(mockClient.ocr.process).mockResolvedValue({
        pages: [
          {
            markdown: `# Test\n\n![image](${base64Image})`,
            images: [{ imageBase64: base64Image }]
          }
        ]
      } as any)

      const result = await processor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)

      expect(result.markdownPath).toBeDefined()
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    it('should skip images without base64 data', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      vi.mocked(mockClient.ocr.process).mockResolvedValue({
        pages: [
          {
            markdown: '# Test\n\nNo images here.',
            images: [{ imageBase64: undefined }]
          }
        ]
      } as any)

      const result = await processor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)

      expect(result.markdownPath).toBeDefined()
    })

    it('should handle image save errors gracefully', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      const base64Image = 'data:image/png;base64,iVBORw0KGgo='

      vi.mocked(mockClient.ocr.process).mockResolvedValue({
        pages: [
          {
            markdown: `# Test\n\n![image](${base64Image})`,
            images: [{ imageBase64: base64Image }]
          }
        ]
      } as any)

      // Make writeFileSync throw for image files
      vi.spyOn(fs, 'writeFileSync').mockImplementation((path) => {
        if (String(path).includes('img-')) {
          throw new Error('Disk full')
        }
      })

      // Should not throw, just log error
      const result = await processor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)
      expect(result.markdownPath).toBeDefined()
    })
  })

  describe('multiple pages', () => {
    it('should combine markdown from multiple pages', async () => {
      const { MistralClientManager } = await import('@main/services/MistralClientManager')
      const mockClient = MistralClientManager.getInstance().getClient()

      vi.mocked(mockClient.ocr.process).mockResolvedValue({
        pages: [
          { markdown: '# Page 1', images: [] },
          { markdown: '# Page 2', images: [] },
          { markdown: '# Page 3', images: [] }
        ]
      } as any)

      const result = await processor.convertToMarkdown(mockPdfFile, mockConfig, mockContext)

      expect(result.markdownPath).toBeDefined()
      // Verify writeFileSync was called with combined content
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) => String(call[0]).endsWith('.md'))
      expect(writeCall).toBeDefined()
      const content = writeCall![1] as string
      expect(content).toContain('# Page 1')
      expect(content).toContain('# Page 2')
      expect(content).toContain('# Page 3')
    })
  })
})
