import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  getModelDrawerMode,
  resolveEndpointTypeOptions,
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
  it('uses explicit endpoint selection for custom providers', () => {
    expect(getModelDrawerMode(provider)).toBe('endpoint-types')
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
        'endpoint-types',
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
        new Set([MODEL_CAPABILITY.EMBEDDING])
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_EMBEDDINGS])
  })
})
