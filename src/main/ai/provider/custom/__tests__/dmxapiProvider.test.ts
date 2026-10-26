import { describe, expect, it } from 'vitest'

import { createDmxapiProvider } from '../dmxapi/dmxapiProvider'
import { captureWithFetch } from './boundary/captureRequest'

describe('DMXAPI execution binding', () => {
  it('rejects chat without a selected client instead of guessing from the model name', () => {
    expect(() =>
      createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://relay.example/v1' }).languageModel('claude-sonnet-4-5')
    ).toThrow('explicit supported endpoint')
  })

  it('uses the selected embedding address without re-routing a Gemini-named model', async () => {
    const request = await captureWithFetch((fetch) =>
      createDmxapiProvider({
        apiKey: 'sk',
        fetch,
        endpointType: 'openai-embeddings',
        baseURL: 'https://embedding.example/v1',
        endpointBaseURLs: { 'openai-chat-completions': 'https://chat.example/v1' }
      })
        .embeddingModel('gemini-embedding-001')
        .doEmbed({ values: ['hello'] })
    )
    expect(request.url).toBe('https://embedding.example/v1/embeddings')
    expect(request.body).toMatchObject({ model: 'gemini-embedding-001', input: ['hello'] })
  })
})
