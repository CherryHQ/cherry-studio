import { describe, expect, it } from 'vitest'

import { MEDIA_PIPELINE_VERSION } from '@shared/types/mediaAnalysis'

import { hashMediaExecutionConfig, type MediaExecutionConfig } from '../mediaExecutionConfig'

function baseConfig(overrides: Partial<MediaExecutionConfig> = {}): MediaExecutionConfig {
  return {
    asr: {
      processor: {
        id: 'openai-transcription',
        type: 'api',
        capabilities: [
          {
            feature: 'audio_to_text',
            inputs: ['audio'],
            output: 'text',
            apiHost: 'https://api.openai.com',
            modelId: 'whisper-1'
          }
        ]
      },
      modelId: 'whisper-1',
      apiHost: 'https://api.openai.com',
      optionsJson: '{}'
    },
    ocr: {
      processor: {
        id: 'tesseract',
        type: 'builtin',
        capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }]
      },
      modelId: '',
      apiHost: '',
      optionsJson: '{"langs":["eng"]}'
    },
    vision: {
      uniqueModelId: 'openai::gpt-4o',
      providerId: 'openai',
      modelId: 'gpt-4o',
      endpointType: 'openai-chat-completions',
      aiSdkProviderId: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      sdkConfig: {
        providerId: 'openai-chat',
        providerSettings: {},
        modelId: 'gpt-4o'
      }
    },
    budget: { maxFrames: 24, targetIntervalMs: 4000, maxEdgePx: 1280, jpegQuality: 75 },
    pipelineVersion: MEDIA_PIPELINE_VERSION,
    ...overrides
  }
}

describe('hashMediaExecutionConfig', () => {
  it('is stable for identical configs', () => {
    expect(hashMediaExecutionConfig(baseConfig())).toBe(hashMediaExecutionConfig(baseConfig()))
  })

  it('changes when ASR model changes', () => {
    const a = hashMediaExecutionConfig(baseConfig())
    const b = hashMediaExecutionConfig(
      baseConfig({
        asr: {
          ...baseConfig().asr!,
          modelId: 'gpt-4o-mini-transcribe'
        }
      })
    )
    expect(a).not.toBe(b)
  })

  it('changes when OCR options change', () => {
    const a = hashMediaExecutionConfig(baseConfig())
    const b = hashMediaExecutionConfig(
      baseConfig({
        ocr: {
          ...baseConfig().ocr!,
          optionsJson: '{"langs":["chi_sim"]}'
        }
      })
    )
    expect(a).not.toBe(b)
  })

  it('changes when vision model or endpoint routing changes', () => {
    const a = hashMediaExecutionConfig(baseConfig())
    const b = hashMediaExecutionConfig(
      baseConfig({
        vision: {
          ...baseConfig().vision!,
          uniqueModelId: 'anthropic::claude-sonnet-4',
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4',
          baseUrl: 'https://api.anthropic.com'
        }
      })
    )
    const c = hashMediaExecutionConfig(
      baseConfig({
        vision: {
          ...baseConfig().vision!,
          endpointType: 'openai-responses',
          aiSdkProviderId: 'openai'
        }
      })
    )
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('changes when frame budget changes', () => {
    const a = hashMediaExecutionConfig(baseConfig())
    const b = hashMediaExecutionConfig(
      baseConfig({
        budget: { maxFrames: 8, targetIntervalMs: 4000, maxEdgePx: 1280, jpegQuality: 75 }
      })
    )
    expect(a).not.toBe(b)
  })

  it('ignores apiKeys on the processor object for identity', () => {
    const withKeys = baseConfig()
    withKeys.asr = {
      ...withKeys.asr!,
      processor: { ...withKeys.asr!.processor, apiKeys: ['sk-secret'] }
    }
    const withoutKeys = baseConfig()
    expect(hashMediaExecutionConfig(withKeys)).toBe(hashMediaExecutionConfig(withoutKeys))
  })
})
