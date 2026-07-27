import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../providers'

describe('Modelsell provider', () => {
  it('uses the canonical OpenAI-compatible endpoint and public setup links', () => {
    const provider = PROVIDERS.find(({ id }) => id === 'modelsell')

    expect(provider).toEqual({
      id: 'modelsell',
      name: 'Modelsell',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': {
          adapterFamily: 'openai-compatible',
          baseUrl: 'https://modelsell.com/v1',
          reasoningFormat: { type: 'openai-chat' }
        }
      },
      metadata: {
        website: {
          apiKey: 'https://modelsell.com/console/token',
          docs: 'https://modelsell.com/docs/api-reference',
          models: 'https://modelsell.com/v1/models',
          official: 'https://modelsell.com'
        }
      }
    })
  })
})
