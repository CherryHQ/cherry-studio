import { ENDPOINT_TYPE, MODEL_CAPABILITY, ModelSchema } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider::model',
    providerId: 'provider',
    apiModelId: 'model',
    name: 'Model',
    capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

describe('ModelSchema endpoint operation contract', () => {
  it('requires at least one operation capability', () => {
    expect(ModelSchema.safeParse(model({ capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })).success).toBe(false)
  })

  it('accepts a multi-operation model with specialized endpoints', () => {
    expect(
      ModelSchema.safeParse(
        model({
          capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
          preferredEndpointType: ENDPOINT_TYPE.OPENAI_EMBEDDINGS
        })
      ).success
    ).toBe(true)
  })

  it('rejects an endpoint incompatible with every model operation', () => {
    expect(
      ModelSchema.safeParse(
        model({
          capabilities: [MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
        })
      ).success
    ).toBe(false)
  })
})
