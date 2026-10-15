import { describe, expect, it } from 'vitest'

import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveEndpointBaseUrl } from '../endpointConnection'

const relay = {
  defaultChatEndpoint: 'google-generate-content',
  endpointConfigs: {
    'google-generate-content': { baseUrl: 'https://gemini.example/v1beta' },
    'openai-responses': { baseUrl: 'https://responses.example/v1' },
    'openai-chat-completions': { baseUrl: 'https://chat.example/v1' }
  }
} satisfies Pick<Provider, 'defaultChatEndpoint' | 'endpointConfigs'>

describe('endpoint connections', () => {
  it('uses an explicit target override, then the same-family default, then Chat before Responses', () => {
    expect(
      resolveEndpointBaseUrl(
        {
          ...relay,
          endpointConfigs: {
            ...relay.endpointConfigs,
            'openai-image-generation': { baseUrl: 'https://images.example/v1' }
          }
        },
        'openai-image-generation'
      )
    ).toBe('https://images.example/v1')
    expect(
      resolveEndpointBaseUrl({ ...relay, defaultChatEndpoint: 'openai-responses' }, 'openai-image-generation')
    ).toBe('https://responses.example/v1')
    expect(resolveEndpointBaseUrl(relay, 'openai-image-generation')).toBe('https://chat.example/v1')
  })

  it.each([
    'openai-image-edit',
    'openai-embeddings',
    'openai-text-to-speech',
    'openai-audio-transcription',
    'openai-audio-translation',
    'openai-video-generation',
    'openai-text-completions',
    'jina-rerank'
  ] satisfies EndpointType[])('inherits a connection for %s without materializing it in the provider', (endpoint) => {
    expect(resolveEndpointBaseUrl(relay, endpoint)).toBe('https://chat.example/v1')
    expect(Object.keys(relay.endpointConfigs)).toHaveLength(3)
  })

  it('rejects unrelated protocols and an absent target', () => {
    const provider = {
      endpointConfigs: { 'google-generate-content': relay.endpointConfigs['google-generate-content'] }
    }
    expect(resolveEndpointBaseUrl(provider, 'openai-image-generation')).toBe('')
    expect(resolveEndpointBaseUrl(relay, 'anthropic-messages')).toBe('')
    expect(resolveEndpointBaseUrl(relay, 'ollama-generate')).toBe('')
    expect(resolveEndpointBaseUrl(provider, undefined)).toBe('')
  })

  it('inherits image editing from a pure image provider and generate from Ollama chat', () => {
    expect(
      resolveEndpointBaseUrl(
        { endpointConfigs: { 'openai-image-generation': { baseUrl: 'https://images.example/v1' } } },
        'openai-image-edit'
      )
    ).toBe('https://images.example/v1')
    expect(
      resolveEndpointBaseUrl(
        { endpointConfigs: { 'ollama-chat': { baseUrl: 'http://localhost:11434' } } },
        'ollama-generate'
      )
    ).toBe('http://localhost:11434')
  })

  it('inherits the root of a complete URL while preserving an explicit target URL', () => {
    const provider = {
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://relay.example/custom/chat/completions#' } }
    }
    expect(resolveEndpointBaseUrl(provider, 'openai-text-to-speech')).toBe('https://relay.example/custom#')
    expect(resolveEndpointBaseUrl(provider, 'openai-chat-completions')).toBe(
      'https://relay.example/custom/chat/completions#'
    )
  })

  it('restores inheritance for a cleared or whitespace-only override', () => {
    expect(
      resolveEndpointBaseUrl(
        {
          ...relay,
          endpointConfigs: {
            ...relay.endpointConfigs,
            'openai-image-generation': { baseUrl: '  ' }
          }
        },
        'openai-image-generation'
      )
    ).toBe('https://chat.example/v1')
  })
})

it('shares explicitly declared New API connections without borrowing a native protocol connection', () => {
  const provider = {
    endpointConfigs: {
      'openai-chat-completions': { baseUrl: 'https://gateway.example/v1', adapterFamily: 'newapi' },
      'google-generate-content': { adapterFamily: 'newapi' }
    }
  }
  expect(resolveEndpointBaseUrl(provider, 'google-generate-content')).toBe('https://gateway.example/v1')
  expect(
    resolveEndpointBaseUrl(
      {
        endpointConfigs: {
          ...provider.endpointConfigs,
          'google-generate-content': { adapterFamily: 'google' }
        }
      },
      'google-generate-content'
    )
  ).toBe('')
})
