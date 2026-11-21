import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { buildHostEndpointPreviews } from '../buildHostEndpointPreviews'

const buildAzureParams = (apiVersion?: string): Parameters<typeof buildHostEndpointPreviews>[0] => ({
  provider: {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    authType: 'iam-azure',
    apiKeys: [],
    reportsActualCost: false,
    isEnabled: true,
    settings: apiVersion !== undefined ? { apiVersion } : {}
  },
  authConfig: null,
  primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  apiHost: 'https://example.openai.azure.com/',
  anthropicApiHost: '',
  providerAnthropicHost: ''
})

describe('buildHostEndpointPreviews — Azure apiVersion', () => {
  it.each([
    ['2024-02-01', '2024-02-01'],
    ['  2024-12-01-preview  ', '2024-12-01-preview'],
    ['preview', 'preview'],
    ['v1', 'v1'],
    [undefined, 'v1'],
    ['', 'v1'],
    ['   ', 'v1']
  ])('keeps the chat endpoint for apiVersion %s', (apiVersion, previewVersion) => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams(apiVersion))

    expect(hostPreview).toBe(`https://example.openai.azure.com/v1/chat/completions?apiVersion=${previewVersion}`)
  })

  it.each([
    [undefined, 'v1'],
    ['2024-12-01-preview', '2024-12-01-preview']
  ])('uses the selected Responses endpoint for apiVersion %s', (apiVersion, previewVersion) => {
    const { hostPreview } = buildHostEndpointPreviews({
      ...buildAzureParams(apiVersion),
      primaryEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
    })

    expect(hostPreview).toBe(`https://example.openai.azure.com/v1/responses?apiVersion=${previewVersion}`)
  })
})

const buildCustomParams = (
  apiHost: string,
  pathMode?: 'host' | 'complete'
): Parameters<typeof buildHostEndpointPreviews>[0] => ({
  provider: {
    id: 'custom-1',
    name: 'Custom',
    authType: 'api-key',
    apiKeys: [],
    reportsActualCost: false,
    isEnabled: true,
    settings: {}
  },
  authConfig: null,
  primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  apiHost,
  anthropicApiHost: '',
  providerAnthropicHost: '',
  pathMode
})

describe('buildHostEndpointPreviews — complete path mode (#18972)', () => {
  it('previews the stored URL exactly as entered, with no version or endpoint appended', () => {
    const { hostPreview } = buildHostEndpointPreviews(
      buildCustomParams('https://gateway.example.com/router/answer', 'complete')
    )

    expect(hostPreview).toBe('https://gateway.example.com/router/answer')
  })

  it('drops the trailing # convention marker from the preview in complete mode', () => {
    const { hostPreview } = buildHostEndpointPreviews(
      buildCustomParams('https://gateway.example.com/custom/chat/completions#', 'complete')
    )

    expect(hostPreview).toBe('https://gateway.example.com/custom/chat/completions')
  })

  it.each([
    'https://gateway.example.com/router/answer/',
    'https://gateway.example.com/',
    'https://gateway.example.com/router/%2Fanswer?version=2&mode=literal'
  ])('preserves route details in exact preview %s', (url) => {
    expect(buildHostEndpointPreviews(buildCustomParams(url, 'complete')).hostPreview).toBe(url)
  })

  it('keeps the default construction in host mode', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildCustomParams('https://gateway.example.com/router'))

    expect(hostPreview).toBe('https://gateway.example.com/router/v1/chat/completions')
  })
})

it('keeps the Anthropic connection preview aligned with its independent exact path setting', () => {
  const params = buildAzureParams()
  params.provider = {
    ...params.provider,
    id: 'custom-anthropic',
    endpointConfigs: {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { pathMode: 'complete' }
    }
  }
  params.primaryEndpoint = ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  params.apiHost = params.anthropicApiHost = 'https://gateway.example.com/literal/'
  params.pathMode = 'complete'
  expect(buildHostEndpointPreviews(params).anthropicHostPreview).toBe('https://gateway.example.com/literal/')
  params.pathMode = 'host'
  expect(buildHostEndpointPreviews(params).anthropicHostPreview).toBe('https://gateway.example.com/literal/v1/messages')
})
