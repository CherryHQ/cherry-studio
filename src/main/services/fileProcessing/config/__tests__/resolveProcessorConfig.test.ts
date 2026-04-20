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
          markdown_conversion: {
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
          feature: 'markdown_conversion',
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
      'feature.file_processing.default_markdown_conversion': 'open-mineru',
      'feature.file_processing.overrides': {
        paddleocr: {
          capabilities: {
            markdown_conversion: {
              modelId: 'paddle-custom'
            }
          }
        }
      }
    })

    const config = resolveProcessorConfigByFeature('markdown_conversion', 'paddleocr')

    expect(config.id).toBe('paddleocr')
    expect(config.capabilities.find((capability) => capability.feature === 'markdown_conversion')).toEqual(
      expect.objectContaining({
        feature: 'markdown_conversion',
        modelId: 'paddle-custom'
      })
    )
  })

  it('throws when the explicit processor does not support the requested feature', () => {
    expect(() => resolveProcessorConfigByFeature('markdown_conversion', 'tesseract')).toThrowError(
      'File processor tesseract does not support markdown_conversion'
    )
  })

  it('uses the feature default processor when processorId is omitted', () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_text_extraction': 'mistral',
      'feature.file_processing.overrides': {
        mistral: {
          apiKeys: ['mistral-key']
        }
      }
    })

    expect(resolveProcessorConfigByFeature('text_extraction')).toEqual(
      expect.objectContaining({
        id: 'mistral',
        apiKeys: ['mistral-key']
      })
    )
  })

  it('fails fast when no default processor is configured for the requested feature', () => {
    expect(() => resolveProcessorConfigByFeature('text_extraction')).toThrowError(
      'Default file processor for text_extraction is not configured'
    )
  })

  it('fails fast when the migrated default markdown processor is invalid for markdown conversion', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_markdown_conversion', 'mistral')

    expect(() => resolveProcessorConfigByFeature('markdown_conversion')).toThrowError(
      'File processor mistral does not support markdown_conversion'
    )
  })

  it('throws when the configured default processor does not support the requested feature', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_text_extraction', 'open-mineru')

    expect(() => resolveProcessorConfigByFeature('text_extraction')).toThrowError(
      'File processor open-mineru does not support text_extraction'
    )
  })
})
