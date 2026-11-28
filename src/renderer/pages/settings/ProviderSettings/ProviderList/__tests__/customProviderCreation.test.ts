import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import {
  buildCustomProviderCreationPayload,
  buildCustomProviderEndpointPreview,
  findInvalidCustomProviderCreationUrl,
  findInvalidCustomProviderEndpointUrl,
  getCustomProviderDefaultChatEndpoint
} from '../customProviderCreation'

describe('custom provider creation', () => {
  it.each([
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    ENDPOINT_TYPE.OPENAI_RESPONSES,
    ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
  ] as const)('uses a single configured %s endpoint as the default', (endpointType) => {
    const payload = buildCustomProviderCreationPayload({
      endpointUrls: {
        [endpointType]: ' https://api.example.com '
      }
    })

    expect(payload).toEqual({
      defaultChatEndpoint: endpointType,
      endpointConfigs: {
        [endpointType]: { baseUrl: 'https://api.example.com' }
      }
    })
  })

  it('keeps endpoint URLs independent and respects the preferred chat endpoint', () => {
    const payload = buildCustomProviderCreationPayload({
      endpointUrls: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://chat.example.com',
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'https://responses.example.com',
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'https://anthropic.example.com',
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'https://gemini.example.com'
      },
      preferredChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    })

    expect(payload.defaultChatEndpoint).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    expect(payload.endpointConfigs).toEqual({
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://chat.example.com' },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://responses.example.com' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com' },
      [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://gemini.example.com' }
    })
    expect(payload).not.toHaveProperty('presetProviderId')
  })

  it('falls back to the first configured canonical text endpoint when the preferred endpoint is empty', () => {
    const endpointUrls = {
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'https://responses.example.com',
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'https://anthropic.example.com'
    }

    expect(getCustomProviderDefaultChatEndpoint(endpointUrls, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe(
      ENDPOINT_TYPE.OPENAI_RESPONSES
    )
  })

  it('includes independent image generation and editing URLs', () => {
    const payload = buildCustomProviderCreationPayload({
      endpointUrls: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'https://api.example.com',
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: ' https://images.example.com ',
        [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: ' https://edits.example.com '
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
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'https://api.example.com/v1/models/{model}:generateContent'],
    [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'https://api.example.com/v1/images/generations'],
    [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, 'https://api.example.com/v1/images/edits']
  ] as const)('builds the %s request path preview', (endpointType, expectedPreview) => {
    expect(buildCustomProviderEndpointPreview('https://api.example.com/v1/', endpointType)).toBe(expectedPreview)
  })

  it('preserves an explicit API version in the request path preview', () => {
    expect(
      buildCustomProviderEndpointPreview(' https://api.example.com/custom/v2/ ', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    ).toBe('https://api.example.com/custom/v2/chat/completions')
  })

  it.each([
    [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti'],
    [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti#'],
    [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'https://api.example.com/v1/images/generations'],
    [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, 'https://api.example.com/v1/images/edits#']
  ] as const)('previews %s full image request URL as-is: %s (#18572)', (endpointType, baseUrl) => {
    const expected = baseUrl.replace(/#$/, '').replace(/\/+$/, '')
    expect(buildCustomProviderEndpointPreview(baseUrl, endpointType)).toBe(expected)
  })

  it.each([
    [
      ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
      'https://api.example.com/v1/images/generations?tenant=x',
      'https://api.example.com/v1/images/generations?tenant=x'
    ],
    [
      ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
      'https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti?prefix=tenant/',
      'https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti?prefix=tenant/'
    ]
  ] as const)('previews %s full image request URL with query as-is: %s (#25653)', (endpointType, baseUrl, expected) => {
    expect(buildCustomProviderEndpointPreview(baseUrl, endpointType)).toBe(expected)
  })

  it.each([
    'https://relay.example/v2.1/openai/v1',
    'https://relay.example/v2.1/openai#',
    'https://api.example.com/api/v1/services/aigc/multimodal-generation/generation#'
  ])('keeps gateway-style %s on legacy base preview instead of direct routing (#25653)', (baseUrl) => {
    const preview = buildCustomProviderEndpointPreview(baseUrl, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION)
    expect(preview).toContain('/images/generations')
    expect(preview).not.toBe(baseUrl.replace(/#$/, ''))
  })

  it('requires at least one text endpoint even when an image endpoint is configured', () => {
    expect(
      findInvalidCustomProviderCreationUrl({
        endpointUrls: {
          [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: 'https://images.example.com'
        }
      })
    ).toEqual({ field: 'textEndpointRequired' })
  })

  it('identifies the invalid endpoint URL and suppresses its preview', () => {
    const input = {
      endpointUrls: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com',
        [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: 'ftp://edits.example.com'
      }
    }

    expect(findInvalidCustomProviderCreationUrl(input)).toEqual({
      field: 'endpointUrl',
      endpointType: ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
    })
    expect(
      buildCustomProviderEndpointPreview(
        input.endpointUrls[ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
        ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
      )
    ).toBe('')
  })

  it('allows empty endpoint URLs while validating every configured endpoint', () => {
    expect(findInvalidCustomProviderEndpointUrl({})).toBeNull()
    expect(
      findInvalidCustomProviderEndpointUrl({
        [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: 'not-a-url'
      })
    ).toEqual({
      field: 'endpointUrl',
      endpointType: ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
    })
  })

  it('accepts valid optional endpoint URLs', () => {
    expect(
      findInvalidCustomProviderCreationUrl({
        endpointUrls: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'https://api.example.com',
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'https://anthropic.example.com',
          [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: 'https://images.example.com'
        }
      })
    ).toBeNull()
  })
})
