import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { getProviderHostTopology } from '@shared/utils/providerTopology'

// Keep projection tests independent of shipped registry files.
// The fixtures cover inherited CherryIN routing and a preset default endpoint.
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'cherryin',
          endpointConfigs: {
            'anthropic-messages': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
            'google-generate-content': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
            'openai-responses': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
            'openai-chat-completions': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' }
          }
        },
        {
          id: 'endpoint-default-preset',
          defaultChatEndpoint: 'openai-responses',
          endpointConfigs: {
            'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://responses.default.example' }
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

describe('ProviderService.update — endpoint config overrides', () => {
  const dbh = setupTestDatabase()

  it('ignores unsupported persisted endpoints and defaults without rewriting the stored row', () => {
    const rawConfigs = {
      'future-chat-endpoint': { baseUrl: 'https://future.example' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://images.example', adapterFamily: 'openai' },
      [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { baseUrl: 'https://embeddings.example', adapterFamily: 'openai' }
    }
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'future-endpoint-config',
        name: 'Future Endpoint Config',
        endpointConfigs: rawConfigs,
        defaultChatEndpoint: 'future-chat-endpoint' as never,
        orderKey: 'a0'
      })
      .run()

    const runtime = providerService.getByProviderId('future-endpoint-config')

    expect(Object.keys(runtime.endpointConfigs ?? {})).toEqual([
      ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
      ENDPOINT_TYPE.OPENAI_EMBEDDINGS
    ])
    expect(runtime.defaultChatEndpoint).toBeUndefined()
    expect(getProviderHostTopology(runtime)).toMatchObject({
      primaryEndpoint: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
      primaryBaseUrl: 'https://images.example'
    })

    const stored = dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'future-endpoint-config'))
      .get()
    expect(stored?.endpointConfigs).toEqual(rawConfigs)
    expect(stored?.defaultChatEndpoint).toBe('future-chat-endpoint')
  })

  it('uses the registry default when the persisted default endpoint is unsupported', () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'future-default-endpoint',
        presetProviderId: 'endpoint-default-preset',
        name: 'Future Default Endpoint',
        defaultChatEndpoint: 'future-chat-endpoint' as never,
        orderKey: 'a0'
      })
      .run()

    const runtime = providerService.getByProviderId('future-default-endpoint')

    expect(runtime.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_RESPONSES)
    expect(getProviderHostTopology(runtime).primaryBaseUrl).toBe('https://responses.default.example')
  })

  it('keeps projecting supported row fields when registry lookup fails', () => {
    const rawConfigs = {
      'future-chat-endpoint': { baseUrl: 'https://future.example' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: {
        baseUrl: 'https://images.example',
        adapterFamily: 'legacy-relay',
        reasoningFormatType: 'private-legacy-field'
      }
    }
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'registry-fallback-endpoint',
        presetProviderId: 'endpoint-default-preset',
        name: 'Registry Fallback',
        endpointConfigs: rawConfigs,
        orderKey: 'a0'
      })
      .run()
    const stored = dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'registry-fallback-endpoint'))
      .get()
    const lookup = vi.spyOn(RegistryLoader.prototype, 'loadProviders').mockImplementationOnce(() => {
      throw new Error('registry unavailable')
    })

    try {
      const projected = providerRegistryService.mergeEndpointConfigs(
        stored?.endpointConfigs,
        'registry-fallback-endpoint',
        stored?.presetProviderId
      )

      expect(projected).toEqual({
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://images.example', adapterFamily: 'legacy-relay' }
      })
    } finally {
      lookup.mockRestore()
    }
  })

  it('strips legacy reasoningFormatType from persisted endpoint configs on read', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'legacy-reasoning-format',
      name: 'Legacy Reasoning Format',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://proxy.example/v1',
          adapterFamily: 'openai',
          reasoningFormatType: 'openai-responses'
        }
      } as never,
      orderKey: 'a0'
    })

    const provider = providerService.getByProviderId('legacy-reasoning-format')
    const endpointConfig = provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]

    expect(endpointConfig).toEqual({
      baseUrl: 'https://proxy.example/v1',
      adapterFamily: 'openai'
    })
    expect(endpointConfig).not.toHaveProperty('reasoningFormatType')
  })

  it('persists a { baseUrl }-only override when a settings PATCH adds an endpoint', async () => {
    // A correctly-created preset-derived instance (openai-chat tagged `cherryin`).
    providerService.create({
      providerId: 'cherryin-express',
      presetProviderId: 'cherryin',
      name: 'CherryIn Express',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://express-ent-admin.cherryin.ai' }
      }
    })

    // The "add endpoint" drawer PATCHes the public baseUrl-only shape.
    providerService.update('cherryin-express', {
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://express-ent-admin.cherryin.ai'
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://express-ent-admin.cherryin.ai/v1' }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'cherryin-express'))

    // Rows persist only the user-owned override shape — the echoed
    // adapterFamily is stripped for preset-linked providers.
    expect(row.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toEqual({
      baseUrl: 'https://express-ent-admin.cherryin.ai/v1'
    })
    expect(row.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toEqual({
      baseUrl: 'https://express-ent-admin.cherryin.ai'
    })
    // The runtime read supplies the preset family for the newly-added
    // endpoint instead of the openai-compatible fallback.
    const runtime = providerService.getByProviderId('cherryin-express')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.adapterFamily).toBe('cherryin')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('cherryin')
  })

  it('preserves a main-only legacy adapterFamily when a custom provider baseUrl is updated', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'custom-newapi-relay',
      name: 'Custom NewAPI Relay',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://old-relay.example.com',
          adapterFamily: 'newapi'
        }
      },
      orderKey: 'a0'
    })

    providerService.update('custom-newapi-relay', {
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-relay.example.com' }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'custom-newapi-relay'))
    expect(row.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toEqual({
      baseUrl: 'https://new-relay.example.com',
      adapterFamily: 'newapi'
    })
    const runtime = providerService.getByProviderId('custom-newapi-relay')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('newapi')
  })

  it('uses the preset adapter family when adding the CherryIN Responses endpoint', async () => {
    providerService.create({
      providerId: 'cherryin-express-2',
      presetProviderId: 'cherryin',
      name: 'CherryIn Express 2',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://express-ent-admin.cherryin.ai' }
      }
    })

    providerService.update('cherryin-express-2', {
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://express-ent-admin.cherryin.ai' }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'cherryin-express-2'))
    expect(row.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_RESPONSES]).toEqual({
      baseUrl: 'https://express-ent-admin.cherryin.ai'
    })
    const runtime = providerService.getByProviderId('cherryin-express-2')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_RESPONSES]?.adapterFamily).toBe('cherryin')
  })
})
