import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  resolveEndpointTypeOptions,
  resolveInheritedOperationCapability,
  resolvePreferredEndpointOptions
} from '../modelEndpointRouting'

const provider = {
  id: 'custom',
  defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  endpointConfigs: {
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://example.com' },
    [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { baseUrl: 'https://example.com' },
    [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://example.com' }
  }
} as const

describe('model endpoint routing controls', () => {
  it('derives the same options regardless of provider identity or preset provenance', () => {
    const operationCapabilities = new Set([MODEL_CAPABILITY.TEXT_GENERATION])
    const providers = [
      provider,
      { ...provider, id: 'openai', presetProviderId: 'openai' },
      { ...provider, id: 'custom-openai', presetProviderId: 'openai' }
    ]

    expect(providers.map((candidate) => resolveEndpointTypeOptions(candidate, operationCapabilities))).toEqual([
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    ])
  })

  it('offers only provider endpoints compatible with the selected operations', () => {
    expect(
      resolveEndpointTypeOptions(
        provider,
        new Set([MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION])
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION])
  })

  it('removes incompatible declarations from preference options', () => {
    expect(
      resolvePreferredEndpointOptions(
        provider,
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
        new Set([MODEL_CAPABILITY.EMBEDDING])
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_EMBEDDINGS])
  })

  it('selects an operation compatible with the first declared endpoint', () => {
    expect(
      resolveInheritedOperationCapability(
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
        new Set([MODEL_CAPABILITY.VIDEO_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION])
      )
    ).toBe(MODEL_CAPABILITY.IMAGE_GENERATION)
  })
})
