import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { resolveGeminiBaseUrl, resolveHermesProviderInfo, resolvePiProviderInfo } from '../resolvers'

const provider = (partial: Record<string, unknown>): Provider => partial as unknown as Provider

describe('resolveGeminiBaseUrl', () => {
  it('uses a dedicated google-generate-content baseUrl verbatim', () => {
    expect(
      resolveGeminiBaseUrl(
        provider({
          id: 'gemini',
          endpointConfigs: { 'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' } }
        })
      )
    ).toBe('https://generativelanguage.googleapis.com')
  })

  it('prefers a dedicated endpoint over the aggregator derivation', () => {
    expect(
      resolveGeminiBaseUrl(
        provider({
          id: 'aihubmix',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: {
            'google-generate-content': { baseUrl: 'https://direct.example.com' },
            'openai-chat-completions': { baseUrl: 'https://aihubmix.com/v1' }
          }
        })
      )
    ).toBe('https://direct.example.com')
  })

  // Must follow the configured baseUrl (not the static aihubmix.com host) and
  // drop a trailing /v1 before appending /gemini.
  it('derives the aihubmix Gemini URL from the configured chat baseUrl, stripping a trailing /v1', () => {
    expect(
      resolveGeminiBaseUrl(
        provider({
          id: 'aihubmix',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://custom.example.com/v1' } }
        })
      )
    ).toBe('https://custom.example.com/gemini')
  })

  it('tolerates a trailing slash on the configured chat baseUrl', () => {
    expect(
      resolveGeminiBaseUrl(
        provider({
          id: 'aihubmix',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://custom.example.com/v1/' } }
        })
      )
    ).toBe('https://custom.example.com/gemini')
  })

  it('falls back to the static aggregator host only when nothing is configured', () => {
    expect(resolveGeminiBaseUrl(provider({ id: 'aihubmix' }))).toBe('https://aihubmix.com/gemini')
  })

  it('uses the default-chat-endpoint host as-is for aggregators without a /gemini sub-path (CherryIN)', () => {
    expect(
      resolveGeminiBaseUrl(
        provider({
          id: 'cherryin',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://open.cherryin.net' } }
        })
      )
    ).toBe('https://open.cherryin.net')
  })

  it('returns empty for a provider with no resolvable endpoint', () => {
    expect(resolveGeminiBaseUrl(provider({ id: 'noendpoint' }))).toBe('')
  })

  // The synthetic gateway provider declares no google endpoint (adding one would flip
  // OpenCode+gateway to the google dialect), so gemini reads its shared bare host —
  // @google/genai appends /v1beta itself.
  it('returns the bare gateway host for the synthetic API-gateway provider', () => {
    expect(
      resolveGeminiBaseUrl(
        provider({
          id: CLI_API_GATEWAY_PROVIDER_ID,
          endpointConfigs: {
            'anthropic-messages': { baseUrl: 'http://127.0.0.1:23333' },
            'openai-chat-completions': { baseUrl: 'http://127.0.0.1:23333' },
            'openai-responses': { baseUrl: 'http://127.0.0.1:23333' }
          }
        })
      )
    ).toBe('http://127.0.0.1:23333')
  })
})

describe('resolveHermesProviderInfo', () => {
  // anthropic-messages is configured AND first in HERMES_ENDPOINTS, so a catalog-order
  // fallback would pick it; the model supports only openai-responses (a later catalog
  // entry), so selecting it proves model preference beats catalog order rather than
  // coinciding with it.
  it('prefers the model-supported endpoint over an earlier one in catalog order', () => {
    expect(
      resolveHermesProviderInfo(
        provider({
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: {
            'anthropic-messages': { baseUrl: 'https://anthropic.example/v1' },
            'openai-responses': { baseUrl: 'https://openai.example' }
          }
        }),
        ['openai-responses']
      )
    ).toEqual({
      apiMode: 'codex_responses',
      baseUrl: 'https://openai.example/v1',
      endpointType: 'openai-responses'
    })
  })

  it('maps a selected anthropic-messages endpoint to its mode and strips the trailing API version', () => {
    expect(
      resolveHermesProviderInfo(
        provider({ endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example/v1' } } }),
        ['anthropic-messages']
      )
    ).toEqual({
      apiMode: 'anthropic_messages',
      baseUrl: 'https://anthropic.example',
      endpointType: 'anthropic-messages'
    })
  })

  it('maps an OpenAI Responses endpoint to the Codex transport', () => {
    expect(
      resolveHermesProviderInfo(
        provider({ endpointConfigs: { 'openai-responses': { baseUrl: 'https://openai.example' } } })
      )
    ).toEqual({
      apiMode: 'codex_responses',
      baseUrl: 'https://openai.example/v1',
      endpointType: 'openai-responses'
    })
  })
})

describe('resolvePiProviderInfo', () => {
  it('prefers the provider default when the model advertises that endpoint capability', () => {
    expect(
      resolvePiProviderInfo(
        provider({
          defaultChatEndpoint: 'openai-responses',
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: 'https://chat.example' },
            'openai-responses': { baseUrl: 'https://responses.example' }
          }
        }),
        ['openai-chat-completions', 'openai-responses']
      )
    ).toEqual({
      api: 'openai-responses',
      baseUrl: 'https://responses.example/v1',
      endpointType: 'openai-responses'
    })
  })

  it('prefers a model-supported endpoint and maps it to Pi API names', () => {
    expect(
      resolvePiProviderInfo(
        provider({
          defaultChatEndpoint: 'anthropic-messages',
          endpointConfigs: {
            'anthropic-messages': { baseUrl: 'https://anthropic.example' },
            'openai-responses': { baseUrl: 'https://openai.example' }
          }
        }),
        ['openai-responses']
      )
    ).toEqual({
      api: 'openai-responses',
      baseUrl: 'https://openai.example/v1',
      endpointType: 'openai-responses'
    })
  })

  it('normalizes the Google endpoint to the v1beta API required by Pi', () => {
    expect(
      resolvePiProviderInfo(
        provider({
          defaultChatEndpoint: 'google-generate-content',
          endpointConfigs: { 'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' } }
        })
      )
    ).toEqual({
      api: 'google-generative-ai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      endpointType: 'google-generate-content'
    })
  })
})
