import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  areModelClassificationsEqual,
  buildModelCapabilities,
  buildModelInputModalities,
  getInitialModelClassification,
  MODEL_ENDPOINT_OPTIONS,
  splitModelIds
} from './helpers'

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    capabilities: [],
    inputModalities: [],
    ...overrides
  } as Model
}

describe('model drawer classification helpers', () => {
  it('normalizes comma-separated model IDs without creating duplicates', () => {
    expect(splitModelIds(' alpha, beta, alpha, ,beta ')).toEqual(['alpha', 'beta'])
  })

  it('offers an endpoint for every editable non-text model consumer', () => {
    expect(MODEL_ENDPOINT_OPTIONS.map((option) => option.id)).toEqual(
      expect.arrayContaining([
        ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
        ENDPOINT_TYPE.OPENAI_EMBEDDINGS,
        ENDPOINT_TYPE.JINA_RERANK
      ])
    )
  })

  it('separates model operations, capabilities, and input modalities', () => {
    const classification = getInitialModelClassification(
      makeModel({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: [MODALITY.IMAGE, MODALITY.AUDIO]
      })
    )

    expect(classification.operationCapabilities).toEqual(new Set([MODEL_CAPABILITY.IMAGE_GENERATION]))
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

  it('preserves multiple editable operations and independent capabilities', () => {
    const classification = getInitialModelClassification(
      makeModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.FUNCTION_CALL] })
    )
    classification.operationCapabilities.add(MODEL_CAPABILITY.RERANK)
    classification.capabilities.add(MODEL_CAPABILITY.REASONING)

    expect(buildModelCapabilities([MODEL_CAPABILITY.EMBEDDING], classification)).toEqual([
      MODEL_CAPABILITY.EMBEDDING,
      MODEL_CAPABILITY.RERANK,
      MODEL_CAPABILITY.FUNCTION_CALL,
      MODEL_CAPABILITY.REASONING
    ])
  })

  it('preserves read-only catalog operations', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION] })
    const classification = getInitialModelClassification(model)

    expect(classification.operationCapabilities).toEqual(new Set([MODEL_CAPABILITY.AUDIO_GENERATION]))
    expect(buildModelCapabilities(model.capabilities, classification)).toEqual([MODEL_CAPABILITY.AUDIO_GENERATION])

    const reset = getInitialModelClassification(model)
    expect(areModelClassificationsEqual(classification, reset)).toBe(true)
  })

  it('adds text without removing a read-only audio operation', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION] })
    const classification = getInitialModelClassification(model)
    classification.operationCapabilities.add(MODEL_CAPABILITY.TEXT_GENERATION)

    const capabilities = buildModelCapabilities(model.capabilities, classification)

    expect(capabilities).toEqual([MODEL_CAPABILITY.AUDIO_GENERATION, MODEL_CAPABILITY.TEXT_GENERATION])
    expect(getInitialModelClassification(makeModel({ capabilities })).operationCapabilities).toEqual(
      new Set([MODEL_CAPABILITY.AUDIO_GENERATION, MODEL_CAPABILITY.TEXT_GENERATION])
    )
  })

  it('does not lose an operation when another operation is removed', () => {
    const model = makeModel({
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.EMBEDDING]
    })
    const classification = getInitialModelClassification(model)
    classification.operationCapabilities.delete(MODEL_CAPABILITY.IMAGE_GENERATION)

    const capabilities = buildModelCapabilities(model.capabilities, classification)

    expect(capabilities).toEqual([MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.EMBEDDING])
  })
})
