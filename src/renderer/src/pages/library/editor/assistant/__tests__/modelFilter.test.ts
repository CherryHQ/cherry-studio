import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { isSelectableAssistantModel } from '../modelFilter'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('isSelectableAssistantModel', () => {
  it('rejects embedding models', () => {
    expect(isSelectableAssistantModel(createModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING] }))).toBe(false)
  })

  it('rejects rerank models', () => {
    expect(isSelectableAssistantModel(createModel({ capabilities: [MODEL_CAPABILITY.RERANK] }))).toBe(false)
  })

  it('accepts chat-capable models', () => {
    expect(isSelectableAssistantModel(createModel())).toBe(true)
  })
})
