// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

// Stub the registry loader so the preset lookup returns a minimal CherryIN row
// (its anthropic / gemini / openai-chat endpoints tagged `cherryin`) without
// reading the shipped providers.json, whose path is mocked away in the harness.
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'cherryin',
          endpointConfigs: {
            'anthropic-messages': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
            'google-generate-content': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
            'openai-chat-completions': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' }
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

    // The "add endpoint" drawer PATCHes the full set; the renderer may echo
    // merged runtime snapshots, but only the override shape is persisted.
    providerService.update('cherryin-express', {
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://express-ent-admin.cherryin.ai',
          adapterFamily: 'cherryin'
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

  it('defaults an undeclared endpoint to its endpoint-type family, not cherryin', async () => {
    providerService.create({
      providerId: 'cherryin-express-2',
      presetProviderId: 'cherryin',
      name: 'CherryIn Express 2',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://express-ent-admin.cherryin.ai' }
      }
    })

    // openai-responses is NOT declared by the cherryin preset → endpoint-type default.
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
    // openai-responses is NOT declared by the cherryin preset → the runtime
    // read infers the endpoint-type default, not cherryin.
    const runtime = providerService.getByProviderId('cherryin-express-2')
    expect(runtime.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_RESPONSES]?.adapterFamily).toBe('openai')
  })
})
