// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

// Stub the registry loader so the preset lookup returns a minimal CherryIN row
// (its gemini / openai-chat endpoints tagged `cherryin`) without reading the
// shipped providers.json, whose path is mocked away in the test harness.
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'cherryin',
          endpointConfigs: {
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

describe('ProviderService.create — adapterFamily backfill', () => {
  const dbh = setupTestDatabase()

  it('fills missing adapterFamily from the preset for a preset-derived instance (custom CherryIN host)', async () => {
    // Mirrors the "add CherryIN instance" flow: user-entered baseUrls only, no
    // adapterFamily. Without the backfill the gemini endpoint resolves to
    // openai-compatible and image generation POSTs to /v1/images/generations.
    const created = providerService.create({
      providerId: 'cherryin-express',
      presetProviderId: 'cherryin',
      name: 'CherryIn Express',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://express-ent-admin.cherryin.ai' },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://express-ent-admin.cherryin.ai/v1beta' },
        // openai-responses is NOT declared by the cherryin preset → endpoint-type default.
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://express-ent-admin.cherryin.ai' }
      }
    })

    // baseUrls are preserved; adapterFamily is derived.
    expect(created.endpointConfigs?.[ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]).toEqual({
      baseUrl: 'https://express-ent-admin.cherryin.ai/v1beta',
      adapterFamily: 'cherryin'
    })
    expect(created.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('cherryin')
    // Undeclared endpoint falls back to the endpoint-type default, not cherryin.
    expect(created.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_RESPONSES]?.adapterFamily).toBe('openai')

    // Persisted, not just returned.
    const [row] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'cherryin-express'))
    expect(row.endpointConfigs?.[ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]?.adapterFamily).toBe('cherryin')
  })

  it('keeps an explicitly-set adapterFamily and defaults endpoints for a preset-less custom provider', async () => {
    const created = providerService.create({
      providerId: 'custom-relay',
      name: 'Custom Relay',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example.com' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example.com', adapterFamily: 'newapi' }
      }
    })

    // No preset → endpoint-type default for the untagged endpoint…
    expect(created.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.adapterFamily).toBe('anthropic')
    // …and an explicit value is never overwritten.
    expect(created.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('newapi')
  })
})
