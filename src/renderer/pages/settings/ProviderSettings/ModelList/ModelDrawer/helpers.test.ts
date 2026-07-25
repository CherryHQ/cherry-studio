import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  areModelClassificationsEqual,
  buildModelCapabilities,
  buildModelInputModalities,
  getInitialModelClassification,
  MODEL_ENDPOINT_OPTIONS
} from './helpers'

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    capabilities: [],
    inputModalities: [],
    ...overrides
  } as Model
}

describe('model drawer classification helpers', () => {
  it('offers an endpoint for every editable non-text model consumer', () => {
    expect(MODEL_ENDPOINT_OPTIONS.map((option) => option.id)).toEqual(
      expect.arrayContaining([
        ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
        ENDPOINT_TYPE.OPENAI_EMBEDDINGS,
        ENDPOINT_TYPE.JINA_RERANK
      ])
    )
  })

  it('separates model type, capabilities, and input modalities', () => {
    const classification = getInitialModelClassification(
      makeModel({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: [MODALITY.IMAGE, MODALITY.AUDIO]
      })
    )

    expect(classification.primaryType).toBe('image')
    expect(classification.capabilities).toEqual(new Set([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL]))
    expect(classification.inputModalities).toEqual(new Set([MODALITY.IMAGE, MODALITY.AUDIO]))
  })

  it('normalizes legacy recognition capabilities to input modalities while preserving unknown capabilities', () => {
    const model = makeModel({
      capabilities: [
        MODEL_CAPABILITY.IMAGE_RECOGNITION,
        MODEL_CAPABILITY.AUDIO_RECOGNITION,
        MODEL_CAPABILITY.STRUCTURED_OUTPUT
      ],
      inputModalities: [MODALITY.TEXT]
    })
    const classification = getInitialModelClassification(model)

    expect(buildModelCapabilities(model.capabilities, classification)).toEqual([MODEL_CAPABILITY.STRUCTURED_OUTPUT])
    expect(buildModelInputModalities(model.inputModalities ?? [], classification)).toEqual([
      MODALITY.TEXT,
      MODALITY.IMAGE,
      MODALITY.AUDIO
    ])
  })

  it('switches between editable model types without disabling independent capabilities', () => {
    const classification = getInitialModelClassification(
      makeModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.WEB_SEARCH] })
    )
    classification.primaryType = 'rerank'
    classification.capabilities.add(MODEL_CAPABILITY.REASONING)

    expect(buildModelCapabilities([MODEL_CAPABILITY.EMBEDDING], classification)).toEqual([
      MODEL_CAPABILITY.RERANK,
      MODEL_CAPABILITY.WEB_SEARCH,
      MODEL_CAPABILITY.REASONING
    ])
  })

  it('preserves unsupported catalog model types until the user explicitly chooses a supported type', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION] })
    const classification = getInitialModelClassification(model)

    expect(classification.primaryType).toBeNull()
    expect(buildModelCapabilities(model.capabilities, classification)).toEqual([MODEL_CAPABILITY.AUDIO_GENERATION])

    const reset = getInitialModelClassification(model)
    expect(areModelClassificationsEqual(classification, reset)).toBe(true)
  })

  it('replaces an unsupported audio model type with text after round-trip', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION] })
    const classification = getInitialModelClassification(model)
    classification.primaryType = 'text'

    const capabilities = buildModelCapabilities(model.capabilities, classification)

    expect(capabilities).toEqual([])
    expect(getInitialModelClassification(makeModel({ capabilities })).primaryType).toBe('text')
  })

  it('replaces an unsupported audio model type with image after round-trip', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION] })
    const classification = getInitialModelClassification(model)
    classification.primaryType = 'image'

    const capabilities = buildModelCapabilities(model.capabilities, classification)

    expect(capabilities).toEqual([MODEL_CAPABILITY.IMAGE_GENERATION])
    expect(getInitialModelClassification(makeModel({ capabilities })).primaryType).toBe('image')
  })
})
