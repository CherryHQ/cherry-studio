import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')

  return mockApplicationFactory()
})

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { getProcessorConfigById, resolveProcessorConfigByFeature } from '../resolveProcessorConfig'

describe('resolveProcessorConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('getProcessorConfigById merges preference override into preset config', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
      'open-mineru': {
        apiKeys: ['secret-key'],
        capabilities: {
          document_to_markdown: {
            apiHost: 'http://127.0.0.1:9000'
          }
        },
        options: {
          profile: 'local-dev'
        }
      }
    })

    expect(getProcessorConfigById('open-mineru')).toEqual({
      id: 'open-mineru',
      type: 'api',
      capabilities: [
        {
          feature: 'document_to_markdown',
          inputs: ['document'],
          output: 'markdown',
          apiHost: 'http://127.0.0.1:9000'
        }
      ],
      apiKeys: ['secret-key'],
      options: {
        profile: 'local-dev'
      }
    })
  })

  it('getProcessorConfigById throws notFound for an unknown processor id', () => {
    expect(() => getProcessorConfigById('missing' as never)).toThrowError('File processor not found: missing')
  })

  it('uses the explicit processor when one is provided', () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_document_to_markdown': 'open-mineru',
      'feature.file_processing.overrides': {
        paddleocr: {
          capabilities: {
            document_to_markdown: {
              modelId: 'paddle-custom'
            }
          }
        }
      }
    })

    const config = resolveProcessorConfigByFeature('document_to_markdown', 'paddleocr')

    expect(config.id).toBe('paddleocr')
    expect(config.capabilities.find((capability) => capability.feature === 'document_to_markdown')).toEqual(
      expect.objectContaining({
        feature: 'document_to_markdown',
        modelId: 'paddle-custom'
      })
    )
  })

  it('throws when the explicit processor does not support the requested feature', () => {
    expect(() => resolveProcessorConfigByFeature('document_to_markdown', 'tesseract')).toThrowError(
      'File processor tesseract does not support document_to_markdown'
    )
  })

  it('uses the feature default processor when processorId is omitted', () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_image_to_text': 'mistral',
      'feature.file_processing.overrides': {
        mistral: {
          apiKeys: ['mistral-key']
        }
      }
    })

    expect(resolveProcessorConfigByFeature('image_to_text')).toEqual(
      expect.objectContaining({
        id: 'mistral',
        apiKeys: ['mistral-key']
      })
    )
  })

  it('fails fast when no default processor is configured for the requested feature', () => {
    expect(() => resolveProcessorConfigByFeature('image_to_text')).toThrowError(
      'Default file processor for image_to_text is not configured'
    )
  })

  it('fails fast when the migrated default markdown processor is invalid for markdown conversion', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_document_to_markdown', 'mistral')

    expect(() => resolveProcessorConfigByFeature('document_to_markdown')).toThrowError(
      'File processor mistral does not support document_to_markdown'
    )
  })

  it('throws when the configured default processor does not support the requested feature', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', 'open-mineru')

    expect(() => resolveProcessorConfigByFeature('image_to_text')).toThrowError(
      'File processor open-mineru does not support image_to_text'
    )
  })
})
