import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'
import { getNewApiSpeechEndpoint, getSpeechGenerationEndpoint } from '../registry-utils'

const registry = createRegistry(bundledCatalog)

describe('finite speech generation routing', () => {
  it('accepts an explicit speech endpoint without requiring a duplicate capability label', () => {
    expect(getSpeechGenerationEndpoint({ endpointTypes: ['openai-text-to-speech'] })).toBe('openai-text-to-speech')
  })

  it('distinguishes text-to-audio generation from Gemini multimodal Live and chat models', () => {
    expect(
      getSpeechGenerationEndpoint({
        endpointTypes: ['google-generate-content'],
        inputModalities: ['text'],
        outputModalities: ['audio']
      })
    ).toBe('google-generate-content')
    for (const modalities of [
      { inputModalities: ['text', 'audio'] as const, outputModalities: ['audio'] as const },
      { inputModalities: ['text'] as const, outputModalities: ['text'] as const }
    ]) {
      expect(
        getSpeechGenerationEndpoint({
          endpointTypes: ['google-generate-content'],
          inputModalities: [...modalities.inputModalities],
          outputModalities: [...modalities.outputModalities]
        })
      ).toBeUndefined()
    }
    expect(
      getSpeechGenerationEndpoint({
        endpointTypes: ['openai-responses'],
        inputModalities: ['text'],
        outputModalities: ['audio']
      })
    ).toBeUndefined()
  })

  it.each(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15'])(
    'routes catalog model %s to audio/speech instead of the provider chat default',
    (id) => {
      const model = registry.findModel(id)
      expect(model?.ownedBy).toBe('openai')
      expect(getSpeechGenerationEndpoint(model!)).toBe('openai-text-to-speech')
      expect(registry.findOverride('openai', id)?.endpointTypes).toContain('openai-text-to-speech')
    }
  )

  it.each(['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts', 'gemini-3.1-flash-tts-preview'])(
    'routes catalog model %s through generateContent',
    (id) => {
      const model = registry.findModel(id)
      expect(model).not.toBeNull()
      expect(getSpeechGenerationEndpoint(model!)).toBe('google-generate-content')
      expect(registry.findOverride('gemini', id)).toMatchObject({
        apiModelId: id,
        endpointTypes: ['google-generate-content']
      })
    }
  )
})

describe('New API speech routing', () => {
  it('recovers the OpenAI speech dialect from the catalog when the relay only advertises openai', () => {
    expect(
      getNewApiSpeechEndpoint({ endpointTypes: ['openai-chat-completions'] }, registry.findModel('gpt-4o-mini-tts'))
    ).toBe('openai-text-to-speech')
    expect(
      getNewApiSpeechEndpoint(
        {
          endpointTypes: ['openai-chat-completions', 'google-generate-content'],
          inputModalities: ['text'],
          outputModalities: ['audio']
        },
        registry.findModel('gpt-4o-mini-tts')
      )
    ).toBe('openai-text-to-speech')
    expect(
      getNewApiSpeechEndpoint({ endpointTypes: ['openai-chat-completions'] }, registry.findModel('gpt-4o'))
    ).toBeUndefined()
    expect(getNewApiSpeechEndpoint({ endpointTypes: ['openai-chat-completions'] }, null)).toBeUndefined()
    expect(
      getNewApiSpeechEndpoint({ endpointTypes: ['openai-responses'] }, registry.findModel('gpt-4o-mini-tts'))
    ).toBeUndefined()
  })
})
