import {
  ENDPOINT_TYPE,
  type EndpointType,
  MODALITY,
  type Modality,
  MODEL_CAPABILITY,
  type ModelCapability
} from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  applyModelPurpose,
  getInitialChatEndpointType,
  getModelDrawerMode,
  getProviderChatEndpointTypes,
  inferModelPurpose,
  type ModelPurposeFields
} from '../modelPurpose'

describe('getModelDrawerMode', () => {
  it.each([
    [{ id: 'custom-provider', presetProviderId: undefined }, 'purpose'],
    [{ id: 'new-api', presetProviderId: 'new-api' }, 'purpose'],
    [{ id: 'custom-new-api', presetProviderId: 'new-api' }, 'purpose'],
    [{ id: 'cherryin', presetProviderId: 'cherryin' }, 'endpoint-types'],
    [{ id: 'custom-cherryin', presetProviderId: 'cherryin' }, 'endpoint-types'],
    [{ id: 'aionly', presetProviderId: 'aionly' }, 'endpoint-types'],
    [{ id: 'openai', presetProviderId: undefined }, 'legacy'],
    [{ id: 'openai', presetProviderId: 'openai' }, 'legacy'],
    [{ id: 'custom-anthropic', presetProviderId: 'anthropic' }, 'legacy']
  ] as const)('returns %s for %o', (provider, expected) => {
    expect(getModelDrawerMode(provider)).toBe(expected)
  })
})

describe('getProviderChatEndpointTypes', () => {
  it('returns a single configured text endpoint', () => {
    expect(
      getProviderChatEndpointTypes({
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://example.com' }
        }
      })
    ).toEqual([ENDPOINT_TYPE.ANTHROPIC_MESSAGES])
  })

  it('puts the default endpoint first and preserves the remaining configuration order', () => {
    expect(
      getProviderChatEndpointTypes({
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {},
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {},
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: {},
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {}
        }
      })
    ).toEqual([
      ENDPOINT_TYPE.OPENAI_RESPONSES,
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    ])
  })

  it('excludes image endpoints', () => {
    expect(
      getProviderChatEndpointTypes({
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: {},
          [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: {},
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {}
        }
      })
    ).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
  })
})

describe('model purpose mapping', () => {
  it('infers purpose from the primary endpoint without rewriting a New API multi-endpoint value', () => {
    const endpointTypes: EndpointType[] = [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
    const fields: ModelPurposeFields = {
      endpointTypes,
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION]
    }

    expect(inferModelPurpose(fields)).toBe('chat')
    expect(getInitialChatEndpointType(fields)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(fields.endpointTypes).toBe(endpointTypes)
    expect(fields.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION])
  })

  it.each([
    [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'image-generation'],
    [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, 'image-edit']
  ] as const)('infers %s as %s', (endpointType, purpose) => {
    expect(inferModelPurpose({ endpointTypes: [endpointType] })).toBe(purpose)
  })

  it('infers image generation from capability when no endpoint is available', () => {
    expect(inferModelPurpose({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] })).toBe('image-generation')
  })

  it('atomically maps image generation while preserving unrelated fields', () => {
    const result = applyModelPurpose(
      {
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
        capabilities: [MODEL_CAPABILITY.REASONING],
        inputModalities: [MODALITY.TEXT],
        outputModalities: [MODALITY.TEXT]
      },
      'image-generation'
    )

    expect(result).toEqual({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_GENERATION],
      inputModalities: [MODALITY.TEXT],
      outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
    })
  })

  it('atomically maps image editing with image input and output', () => {
    const result = applyModelPurpose(
      {
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: [MODALITY.TEXT],
        outputModalities: [MODALITY.TEXT]
      },
      'image-edit'
    )

    expect(result).toEqual({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.IMAGE_GENERATION],
      inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
      outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
    })
  })

  it('removes generation-owned image fields when switching back to chat', () => {
    const result = applyModelPurpose(
      {
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
        capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_GENERATION],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
        outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      },
      'chat',
      {
        chatEndpointType: ENDPOINT_TYPE.OPENAI_RESPONSES,
        previousPurpose: 'image-generation'
      }
    )

    expect(result).toEqual({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
      capabilities: [MODEL_CAPABILITY.REASONING],
      inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
      outputModalities: [MODALITY.TEXT]
    })
  })

  it('removes edit-owned image input unless image recognition still needs it', () => {
    const base = {
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
      outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
    } satisfies ModelPurposeFields

    expect(
      applyModelPurpose(
        {
          ...base,
          capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
          inputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
        },
        'chat',
        { previousPurpose: 'image-edit' }
      )
    ).toEqual({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      capabilities: [],
      inputModalities: [MODALITY.TEXT],
      outputModalities: [MODALITY.TEXT]
    })

    expect(
      applyModelPurpose(
        {
          ...base,
          capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.IMAGE_GENERATION],
          inputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
        },
        'chat',
        { previousPurpose: 'image-edit' }
      )
    ).toEqual({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
      inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
      outputModalities: [MODALITY.TEXT]
    })
  })

  it('deduplicates mapping-owned values when changing between image purposes', () => {
    const capabilities: ModelCapability[] = [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_GENERATION]
    const inputModalities: Modality[] = [MODALITY.TEXT]
    const outputModalities: Modality[] = [MODALITY.TEXT, MODALITY.IMAGE]

    const result = applyModelPurpose(
      {
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
        capabilities,
        inputModalities,
        outputModalities
      },
      'image-edit',
      { previousPurpose: 'image-generation' }
    )

    expect(result).toEqual({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_GENERATION],
      inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
      outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
    })
  })

  it('rewrites a multi-endpoint value only after an explicit chat protocol selection', () => {
    const result = applyModelPurpose(
      {
        endpointTypes: [
          ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
          ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION
        ],
        capabilities: [MODEL_CAPABILITY.REASONING],
        inputModalities: [MODALITY.TEXT],
        outputModalities: [MODALITY.TEXT]
      },
      'chat',
      { chatEndpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES }
    )

    expect(result).toEqual({
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
      capabilities: [MODEL_CAPABILITY.REASONING],
      inputModalities: [MODALITY.TEXT],
      outputModalities: [MODALITY.TEXT]
    })
  })
})
