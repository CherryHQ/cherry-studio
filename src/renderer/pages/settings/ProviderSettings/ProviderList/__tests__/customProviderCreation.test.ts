import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  buildCustomProviderCreationPayload,
  buildCustomProviderEndpointPreview,
  type CustomProviderCompatibility,
  type CustomProviderTextEndpoint,
  findInvalidCustomProviderCreationUrl
} from '../customProviderCreation'

describe('custom provider creation', () => {
  it.each<{
    compatibility: CustomProviderCompatibility
    expectedEndpoint: CustomProviderTextEndpoint
  }>([
    {
      compatibility: { type: 'new-api' },
      expectedEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    },
    {
      compatibility: { type: 'openai', endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS },
      expectedEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    },
    {
      compatibility: { type: 'anthropic' },
      expectedEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    },
    {
      compatibility: { type: 'gemini' },
      expectedEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    },
    {
      compatibility: { type: 'custom', endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES },
      expectedEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
    }
  ])('maps $compatibility.type to its primary text endpoint', ({ compatibility, expectedEndpoint }) => {
    const payload = buildCustomProviderCreationPayload({
      compatibility,
      baseUrl: ' https://api.example.com '
    })

    expect(payload.defaultChatEndpoint).toBe(expectedEndpoint)
    expect(payload.endpointConfigs[expectedEndpoint]).toEqual({ baseUrl: 'https://api.example.com' })
  })

  it('uses only the selected OpenAI protocol unless another URL is explicitly provided', () => {
    const responsesOnly = buildCustomProviderCreationPayload({
      compatibility: { type: 'openai', endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES },
      baseUrl: 'https://api.example.com'
    })

    expect(responsesOnly.endpointConfigs).toEqual({
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.example.com' }
    })

    const withChatOverride = buildCustomProviderCreationPayload({
      compatibility: { type: 'openai', endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES },
      baseUrl: 'https://api.example.com',
      extraTextEndpointUrls: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: ' https://chat.example.com '
      }
    })

    expect(withChatOverride.endpointConfigs).toEqual({
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.example.com' },
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://chat.example.com' }
    })
  })

  it('uses the New API preset and configures all four canonical text endpoints', () => {
    const payload = buildCustomProviderCreationPayload({
      compatibility: { type: 'new-api' },
      baseUrl: 'https://new-api.example.com'
    })

    expect(payload).toEqual({
      presetProviderId: 'new-api',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-api.example.com' },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://new-api.example.com' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://new-api.example.com' },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://new-api.example.com' }
      }
    })
  })

  it.each<CustomProviderCompatibility>([
    { type: 'openai', endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS },
    { type: 'anthropic' },
    { type: 'gemini' },
    { type: 'custom', endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES }
  ])('does not assign an official preset to $type compatibility', (compatibility) => {
    const payload = buildCustomProviderCreationPayload({
      compatibility,
      baseUrl: 'https://api.example.com'
    })

    expect(payload).not.toHaveProperty('presetProviderId')
  })

  it('lets an extra text URL override a secondary New API endpoint without replacing the primary URL', () => {
    const payload = buildCustomProviderCreationPayload({
      compatibility: { type: 'new-api' },
      baseUrl: 'https://new-api.example.com',
      extraTextEndpointUrls: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://ignored-primary.example.com',
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'https://anthropic.example.com'
      }
    })

    expect(payload.endpointConfigs[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toEqual({
      baseUrl: 'https://new-api.example.com'
    })
    expect(payload.endpointConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toEqual({
      baseUrl: 'https://anthropic.example.com'
    })
  })

  it('merges image endpoint drafts into the text endpoint topology', () => {
    const payload = buildCustomProviderCreationPayload({
      compatibility: { type: 'anthropic' },
      baseUrl: 'https://api.example.com',
      imageEndpointDraft: {
        imagesBaseUrl: ' https://images.example.com ',
        useSeparateImageEditUrl: true,
        imageEditBaseUrl: ' https://edits.example.com '
      }
    })

    expect(payload.endpointConfigs).toEqual({
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://images.example.com' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://edits.example.com' }
    })
  })

  it.each([
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'https://api.example.com/v1/chat/completions'],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, 'https://api.example.com/v1/responses'],
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'https://api.example.com/v1/messages'],
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'https://api.example.com/v1beta/models/{model}:generateContent']
  ] as const)('builds the %s request path preview', (endpointType, expectedPreview) => {
    expect(buildCustomProviderEndpointPreview('https://api.example.com/', endpointType)).toBe(expectedPreview)
  })

  it('preserves an explicit API version in the request path preview', () => {
    expect(
      buildCustomProviderEndpointPreview(' https://api.example.com/custom/v2/ ', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    ).toBe('https://api.example.com/custom/v2/chat/completions')
  })

  it('rejects missing or malformed primary URLs and suppresses their previews', () => {
    const input = {
      compatibility: { type: 'anthropic' } as const,
      baseUrl: 'ftp://api.example.com'
    }

    expect(findInvalidCustomProviderCreationUrl(input)).toEqual({ field: 'baseUrl' })
    expect(buildCustomProviderEndpointPreview(input.baseUrl, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('')
    expect(findInvalidCustomProviderCreationUrl({ ...input, baseUrl: '  ' })).toEqual({ field: 'baseUrl' })
  })

  it('identifies invalid secondary text and image URLs', () => {
    const baseInput = {
      compatibility: {
        type: 'openai',
        endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      } as const,
      baseUrl: 'https://api.example.com'
    }

    expect(
      findInvalidCustomProviderCreationUrl({
        ...baseInput,
        extraTextEndpointUrls: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'not-a-url'
        }
      })
    ).toEqual({
      field: 'extraTextEndpointUrl',
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    })

    expect(
      findInvalidCustomProviderCreationUrl({
        ...baseInput,
        imageEndpointDraft: {
          imagesBaseUrl: 'ftp://images.example.com',
          useSeparateImageEditUrl: false,
          imageEditBaseUrl: ''
        }
      })
    ).toEqual({ field: 'imagesBaseUrl' })
  })

  it('accepts valid optional URLs and ignores an unused primary override', () => {
    expect(
      findInvalidCustomProviderCreationUrl({
        compatibility: {
          type: 'openai',
          endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        baseUrl: 'https://api.example.com',
        extraTextEndpointUrls: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'not-used',
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'https://responses.example.com'
        },
        imageEndpointDraft: {
          imagesBaseUrl: 'https://images.example.com',
          useSeparateImageEditUrl: true,
          imageEditBaseUrl: 'https://edits.example.com'
        }
      })
    ).toBeNull()
  })
})
