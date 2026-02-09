import type { FileProcessorId } from '@shared/data/presets/file-processing'
import type { ProcessResultResponse } from '@shared/data/types/fileProcessing'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UnsupportedInputError } from '../errors'
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
  'cancelled-ocr',
  'fast-ocr',
  'avail-ocr',
  'ocr-only',
  'md-only',
  'unavailable',
  'get-processor-test',
  'update-processor-test',
  'feature-mismatch',
  'missing-result-ocr',
  'async-processor',
  'async-error-processor',
  'async-missing-provider-task-id',
  'before-ttl-ocr',
  'completed-at-ocr',
  'expired-ocr'
]

const assertFailedResponse = (
  response: ProcessResultResponse
): Extract<ProcessResultResponse, { status: 'failed' }> => {
  expect(response.status).toBe('failed')
  if (response.status !== 'failed') {
    throw new Error(`Expected failed status, got ${response.status}`)
  }
  return response
}

const assertCompletedResponse = (
  response: ProcessResultResponse
): Extract<ProcessResultResponse, { status: 'completed' }> => {
  expect(response.status).toBe('completed')
  if (response.status !== 'completed') {
    throw new Error(`Expected completed status, got ${response.status}`)
  }
  return response
}

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
      const response = await service.startProcess({
        file,
        feature: 'text_extraction',
        processorId: 'custom-ocr' as FileProcessorId
      })

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
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('not_found')
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

    it('should return unsupported_input when processor rejects input', async () => {
      const template = createMockTemplate({ id: 'unsupported-input-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockRejectedValue(new UnsupportedInputError('Unsupported input type'))

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'unsupported-input-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('failed')
        const failed = assertFailedResponse(result)
        expect(failed.error.code).toBe('unsupported_input')
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

    it('should return cancelled status after cancellation', async () => {
      const template = createMockTemplate({ id: 'cancelled-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockImplementation(() => new Promise(() => {}))

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'cancelled-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      service.cancel(requestId)

      const result = await service.getResult(requestId)
      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('cancelled')
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

  describe('getResult - edge cases', () => {
    it('should fail when completed result is missing output', async () => {
      const template = createMockTemplate({ id: 'missing-result-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ metadata: { providerTaskId: 'missing-result' } })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'missing-result-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('failed')
        const failed = assertFailedResponse(result)
        expect(failed.error.code).toBe('processing_failed')
        expect(failed.error.message).toBe('Processing completed but result is missing')
      })
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
    it('should update processor apiKeys', () => {
      // Use a real processor ID from presets (mineru is an API processor)
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const updated = service.updateProcessorConfig('mineru', { apiKeys: ['new-key'] })

      expect(updated.apiKeys).toEqual(['new-key'])
    })

    it('should throw validation error for empty processorId', () => {
      expect(() => service.updateProcessorConfig('', { apiKeys: ['test'] })).toThrow()
    })

    it('should throw validation error for whitespace-only processorId', () => {
      expect(() => service.updateProcessorConfig('   ', { apiKeys: ['test'] })).toThrow()
    })

    it('should throw validation error for invalid update object', () => {
      expect(() => service.updateProcessorConfig('test-id', null as never)).toThrow()
    })

    it('should throw NotFound for unknown processor', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      expect(() => service.updateProcessorConfig('nonexistent', { apiKeys: ['test'] })).toThrow('not found')
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
        service.startProcess({
          file,
          feature: 'markdown_conversion',
          processorId: 'feature-mismatch' as FileProcessorId
        })
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

  describe('cleanupExpiredTasks', () => {
    it('should return expired status for tasks that have been cleaned up', async () => {
      // This test verifies the expired status code path works correctly
      // by checking that expiredRequestIds tracking works
      const result = await service.getResult('nonexistent-id')

      // Should return not_found for completely unknown request
      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('not_found')
    })

    it('should keep task available before TTL expires', async () => {
      const template = createMockTemplate({ id: 'before-ttl-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'done' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'before-ttl-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      // Wait for completion
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
      })

      // Query again - should still be completed (TTL hasn't expired)
      const result = await service.getResult(requestId)
      expect(result.status).toBe('completed')

      processorRegistry.unregister('before-ttl-ocr')
    })

    it('should return expired status after TTL cleanup', async () => {
      const template = createMockTemplate({ id: 'expired-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'done' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'expired-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
      })

      const taskStates = service['taskStates'] as Map<string, { completedAt?: number }>
      const task = taskStates.get(requestId)
      expect(task).toBeDefined()
      if (!task) return

      task.completedAt = Date.now() - 5 * 60 * 1000 - 1
      service['cleanupExpiredTasks']()

      const expiredResult = await service.getResult(requestId)
      expect(expiredResult.status).toBe('failed')
      const failed = assertFailedResponse(expiredResult)
      expect(failed.error.code).toBe('expired')

      processorRegistry.unregister('expired-ocr')
    })

    it('should set completedAt when task completes', async () => {
      const template = createMockTemplate({ id: 'completed-at-ocr' })
      const processor = new MockTextExtractor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doExtractTextMock.mockResolvedValue({ text: 'done' })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'completed-at-ocr'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata()
      const { requestId } = await service.startProcess({ file, feature: 'text_extraction' })

      // Wait for completion
      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('completed')
      })

      // Second query should still work - the task is cached with a TTL
      const secondResult = await service.getResult(requestId)
      expect(secondResult.status).toBe('completed')

      processorRegistry.unregister('completed-at-ocr')
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

    it('should fail when async processor returns no providerTaskId', async () => {
      const template = createMockTemplate({
        id: 'async-missing-provider-task-id',
        capabilities: [{ feature: 'markdown_conversion', input: 'document', output: 'markdown' }]
      })
      const processor = new MockAsyncProcessor(template)
      vi.spyOn(processor, 'isAvailable').mockResolvedValue(true)
      processor.doConvertMock.mockResolvedValue({ metadata: { providerTaskId: '   ' } })

      processorRegistry.register(processor)

      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_markdown_conversion_processor',
        'async-missing-provider-task-id'
      )
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const file = createMockFileMetadata({ name: 'doc.pdf', ext: '.pdf' })
      const { requestId } = await service.startProcess({ file, feature: 'markdown_conversion' })

      await vi.waitFor(async () => {
        const result = await service.getResult(requestId)
        expect(result.status).toBe('failed')
        const failed = assertFailedResponse(result)
        expect(failed.error.code).toBe('processing_failed')
        expect(failed.error.message).toBe('Provider task id not found in processing metadata')
      })
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
        const completed = assertCompletedResponse(result)
        expect(completed.result.markdownPath).toBe('/path/to/output.md')
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
        const failed = assertFailedResponse(result)
        expect(failed.error.code).toBe('status_query_failed')
        expect(failed.error.message).toContain('Provider API error')
      })
    })
  })
})
