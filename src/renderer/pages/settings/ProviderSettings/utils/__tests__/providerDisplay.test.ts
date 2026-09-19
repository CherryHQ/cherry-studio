import { describe, expect, it, vi } from 'vitest'

import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

// Stub imported i18n and provider helpers so these tests stay focused on provider eligibility.
vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('@renderer/i18n/label', () => ({ getProviderLabelKey: (id: string) => id }))
vi.mock('@shared/utils/provider', () => ({
  isCherryAIProvider: (p: Provider) => p.id === 'cherryai',
  isLoginBasedProvider: (p: Provider) =>
    p.authMethods !== undefined && p.authMethods.length > 0 && !p.authMethods.includes('api-key')
}))

const { applyPrimaryBaseUrlToMatchingEndpoints, isProviderPresetInstanceSource } = await import('../providerDisplay')
const { isProviderSettingsListVisibleProvider } = await import('@renderer/utils/providerSettings')

const provider = (id: string): Provider => ({ id }) as Provider
const presetSource = (overrides: Partial<Provider> = {}): Provider =>
  ({
    id: 'openai',
    name: 'OpenAI',
    presetProviderId: 'openai',
    authType: 'api-key',
    defaultChatEndpoint: 'openai-responses',
    endpointConfigs: {
      'openai-responses': { baseUrl: 'https://api.openai.com' }
    },
    ...overrides
  }) as Provider

describe('isProviderSettingsListVisibleProvider', () => {
  it('hides the internal local-embedding provider from the management list', () => {
    expect(isProviderSettingsListVisibleProvider(provider(LOCAL_EMBEDDING_PROVIDER_ID))).toBe(false)
  })

  it('hides the CherryAI provider', () => {
    expect(isProviderSettingsListVisibleProvider(provider('cherryai'))).toBe(false)
  })

  it('keeps a normal provider visible', () => {
    expect(isProviderSettingsListVisibleProvider(provider('openai'))).toBe(true)
  })
})

describe('isProviderPresetInstanceSource', () => {
  it('accepts a canonical URL-based preset with a configured primary endpoint', () => {
    expect(isProviderPresetInstanceSource(presetSource())).toBe(true)
  })

  it('accepts the canonical New API preset without a registry default endpoint', () => {
    expect(
      isProviderPresetInstanceSource(
        presetSource({
          id: 'new-api',
          name: 'New API',
          presetProviderId: 'new-api',
          defaultChatEndpoint: undefined,
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: 'http://localhost:3000' }
          }
        })
      )
    ).toBe(true)
  })

  it('rejects derived providers and presets without an independent generic-auth flow', () => {
    expect(isProviderPresetInstanceSource(presetSource({ id: 'openai-work' }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ authMethods: ['oauth'] }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ authType: 'iam-gcp' }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ id: 'copilot', presetProviderId: 'copilot' }))).toBe(false)
  })

  it('rejects other presets without a configured default chat endpoint', () => {
    expect(isProviderPresetInstanceSource(presetSource({ defaultChatEndpoint: undefined }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ endpointConfigs: undefined }))).toBe(false)
  })
})

describe('applyPrimaryBaseUrlToMatchingEndpoints', () => {
  // Catches #20159: editing the visible primary host must also move openai-responses when
  // it still shares that host. Otherwise Codex connection checks keep hitting Xiaomi MiMo.
  it('updates openai-responses when it still shares the previous primary baseUrl', () => {
    const next = applyPrimaryBaseUrlToMatchingEndpoints(
      {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.xiaomimimo.com',
          adapterFamily: 'openai-compatible'
        },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.xiaomimimo.com', adapterFamily: 'openai' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://api.xiaomimimo.com/anthropic',
          adapterFamily: 'anthropic'
        }
      },
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      'https://token-plan-cn.xiaomimimo.com'
    )

    expect(next).toEqual({
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://token-plan-cn.xiaomimimo.com',
        adapterFamily: 'openai-compatible'
      },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
        baseUrl: 'https://token-plan-cn.xiaomimimo.com',
        adapterFamily: 'openai'
      },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
        baseUrl: 'https://api.xiaomimimo.com/anthropic',
        adapterFamily: 'anthropic'
      }
    })
  })

  it('leaves an independently configured responses host untouched', () => {
    const next = applyPrimaryBaseUrlToMatchingEndpoints(
      {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.xiaomimimo.com' },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://codex.example.com' }
      },
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      'https://proxy.example.com'
    )

    expect(next[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe('https://proxy.example.com')
    expect(next[ENDPOINT_TYPE.OPENAI_RESPONSES]?.baseUrl).toBe('https://codex.example.com')
  })
})
