import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import { describe, expect, it } from 'vitest'

type InspectableModel = { constructor: { name: string }; provider: string }

describe('createCherryIn', () => {
  const provider = createCherryIn({ apiKey: 'sk-test' })

  it('keeps OpenAI-vendor ids on the first-party Responses model', () => {
    for (const id of ['gpt-5', 'o3-mini', 'agent/gpt-5-codex']) {
      const model = provider.languageModel(id) as unknown as InspectableModel

      expect(model.constructor.name).toBe('OpenAIResponsesLanguageModel')
      expect(model.provider).toBe('cherryin.openai')
    }
  })

  it('routes other vendors to the Open Responses model', () => {
    for (const id of ['agent/deepseek-v4-flash', 'qwen3-max']) {
      const model = provider.languageModel(id) as unknown as InspectableModel

      expect(model.constructor.name).toBe('OpenResponsesLanguageModel')
      expect(model.provider).toBe('openai.responses')
    }
  })

  it('applies the vendor split under the openai-response endpoint type too', () => {
    const responsesProvider = createCherryIn({ apiKey: 'sk-test', endpointType: 'openai-response' })

    const openai = responsesProvider.languageModel('gpt-5') as unknown as InspectableModel
    const other = responsesProvider.languageModel('deepseek-chat') as unknown as InspectableModel

    expect(openai.constructor.name).toBe('OpenAIResponsesLanguageModel')
    expect(other.constructor.name).toBe('OpenResponsesLanguageModel')
  })
})
