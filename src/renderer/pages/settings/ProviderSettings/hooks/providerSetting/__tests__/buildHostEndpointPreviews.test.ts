import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildHostEndpointPreviews } from '../buildHostEndpointPreviews'

vi.mock('@renderer/utils', () => ({
  formatApiHost: (host: string) => host.replace(/\/$/, '').replace(/#$/, '')
}))

vi.mock('@renderer/utils/api', () => ({
  formatOllamaApiHost: (host: string) => host,
  formatVertexApiHost: ({ apiHost }: { apiHost: string }) => apiHost,
  isWithTrailingSharp: (host: string) => host.endsWith('#')
}))

const providerMocks = {
  isAzureOpenAIProvider: vi.fn(() => false),
  isCherryAIProvider: vi.fn(() => false),
  isNewApiProvider: vi.fn(() => false),
  isPerplexityProvider: vi.fn(() => false),
  isVertexProvider: vi.fn(() => false)
}

vi.mock('@shared/utils/provider', () => providerMocks)

const buildAzureParams = (apiVersion?: string) => ({
  provider: {
    id: 'azure-openai',
    settings: apiVersion !== undefined ? { apiVersion } : {}
  } as any,
  authConfig: null,
  primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  apiHost: 'https://example.openai.azure.com',
  anthropicApiHost: '',
  providerAnthropicHost: ''
})

describe('buildHostEndpointPreviews — Azure apiVersion (#11691)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMocks.isAzureOpenAIProvider.mockReturnValue(true)
    providerMocks.isCherryAIProvider.mockReturnValue(false)
    providerMocks.isNewApiProvider.mockReturnValue(false)
    providerMocks.isPerplexityProvider.mockReturnValue(false)
    providerMocks.isVertexProvider.mockReturnValue(false)
  })

  it('uses the user-configured dated apiVersion on chat/completions path', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams('2024-02-01'))

    expect(hostPreview).toBe('https://example.openai.azure.com/v1/chat/completions?apiVersion=2024-02-01')
  })

  it('preserves dated apiVersion verbatim with surrounding whitespace trimmed', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams('  2024-12-01-preview  '))

    expect(hostPreview).toBe('https://example.openai.azure.com/v1/chat/completions?apiVersion=2024-12-01-preview')
  })

  it('routes the literal "preview" apiVersion to the Responses path', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams('preview'))

    expect(hostPreview).toBe('https://example.openai.azure.com/v1/responses?apiVersion=preview')
  })

  it('routes the literal "v1" apiVersion to the Responses path', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams('v1'))

    expect(hostPreview).toBe('https://example.openai.azure.com/v1/responses?apiVersion=v1')
  })

  it('falls back to v1 in the Responses path when apiVersion is unset', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams(undefined))

    expect(hostPreview).toBe('https://example.openai.azure.com/v1/responses?apiVersion=v1')
  })

  it('falls back to v1 in the Responses path when apiVersion is empty', () => {
    const { hostPreview } = buildHostEndpointPreviews(buildAzureParams(''))

    expect(hostPreview).toBe('https://example.openai.azure.com/v1/responses?apiVersion=v1')
  })
})
