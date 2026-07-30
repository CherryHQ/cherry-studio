import '../core/initialization'

import { describe, expect, it } from 'vitest'

import { extensionRegistry } from '../core/ExtensionRegistry'

describe('openai-compatible audio model support', () => {
  it('exposes OpenAI-compatible transcription and speech model factories', async () => {
    const provider = await extensionRegistry.createProvider('openai-compatible', {
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      name: 'example'
    })

    const transcriptionModel = provider.transcriptionModel?.('mimo-v2.5-asr')
    const speechModel = provider.speechModel?.('mimo-v2.5-tts')

    expect(transcriptionModel).toBeDefined()
    expect(transcriptionModel?.modelId).toBe('mimo-v2.5-asr')
    expect(speechModel).toBeDefined()
    expect(speechModel?.modelId).toBe('mimo-v2.5-tts')
  })
})
