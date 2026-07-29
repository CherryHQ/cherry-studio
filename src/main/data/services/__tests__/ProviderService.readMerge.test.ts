// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { resolveAiSdkProviderId } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

// Stub the registry loader with CherryIN plus a future `my-relay` preset.
// `google-generate-content` is deliberately present for CherryIN but ABSENT
// from the persisted rows below — modelling an install seeded before the
// registry gained that endpoint (#17096). `my-relay` models a later registry
// id collision with an already-persisted fully custom provider.
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
          },
          defaultChatEndpoint: 'openai-chat-completions',
          apiFeatures: { serviceTier: false },
          reportedCostCurrency: 'USD'
        },
        {
          id: 'my-relay',
          description: 'Future registry provider',
          endpointConfigs: {
            'openai-chat-completions': {
              adapterFamily: 'future-registry',
              baseUrl: 'https://registry.example/v1',
              modelsApiUrls: { default: 'https://registry.example/v1/models' }
            }
          },
          defaultChatEndpoint: 'openai-chat-completions'
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

  it('keeps explicit custom provenance when a future registry entry reuses the provider id', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'my-relay',
      presetProviderId: null,
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

    const provider = providerService.getByProviderId('my-relay')
    const configs = provider.endpointConfigs

    expect(provider.description).toBeUndefined()
    expect(provider.defaultChatEndpoint).toBeUndefined()
    expect(configs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toEqual({
      baseUrl: 'https://relay.example/v1',
      adapterFamily: 'newapi'
    })
    expect(configs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toEqual({
      baseUrl: 'https://relay.example',
      adapterFamily: 'anthropic'
    })
  })

  it('resolves registry-owned request metadata when the row stores no delta', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      orderKey: 'a0'
    })

    const provider = providerService.getByProviderId('cherryin')

    // Registry baseline over app defaults; nothing frozen in the row.
    expect(provider.apiFeatures.serviceTier).toBe(false)
    expect(provider.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(provider.reportedCostCurrency).toBe('USD')
  })

  it('persists apiFeatures as a delta: single-key PATCH merges, baseline echoes vanish', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      orderKey: 'a0'
    })

    // Toggle one flag away from the baseline (registry says serviceTier: false).
    providerService.update('cherryin', { apiFeatures: { serviceTier: true } })
    let [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'cherryin'))
    expect(row.apiFeatures).toEqual({ serviceTier: true })
    expect(providerService.getByProviderId('cherryin').apiFeatures.serviceTier).toBe(true)

    // A full-snapshot echo that matches the baseline reduces the row to null.
    providerService.update('cherryin', {
      apiFeatures: {
        arrayContent: true,
        streamOptions: true,
        developerRole: false,
        serviceTier: false,
        verbosity: false
      }
    })
    ;[row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'cherryin'))
    expect(row.apiFeatures).toBeNull()
  })

  it('drops a defaultChatEndpoint echo that matches the registry baseline', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      orderKey: 'a0'
    })

    // The provider editor echoes the current runtime endpoint while renaming.
    // That baseline value must not become a stored override.
    providerService.update('cherryin', {
      name: 'Renamed CherryIN',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    let [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'cherryin'))
    expect(row.defaultChatEndpoint).toBeNull()

    // A real user override persists, then disappears again when reset to the
    // registry baseline.
    providerService.update('cherryin', {
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    })
    ;[row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'cherryin'))
    expect(row.defaultChatEndpoint).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)

    providerService.update('cherryin', {
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    ;[row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'cherryin'))
    expect(row.defaultChatEndpoint).toBeNull()
  })

  it('drops endpoint baseUrls that match the registry default on write', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'cherryin',
      presetProviderId: 'cherryin',
      name: 'CherryIN',
      orderKey: 'a0'
    })

    // Renderer echo of the merged snapshot: one registry-default baseUrl, one
    // genuine user override.
    providerService.update('cherryin', {
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.cherryin.net' },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://proxy.corp.example' }
      }
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'cherryin'))
    expect(row.endpointConfigs).toEqual({
      [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://proxy.corp.example' }
    })
    // The runtime still sees both endpoints — the dropped one from the registry.
    const runtime = providerService.getByProviderId('cherryin')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe('https://open.cherryin.net')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]?.baseUrl).toBe('https://proxy.corp.example')
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
