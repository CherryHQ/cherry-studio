import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  return MockMainPreferenceServiceExport
})

import { FileProcessorMergedSchema, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { fileProcessingService } from '../FileProcessingService'

describe('FileProcessingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  describe('getProcessors', () => {
    it('should return all processors with merged overrides', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        paddleocr: {
          apiKeys: ['test-key'],
          options: {
            concurrency: 2
          },
          capabilities: {
            markdown_conversion: {
              modelId: 'custom-model'
            }
          }
        }
      })

      const processors = await fileProcessingService.getProcessors()
      const processor = processors.find((item) => item.id === 'paddleocr')

      expect(processors).toHaveLength(PRESETS_FILE_PROCESSORS.length)
      expect(processor).toMatchObject({
        id: 'paddleocr',
        apiKeys: ['test-key'],
        options: {
          concurrency: 2
        }
      })
      expect(processor?.capabilities).toContainEqual(
        expect.objectContaining({
          feature: 'markdown_conversion',
          modelId: 'custom-model'
        })
      )
    })
  })

  describe('getProcessorById', () => {
    it('should throw when processor does not exist', async () => {
      await expect(fileProcessingService.getProcessorById('missing-processor' as never)).rejects.toThrow(
        "File processor with id 'missing-processor' not found"
      )
    })
  })

  describe('updateProcessor', () => {
    it('should merge processor overrides and preserve existing feature-specific capability fields', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        paddleocr: {
          capabilities: {
            markdown_conversion: {
              apiHost: 'https://old.example.com'
            }
          },
          options: {
            existing: true
          }
        }
      })

      const updated = await fileProcessingService.updateProcessor('paddleocr', {
        capabilities: {
          markdown_conversion: {
            modelId: 'new-model'
          }
        },
        options: {
          timeout: 30000
        }
      })

      expect(updated.capabilities).toContainEqual(
        expect.objectContaining({
          feature: 'markdown_conversion',
          apiHost: 'https://old.example.com',
          modelId: 'new-model'
        })
      )
      expect(updated.options).toMatchObject({
        existing: true,
        timeout: 30000
      })

      expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.overrides')).toMatchObject({
        paddleocr: {
          capabilities: {
            markdown_conversion: {
              apiHost: 'https://old.example.com',
              modelId: 'new-model'
            }
          },
          options: {
            existing: true,
            timeout: 30000
          }
        }
      })
    })

    it('should not persist overrides when processor does not exist', async () => {
      const existingOverrides = {
        paddleocr: {
          apiKeys: ['existing-key'],
          capabilities: {
            markdown_conversion: {
              modelId: 'existing-model'
            }
          }
        }
      }

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', existingOverrides)

      await expect(
        fileProcessingService.updateProcessor('missing-processor' as never, {
          apiKeys: ['invalid-key']
        })
      ).rejects.toThrow("File processor with id 'missing-processor' not found")

      expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.overrides')).toEqual(
        existingOverrides
      )
    })

    it('should not persist empty options when updates do not include options', async () => {
      await fileProcessingService.updateProcessor('paddleocr', {
        apiKeys: ['new-key']
      })

      const storedOverrides = MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.overrides')

      expect(storedOverrides.paddleocr).toMatchObject({
        apiKeys: ['new-key']
      })
      expect(storedOverrides.paddleocr).not.toHaveProperty('options')
    })

    it('should ignore unknown capability override fields in merged configs', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        paddleocr: {
          capabilities: {
            text_extraction: {
              apiHost: 'https://override.example.com',
              futureField: true
            }
          }
        }
      } as never)

      const processor = await fileProcessingService.getProcessorById('paddleocr')
      const textExtraction = processor.capabilities.find((capability) => capability.feature === 'text_extraction')

      expect(textExtraction).toMatchObject({
        feature: 'text_extraction',
        apiHost: 'https://override.example.com'
      })
      expect(textExtraction).not.toHaveProperty('futureField')
      expect(FileProcessorMergedSchema.safeParse(processor).success).toBe(true)
    })
  })
})
