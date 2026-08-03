import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { isSelectableAssistantModel } from '../assistantModelFilter'

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
  it.each([MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK])('rejects %s models', (capability) => {
    expect(isSelectableAssistantModel(createModel({ capabilities: [capability] }))).toBe(false)
  })

  it('rejects dedicated image-generation models', () => {
    expect(isSelectableAssistantModel(createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] }))).toBe(false)
  })

  it('accepts chat-capable models', () => {
    expect(isSelectableAssistantModel(createModel())).toBe(true)
  })

  it('accepts multimodal chat models', () => {
    expect(
      isSelectableAssistantModel(
        createModel({
          capabilities: [
            MODEL_CAPABILITY.FUNCTION_CALL,
            MODEL_CAPABILITY.IMAGE_RECOGNITION,
            MODEL_CAPABILITY.AUDIO_RECOGNITION,
            MODEL_CAPABILITY.VIDEO_RECOGNITION
          ],
          inputModalities: ['text', 'image', 'audio', 'video'],
          outputModalities: ['text', 'audio']
        })
      )
    ).toBe(true)
  })
})
