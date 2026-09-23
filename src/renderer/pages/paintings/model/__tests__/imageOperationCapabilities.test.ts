import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'

import { canEditPaintingModel, canGeneratePaintingModel } from '../utils/paintingModelOptions'

describe('image operation capabilities', () => {
  it('does not let a legacy edit-only selection disable generation supported by the model', () => {
    const model = {
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
      imageGeneration: { modes: { generate: { supports: {} }, edit: { supports: {} } } }
    } as Model
    expect(canGeneratePaintingModel(model)).toBe(true)
    expect(canEditPaintingModel(model)).toBe(true)
  })
  it('does not advertise unsupported edits just because a custom endpoint was selected', () => {
    const model = {
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
      imageGeneration: { modes: { generate: { supports: {} } } }
    } as Model
    expect(canGeneratePaintingModel(model)).toBe(true)
    expect(canEditPaintingModel(model)).toBe(false)
  })
})
