import { describe, expect, it } from 'vitest'

import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'

import { paintingDoctorModel } from '../paintingGenerateError'

function model(id: string, apiModelId: string, capabilities: Model['capabilities'] = []): Model {
  return {
    apiModelId,
    capabilities,
    id: id as Model['id'],
    isEnabled: true,
    isHidden: false,
    name: apiModelId,
    providerId: 'openai',
    supportsStreaming: true
  }
}

describe('paintingDoctorModel', () => {
  it('uses the local model id when the painting stores a different API id', () => {
    const image = model('openai::local-image', 'gpt-image-1', [MODEL_CAPABILITY.IMAGE_GENERATION])
    const chat = model('openai::gpt-4o', 'gpt-4o-2024-08-06')

    expect(paintingDoctorModel([chat, image], 'gpt-image-1')).toEqual({
      imageOnly: true,
      modelId: 'local-image'
    })
    expect(paintingDoctorModel([chat], 'gpt-4o-2024-08-06')).toEqual({ modelId: 'gpt-4o' })
    expect(paintingDoctorModel([chat], 'not-a-user-model')).toEqual({})
  })
})
