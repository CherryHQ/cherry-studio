import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isMarkdownConverter, isTextExtractor } from '../interfaces'
import {
  createDualCapabilityTemplate,
  createMockConfig,
  createMockContext,
  createMockFileMetadata,
  createMockTemplate,
  MockDualProcessor,
  MockMarkdownConverter,
  MockTextExtractor
} from './mocks/MockProcessor'

describe('BaseFileProcessor', () => {
  describe('isAvailable', () => {
    it('should return true by default', async () => {
      const processor = new MockTextExtractor(createMockTemplate())

      const result = await processor.isAvailable()

      expect(result).toBe(true)
    })
  })

  describe('id and template', () => {
    it('should expose id from template', () => {
      const processor = new MockTextExtractor(createMockTemplate({ id: 'test-processor' }))

      expect(processor.id).toBe('test-processor')
    })

    it('should expose template', () => {
      const template = createMockTemplate({ id: 'test-processor' })
      const processor = new MockTextExtractor(template)

      expect(processor.template).toBe(template)
    })
  })
})

describe('BaseTextExtractor', () => {
  let processor: MockTextExtractor

  beforeEach(() => {
    processor = new MockTextExtractor(createMockTemplate())
    processor.doExtractTextMock.mockResolvedValue({ text: 'extracted text' })
  })

  describe('extractText', () => {
    it('should return result', async () => {
      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processor.extractText(input, config, context)

      expect(result).toEqual({ text: 'extracted text' })
      expect(processor.doExtractTextMock).toHaveBeenCalledWith(input, config, context)
    })

    it('should validate input has path', async () => {
      const input = createMockFileMetadata({ path: '' })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processor.extractText(input, config, context)).rejects.toThrow('File path is required')
    })

    it('should validate input path is not undefined', async () => {
      const input = createMockFileMetadata({ path: undefined as unknown as string })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processor.extractText(input, config, context)).rejects.toThrow('File path is required')
    })

    it('should check cancellation before processing', async () => {
      const controller = new AbortController()
      controller.abort()

      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext({ signal: controller.signal })

      await expect(processor.extractText(input, config, context)).rejects.toThrow('Processing cancelled')
      expect(processor.doExtractTextMock).not.toHaveBeenCalled()
    })

    it('should not throw when signal is not aborted', async () => {
      const controller = new AbortController()

      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext({ signal: controller.signal })

      const result = await processor.extractText(input, config, context)

      expect(result).toEqual({ text: 'extracted text' })
    })
  })
})

describe('BaseMarkdownConverter', () => {
  let processor: MockMarkdownConverter
  let statSpy: { mockRestore: () => void }

  beforeEach(() => {
    statSpy = vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)
    processor = new MockMarkdownConverter(
      createMockTemplate({
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })
    )
    processor.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })
  })

  afterEach(() => {
    statSpy.mockRestore()
  })

  describe('convertToMarkdown', () => {
    it('should return result', async () => {
      const input = createMockFileMetadata({ name: 'test.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processor.convertToMarkdown(input, config, context)

      expect(result).toEqual({ markdownPath: '/path/to/output.md' })
      expect(processor.doConvertMock).toHaveBeenCalledWith(input, config, context)
    })

    it('should validate document has path', async () => {
      const input = createMockFileMetadata({ path: '' })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processor.convertToMarkdown(input, config, context)).rejects.toThrow('File path is required')
    })

    it('should validate document path is not undefined', async () => {
      const input = createMockFileMetadata({ path: undefined as unknown as string })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processor.convertToMarkdown(input, config, context)).rejects.toThrow('File path is required')
    })

    it('should check cancellation before processing', async () => {
      const controller = new AbortController()
      controller.abort()

      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext({ signal: controller.signal })

      await expect(processor.convertToMarkdown(input, config, context)).rejects.toThrow('Processing cancelled')
      expect(processor.doConvertMock).not.toHaveBeenCalled()
    })

    it('should not throw when signal is not aborted', async () => {
      const controller = new AbortController()

      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext({ signal: controller.signal })

      const result = await processor.convertToMarkdown(input, config, context)

      expect(result).toEqual({ markdownPath: '/path/to/output.md' })
    })
  })

  describe('file size validation', () => {
    it('should throw error when file size exceeds limit', async () => {
      // Create processor with maxFileSizeMb metadata
      const processorWithLimit = new MockMarkdownConverter(
        createMockTemplate({
          capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }],
          metadata: { maxFileSizeMb: 10 }
        })
      )
      processorWithLimit.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })

      // Mock file size larger than limit (15MB > 10MB)
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 15 * 1024 * 1024 } as fs.Stats)

      const input = createMockFileMetadata({ name: 'large.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processorWithLimit.convertToMarkdown(input, config, context)).rejects.toThrow(
        'exceeds the limit of 10MB'
      )
    })

    it('should not throw when file size is within limit', async () => {
      const processorWithLimit = new MockMarkdownConverter(
        createMockTemplate({
          capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }],
          metadata: { maxFileSizeMb: 10 }
        })
      )
      processorWithLimit.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })

      // Mock file size smaller than limit (5MB < 10MB)
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 5 * 1024 * 1024 } as fs.Stats)

      const input = createMockFileMetadata({ name: 'normal.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processorWithLimit.convertToMarkdown(input, config, context)

      expect(result).toEqual({ markdownPath: '/path/to/output.md' })
    })
  })

  describe('PDF page count validation', () => {
    it('should throw error when PDF page count exceeds limit', async () => {
      const processorWithLimit = new MockMarkdownConverter(
        createMockTemplate({
          capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }],
          metadata: { maxPageCount: 100 }
        })
      )
      processorWithLimit.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })

      // Mock file stats
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)

      // Mock PDF with 150 pages (> 100 limit)
      // Create a minimal valid PDF with many pages using pdf-lib
      const { PDFDocument: RealPDFDocument } = await import('pdf-lib')
      const pdfDoc = await RealPDFDocument.create()
      for (let i = 0; i < 150; i++) {
        pdfDoc.addPage()
      }
      const pdfBytes = await pdfDoc.save()
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from(pdfBytes))

      const input = createMockFileMetadata({ name: 'large.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processorWithLimit.convertToMarkdown(input, config, context)).rejects.toThrow(
        'exceeds the limit of 100 pages'
      )
    })

    it('should not throw when PDF page count is within limit', async () => {
      const processorWithLimit = new MockMarkdownConverter(
        createMockTemplate({
          capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }],
          metadata: { maxPageCount: 100 }
        })
      )
      processorWithLimit.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })

      // Mock file stats
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)

      // Mock PDF with 50 pages (< 100 limit)
      const { PDFDocument: RealPDFDocument } = await import('pdf-lib')
      const pdfDoc = await RealPDFDocument.create()
      for (let i = 0; i < 50; i++) {
        pdfDoc.addPage()
      }
      const pdfBytes = await pdfDoc.save()
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from(pdfBytes))

      const input = createMockFileMetadata({ name: 'normal.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processorWithLimit.convertToMarkdown(input, config, context)

      expect(result).toEqual({ markdownPath: '/path/to/output.md' })
    })

    it('should skip page count validation for non-PDF files', async () => {
      const processorWithLimit = new MockMarkdownConverter(
        createMockTemplate({
          capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }],
          metadata: { maxPageCount: 100 }
        })
      )
      processorWithLimit.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })

      // Mock file stats
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)

      // Non-PDF file - should not trigger page count validation
      // Even if we don't mock readFile, it shouldn't fail for non-PDF files
      const input = createMockFileMetadata({ name: 'doc.docx', ext: '.docx' })
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processorWithLimit.convertToMarkdown(input, config, context)

      // Should succeed without checking page count
      expect(result).toEqual({ markdownPath: '/path/to/output.md' })
    })

    it('should handle PDF parsing errors gracefully', async () => {
      const processorWithLimit = new MockMarkdownConverter(
        createMockTemplate({
          capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }],
          metadata: { maxPageCount: 100 }
        })
      )
      processorWithLimit.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })

      // Mock file stats
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)

      // Mock corrupted PDF (invalid bytes)
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('not a valid pdf'))

      const input = createMockFileMetadata({ name: 'corrupted.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      // Should proceed without throwing - graceful degradation
      const result = await processorWithLimit.convertToMarkdown(input, config, context)

      expect(result).toEqual({ markdownPath: '/path/to/output.md' })
    })
  })
})

describe('MockDualProcessor (dual capability)', () => {
  let processor: MockDualProcessor

  beforeEach(() => {
    processor = new MockDualProcessor(createDualCapabilityTemplate())
    processor.doExtractTextMock.mockResolvedValue({ text: 'extracted text from OCR' })
    processor.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/document.md' })
  })

  describe('getCapability', () => {
    it('should return different API hosts for different features', () => {
      const textCapability = processor.template.capabilities.find((c) => c.feature === 'text_extraction')
      const markdownCapability = processor.template.capabilities.find((c) => c.feature === 'markdown_conversion')

      expect(textCapability?.apiHost).toBe('https://ocr.example.com')
      expect(markdownCapability?.apiHost).toBe('https://markdown.example.com')
    })
  })

  describe('type guards', () => {
    it('should pass isTextExtractor check', () => {
      expect(isTextExtractor(processor)).toBe(true)
    })

    it('should pass isMarkdownConverter check', () => {
      expect(isMarkdownConverter(processor)).toBe(true)
    })
  })

  describe('extractText', () => {
    it('should extract text from image', async () => {
      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processor.extractText(input, config, context)

      expect(result).toEqual({ text: 'extracted text from OCR' })
      expect(processor.doExtractTextMock).toHaveBeenCalledWith(input, config, context)
    })

    it('should check cancellation before processing', async () => {
      const controller = new AbortController()
      controller.abort()

      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext({ signal: controller.signal })

      await expect(processor.extractText(input, config, context)).rejects.toThrow('Processing cancelled')
    })

    it('should validate input path', async () => {
      const input = createMockFileMetadata({ path: '' })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processor.extractText(input, config, context)).rejects.toThrow('File path is required')
    })
  })

  describe('convertToMarkdown', () => {
    it('should convert document to markdown', async () => {
      const input = createMockFileMetadata({ name: 'doc.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      const result = await processor.convertToMarkdown(input, config, context)

      expect(result).toEqual({ markdownPath: '/path/to/document.md' })
      expect(processor.doConvertMock).toHaveBeenCalledWith(input, config, context)
    })

    it('should check cancellation before processing', async () => {
      const controller = new AbortController()
      controller.abort()

      const input = createMockFileMetadata()
      const config = createMockConfig()
      const context = createMockContext({ signal: controller.signal })

      await expect(processor.convertToMarkdown(input, config, context)).rejects.toThrow('Processing cancelled')
    })

    it('should validate document path', async () => {
      const input = createMockFileMetadata({ path: '' })
      const config = createMockConfig()
      const context = createMockContext()

      await expect(processor.convertToMarkdown(input, config, context)).rejects.toThrow('File path is required')
    })
  })

  describe('using both capabilities in sequence', () => {
    it('should be able to call both extractText and convertToMarkdown', async () => {
      const imageInput = createMockFileMetadata({ name: 'image.png', ext: '.png' })
      const docInput = createMockFileMetadata({ name: 'doc.pdf', ext: '.pdf' })
      const config = createMockConfig()
      const context = createMockContext()

      const textResult = await processor.extractText(imageInput, config, context)
      const markdownResult = await processor.convertToMarkdown(docInput, config, context)

      expect(textResult).toEqual({ text: 'extracted text from OCR' })
      expect(markdownResult).toEqual({ markdownPath: '/path/to/document.md' })
      expect(processor.doExtractTextMock).toHaveBeenCalledTimes(1)
      expect(processor.doConvertMock).toHaveBeenCalledTimes(1)
    })
  })
})
