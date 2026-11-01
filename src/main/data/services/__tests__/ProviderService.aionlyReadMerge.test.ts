import { resolve } from 'node:path'

// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { providerToAiSdkConfig } from '@main/ai/provider/config'
import { resolveAiSdkProviderId } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

describe('ProviderService AiOnly read-time registry merge (#21168)', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : key === 'app.root'
          ? resolve(process.cwd(), filename ?? '')
          : (getPath?.(key, filename) ?? `/mock/${key}`)
    )
    providerRegistryService.clearCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  it('refreshes stale openai-compatible rows to the bundled newapi preset for anthropic-messages', async () => {
    // Rows seeded before the registry fix only persisted chat with openai-compatible.
    await dbh.db.insert(userProviderTable).values({
      providerId: 'aionly',
      presetProviderId: 'aionly',
      name: 'AiOnly',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.aiionly.com/v1',
          adapterFamily: 'openai-compatible'
        }
      },
      orderKey: 'a0'
    })

    const provider = providerService.getByProviderId('aionly')

    expect(provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toMatchObject({
      baseUrl: 'https://api.aiionly.com/v1',
      adapterFamily: 'newapi'
    })
    expect(provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toEqual({
      adapterFamily: 'newapi'
    })
    expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('newapi')

    const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })
    const config = await providerToAiSdkConfig(provider, model)

    expect(config.providerId).toBe('newapi')
    expect((config.providerSettings as Record<string, unknown>).baseURL).toBe('https://api.aiionly.com/v1')
  })
})
