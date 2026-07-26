// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { resolveAiSdkProviderId } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

// Stub the registry loader with a minimal CherryIN preset. `google-generate-content`
// is deliberately present here but ABSENT from the persisted rows below —
// modelling an install seeded before the registry gained that endpoint (#17096).
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'cherryin',
          endpointConfigs: {
            'openai-chat-completions': {
              adapterFamily: 'cherryin',
              baseUrl: 'https://open.cherryin.net',
              modelsApiUrls: { default: 'https://open.cherryin.net/v1/models' }
            },
            'google-generate-content': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' }
          }
        }
      ]
    }
    loadModels() {
      return []
    }
    loadProviderModels() {
      return []
    }
    findModel() {
      return null
    }
    findOverride() {
      return null
    }
  }
  return { RegistryLoader }
})

describe('ProviderService read-time registry merge (#17096)', () => {
  const dbh = setupTestDatabase()

  it('surfaces a registry-added endpoint type absent from the persisted row', async () => {
    // Stale seed: only openai-chat persisted; google-generate-content added to
    // the registry after this row was seeded.
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://open.cherryin.net',
          adapterFamily: 'cherryin'
        }
      },
      orderKey: 'a0'
    })

    const provider = providerService.getByProviderId('cherryin')

    expect(provider.endpointConfigs?.[ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]).toEqual({
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    })
    // End to end: the resolver no longer falls through to openai-compatible.
    expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).not.toBe('openai-compatible')
  })

  it('keeps the user-owned baseUrl while refreshing registry-owned fields', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://proxy.corp.example/v1', // user override
          adapterFamily: 'stale-family' // stale registry snapshot
        }
      },
      orderKey: 'a0'
    })

    const config = providerService.getByProviderId('cherryin').endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]

    expect(config).toEqual({
      baseUrl: 'https://proxy.corp.example/v1', // row wins
      adapterFamily: 'cherryin', // registry wins
      modelsApiUrls: { default: 'https://open.cherryin.net/v1/models' } // registry wins
    })
  })

  it('leaves custom providers (no registry preset) on their persisted configs', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'my-relay',
      name: 'My Relay',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://relay.example/v1',
          adapterFamily: 'newapi' // migrator-written hint must survive
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://relay.example' // no family → endpoint-type inference
        }
      },
      orderKey: 'a0'
    })

    const configs = providerService.getByProviderId('my-relay').endpointConfigs

    expect(configs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toEqual({
      baseUrl: 'https://relay.example/v1',
      adapterFamily: 'newapi'
    })
    expect(configs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toEqual({
      baseUrl: 'https://relay.example',
      adapterFamily: 'anthropic'
    })
  })

  it('strips legacy registry-only fields before merging', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://open.cherryin.net',
          adapterFamily: 'cherryin',
          reasoningFormatType: 'openai-responses'
        }
      } as never,
      orderKey: 'a0'
    })

    const config = providerService.getByProviderId('cherryin').endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    expect(config).not.toHaveProperty('reasoningFormatType')
  })
})
