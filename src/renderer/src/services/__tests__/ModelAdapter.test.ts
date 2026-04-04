import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway'
import { normalizeGatewayModels } from '@renderer/services/models/ModelAdapter'
import type { Provider } from '@renderer/types'
import { describe, expect, it } from 'vitest'

const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  apiKey: 'test-key',
  apiHost: 'https://example.com/v1',
  models: [],
  ...overrides
})

describe('ModelAdapter', () => {
  it('adapts ai-gateway entries through the same adapter', () => {
    const provider = createProvider({ id: 'ai-gateway', type: 'gateway' })
    const [model] = normalizeGatewayModels(provider, [
      {
        id: 'openai/gpt-4o',
        name: 'OpenAI GPT-4o',
        description: 'Gateway entry',
        specification: {
          specificationVersion: 'v3',
          provider: 'openai',
          modelId: 'gpt-4o'
        }
      } as GatewayLanguageModelEntry
    ])

    expect(model).toMatchObject({
      id: 'openai/gpt-4o',
      group: 'openai',
      provider: 'ai-gateway',
      description: 'Gateway entry'
    })
  })
})
