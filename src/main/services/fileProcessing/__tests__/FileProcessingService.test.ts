import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FileProcessingService } from '../FileProcessingService'
import { processorRegistry } from '../registry/ProcessorRegistry'
import {
  createMockFileMetadata,
  createMockTemplate,
  MockAsyncProcessor,
  MockMarkdownConverter,
  MockTextExtractor
} from './mocks/MockProcessor'

const testProcessorIds = [
  'test-ocr',
  'custom-ocr',
  'unavailable-ocr',
  'limited-ocr',
  'sync-ocr',
  'cleanup-ocr',
  'error-ocr',
  'slow-ocr',
  'fast-ocr',
  'avail-ocr',
  'ocr-only',
  'md-only',
  'unavailable',
  'get-processor-test',
  'update-processor-test',
  'feature-mismatch',
  'async-processor',
  'async-error-processor'
]

describe('FileProcessingService', () => {
  let service: FileProcessingService

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()

    // Clear processors used in this test suite
    for (const id of testProcessorIds) {
      processorRegistry.unregister(id)
    }

    service = FileProcessingService.getInstance()
  })

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = FileProcessingService.getInstance()
      const instance2 = FileProcessingService.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('startProcess', () => {
    it('should start processing and return pending status', async () => {
      const template = createMockTemplate({ id: 'test-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'extracted text' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'test-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const response = await service.startProcess({ file, feature: 'text_extraction' })

      expect(response.requestId).toBeDefined()
      expect(response.status).toBe('pending')
    })

    it('should use specified processorId from request', async () => {
      const template = createMockTemplate({ id: 'custom-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'result' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const response = await service.startProcess({ file, feature: 'text_extraction', processorId: 'custom-ocr' })

      expect(response.requestId).toBeDefined()
      expect(response.status).toBe('pending')
    })

    it('should throw when no default processor is configured', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        null
      )

      const file = createMockFileMetadata()

      await expect(service.startProcess({ file, feature: 'text_extraction' })).rejects.toThrow(
        'No default processor configured'
      )
    })

    it('should throw when processor is not found', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'nonexistent'
      )

      const file = createMockFileMetadata()

      await expect(service.startProcess({ file, feature: 'text_extraction' })).rejects.toThrow(
        "Processor with id 'nonexistent' not found"
      )
    })
  })

  describe('getResult', () => {
    it('should return completed result for sync processor', async () => {
      const template = createMockTemplate({ id: 'sync-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'hello world' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'sync-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      // Allow async execution to complete
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
      })
    })

    it('should return not_found for unknown requestId', async () => {
      const result = await service.getResult('nonexistent-id')

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('not_found')
    })

    it('should clear task after returning completed status', async () => {
      const template = createMockTemplate({ id: 'cleanup-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'done' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'cleanup-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      // Wait for completion
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
      })

      // Second query still returns completed (TTL cache keeps task for a while)
      const secondQuery = await service.getResult(requestId)
      expect(secondQuery.status).toBe('completed')
    })

    it('should return failed status when processing errors', async () => {
      const template = createMockTemplate({ id: 'error-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockRejectedValue(new Error('Processing failed'))

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'error-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      // Wait for failure
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('failed')
      })
    })
  })

  describe('cancel', () => {
    it('should cancel an active task', async () => {
      const template = createMockTemplate({ id: 'slow-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ text: 'done' }), 5000))
      )

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'slow-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      const cancelResult = service.cancel(requestId)

      expect(cancelResult.success).toBe(true)
      expect(cancelResult.message).toBe('Cancelled')
    })

    it('should return failure when cancelling non-existent task', () => {
      const result = service.cancel('nonexistent-id')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Cannot cancel')
    })

    it('should return failure when cancelling already completed task', async () => {
      const template = createMockTemplate({ id: 'fast-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'result' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'fast-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      // Wait for completion
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
      })

      // getResult already cleared the task, so cancel returns failure
      const cancelResult = service.cancel(requestId)
      expect(cancelResult.success).toBe(false)
    })
  })

  describe('listAvailableProcessors', () => {
    it('should return available processors', async () => {
      const ocrTemplate = createMockTemplate({
        id: 'avail-ocr',
        capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
      })
      const processor = new MockTextExtractor(ocrTemplate)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const processors = await service.listAvailableProcessors()

      expect(processors.some((item) => item.id === 'avail-ocr')).toBe(true)
    })

    it('should filter by feature', async () => {
      const ocrTemplate = createMockTemplate({
        id: 'ocr-only',
        capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
      })
      const mdTemplate = createMockTemplate({
        id: 'md-only',
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })

      const ocrProcessor = new MockTextExtractor(ocrTemplate)
      vi.spyOn(ocrProcessor, 'isAvailable').mockResolvedValue(true)

      const mdProcessor = new MockMarkdownConverter(mdTemplate)
      vi.spyOn(mdProcessor, 'isAvailable').mockResolvedValue(true)

      processorRegistry.register(ocrProcessor)
      processorRegistry.register(mdProcessor)

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const ocrResults = await service.listAvailableProcessors('text_extraction')
      expect(ocrResults.some((item) => item.id === 'ocr-only')).toBe(true)

      const mdResults = await service.listAvailableProcessors('markdown_conversion')
      expect(mdResults.some((item) => item.id === 'md-only')).toBe(true)
    })

    it('should exclude unavailable processors', async () => {
      const template = createMockTemplate({ id: 'unavailable' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(false)

      processorRegistry.register(processor)

      const processors = await service.listAvailableProcessors()

      expect(processors.some((item) => item.id === 'unavailable')).toBe(false)
    })
  })

  describe('getProcessor', () => {
    it('should return processor config for valid id', () => {
      const template = createMockTemplate({ id: 'get-processor-test' })
      const processor = new MockTextExtractor(template)
      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const config = service.getProcessor('get-processor-test')

      expect(config).toBeDefined()
      expect(config?.id).toBe('get-processor-test')
    })

    it('should throw validation error for empty processorId', () => {
      expect(() => service.getProcessor('')).toThrow()
    })

    it('should throw validation error for whitespace-only processorId', () => {
      expect(() => service.getProcessor('   ')).toThrow()
    })

    it('should return null for unknown processor', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const config = service.getProcessor('nonexistent-processor')

      expect(config).toBeNull()
    })
  })

  describe('updateProcessorConfig', () => {
    it('should update processor apiKey', () => {
      // Use a real processor ID from presets (mineru is an API processor)
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const updated = service.updateProcessorConfig('mineru', { apiKey: 'new-key' })

      expect(updated.apiKey).toBe('new-key')
    })

    it('should throw validation error for empty processorId', () => {
      expect(() => service.updateProcessorConfig('', { apiKey: 'test' })).toThrow()
    })

    it('should throw validation error for whitespace-only processorId', () => {
      expect(() => service.updateProcessorConfig('   ', { apiKey: 'test' })).toThrow()
    })

    it('should throw validation error for invalid update object', () => {
      expect(() => service.updateProcessorConfig('test-id', null as never)).toThrow()
    })

    it('should throw NotFound for unknown processor', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      expect(() => service.updateProcessorConfig('nonexistent', { apiKey: 'test' })).toThrow('not found')
    })
  })

  describe('startProcess - validation', () => {
    it('should throw validation error when file is missing', async () => {
      await expect(service.startProcess({ file: undefined as never, feature: 'text_extraction' })).rejects.toThrow()
    })

    it('should throw validation error when feature is missing', async () => {
      const file = createMockFileMetadata()

      await expect(service.startProcess({ file, feature: undefined as never })).rejects.toThrow()
    })

    it('should throw error when processor does not support feature', async () => {
      const template = createMockTemplate({
        id: 'feature-mismatch',
        capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
      })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()

      await expect(
        service.startProcess({ file, feature: 'markdown_conversion', processorId: 'feature-mismatch' })
      ).rejects.toThrow("does not support feature 'markdown_conversion'")
    })
  })

  describe('getResult - validation', () => {
    it('should throw validation error for empty requestId', async () => {
      await expect(service.getResult('')).rejects.toThrow()
    })

    it('should throw validation error for whitespace-only requestId', async () => {
      await expect(service.getResult('   ')).rejects.toThrow()
    })
  })

  describe('cancel - validation', () => {
    it('should throw validation error for empty requestId', () => {
      expect(() => service.cancel('')).toThrow()
    })

    it('should throw validation error for whitespace-only requestId', () => {
      expect(() => service.cancel('   ')).toThrow()
    })
  })

  describe('IProcessStatusProvider flow', () => {
    beforeEach(() => {
      // Mock fs.promises.stat to avoid file system access
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats)
    })

    it('should handle async processor returning providerTaskId', async () => {
      const template = createMockTemplate({
        id: 'async-processor',
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })
      const processor = new MockAsyncProcessor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doConvertMock.mockResolvedValue({
        metadata: { providerTaskId: 'provider-task-123' }
      })
      processor.getStatusMock.mockResolvedValue({
        requestId: 'test',
        status: 'processing',
        progress: 50
      })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_markdown_conversion_processor',
        'async-processor'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata({ name: 'doc.pdf', ext: '.pdf' })
      const { requestId } = await service.startProcess({ file, feature: 'markdown_conversion' })

      expect(requestId).toBeDefined()

      // Wait for async processing to set providerTaskId
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        // Should be processing since we have a providerTaskId
        expect(result.status).toBe('processing')
        expect(result.progress).toBe(50)
      })

      expect(processor.getStatusMock).toHaveBeenCalled()
    })

    it('should update task state from provider status to completed', async () => {
      const template = createMockTemplate({
        id: 'async-processor',
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })
      const processor = new MockAsyncProcessor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doConvertMock.mockResolvedValue({
        metadata: { providerTaskId: 'provider-task-456' }
      })

      let callCount = 0
      processor.getStatusMock.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return { requestId: 'test', status: 'processing', progress: 75 }
        }
        return {
          requestId: 'test',
          status: 'completed',
          progress: 100,
          result: { markdownPath: '/path/to/output.md' }
        }
      })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_markdown_conversion_processor',
        'async-processor'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata({ name: 'doc.pdf', ext: '.pdf' })
      const { requestId } = await service.startProcess({ file, feature: 'markdown_conversion' })

      // Wait for providerTaskId to be set first
      await vi.waitFor(async () => {
        await service.getResult(requestId)
        expect(processor.getStatusMock).toHaveBeenCalled()
      })

      // Second call should get completed status
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
        expect(result.result?.markdownPath).toBe('/path/to/output.md')
      })
    })

    it('should handle provider status query failure', async () => {
      const template = createMockTemplate({
        id: 'async-error-processor',
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })
      const processor = new MockAsyncProcessor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doConvertMock.mockResolvedValue({
        metadata: { providerTaskId: 'provider-task-error' }
      })
      processor.getStatusMock.mockRejectedValue(new Error('Provider API error'))

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_markdown_conversion_processor',
        'async-error-processor'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata({ name: 'doc.pdf', ext: '.pdf' })
      const { requestId } = await service.startProcess({ file, feature: 'markdown_conversion' })

      // Wait for providerTaskId to be set and status query to fail
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('failed')
        expect(result.error?.code).toBe('status_query_failed')
        expect(result.error?.message).toContain('Provider API error')
      })
    })
  })
})
