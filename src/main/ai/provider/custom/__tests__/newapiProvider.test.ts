import { describe, expect, it } from 'vitest'

import { createNewApi } from '../newapiProvider'

type InspectableModel = { constructor: { name: string }; provider: string }

describe('createNewApi', () => {
  const provider = createNewApi({
    apiKey: 'sk-test',
    baseURL: 'https://example.com/v1',
    endpointType: 'openai-response'
  })

  it('keeps OpenAI-vendor ids on the first-party Responses model', () => {
    for (const id of ['gpt-5', 'o3-mini', 'agent/gpt-5-codex']) {
      const model = provider.languageModel(id) as unknown as InspectableModel

      expect(model.constructor.name).toBe('OpenAIResponsesLanguageModel')
      expect(model.provider).toBe('newapi.openai-response')
    }
  })

  it('routes other vendors on the Responses endpoint to the Open Responses model', () => {
    for (const id of ['deepseek-chat', 'agent/deepseek-v4-flash']) {
      const model = provider.languageModel(id) as unknown as InspectableModel

      expect(model.constructor.name).toBe('OpenResponsesLanguageModel')
      expect(model.provider).toBe('openai.responses')
    }
  })
})
