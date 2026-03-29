import { describe, expect, it } from 'vitest'

import { normalizeAzureOpenAIEndpoint } from '../openai/azureOpenAIEndpoint'

describe('normalizeAzureOpenAIEndpoint', () => {
  it.each([
    {
      apiHost: 'https://example.openai.azure.com/openai',
      expectedEndpoint: 'https://example.openai.azure.com'
    },
    {
      apiHost: 'https://example.openai.azure.com/openai/',
      expectedEndpoint: 'https://example.openai.azure.com'
    },
    {
      apiHost: 'https://example.openai.azure.com/openai/v1',
      expectedEndpoint: 'https://example.openai.azure.com'
    },
    {
      apiHost: 'https://example.openai.azure.com/openai/v1/',
      expectedEndpoint: 'https://example.openai.azure.com'
    },
    {
      apiHost: 'https://example.openai.azure.com',
      expectedEndpoint: 'https://example.openai.azure.com'
    },
    {
      apiHost: 'https://example.openai.azure.com/',
      expectedEndpoint: 'https://example.openai.azure.com'
    },
    {
      apiHost: 'https://example.openai.azure.com/OPENAI/V1',
      expectedEndpoint: 'https://example.openai.azure.com'
    }
  ])('strips trailing /openai from $apiHost', ({ apiHost, expectedEndpoint }) => {
    expect(normalizeAzureOpenAIEndpoint(apiHost)).toBe(expectedEndpoint)
  })
})
