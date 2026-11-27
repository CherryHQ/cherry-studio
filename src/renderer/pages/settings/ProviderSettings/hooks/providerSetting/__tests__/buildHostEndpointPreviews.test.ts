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
