import { beforeEach, describe, expect, it } from 'vitest'

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

  beforeEach(() => {
    processor = new MockMarkdownConverter(
      createMockTemplate({
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })
    )
    processor.doConvertMock.mockResolvedValue({ markdownPath: '/path/to/output.md' })
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
