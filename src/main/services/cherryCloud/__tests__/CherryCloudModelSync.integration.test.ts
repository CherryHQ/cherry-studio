import { resolve } from 'node:path'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CherryCloudService } from '../CherryCloudService'

const uuid = '00000000-0000-4000-8000-000000000001'

describe('Cherry Cloud model sync with ModelService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    CherryCloudService.resetInstances()
    providerRegistryService.clearCache()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      resolve(
        key === 'app.root'
          ? '.'
          : key === 'feature.provider_registry.data'
            ? 'packages/provider-registry/data'
            : '.context/nonexistent-registry',
        filename ?? ''
      )
    )
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: CHERRY_CLOUD_PROVIDER_ID, name: 'Cloud', orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
    CherryCloudService.resetInstances()
  })

  it.each([ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])(
    'persists a full feature-only batch on %s and preserves explicit feature clearing',
    async (endpointType) => {
      const service = new CherryCloudService()
      service['cloudState'].session = {
        accessToken: 'test',
        refreshToken: 'test',
        accessExpiresAt: Date.now() + 600_000,
        sessionExpiresAt: Date.now() + 600_000,
        sessionId: uuid,
        deviceId: uuid,
        accountId: uuid,
        displayName: null
      }
      const models = [
        { id: 'feature-only', capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] },
        { id: 'two-features', capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING] },
        { id: 'empty-features', capabilities: [] }
      ].map((model) => ({
        ...model,
        display_name: model.id,
        endpoint_type: endpointType,
        context_window: 128_000,
        max_output_tokens: 8192
      }))
      vi.spyOn(service, 'authenticatedFetch').mockImplementation(async (path) =>
        Response.json(
          path === '/api/v1/account'
            ? {
                account: { id: uuid },
                session: { id: uuid, expires_at: '2099-01-01T00:00:00Z' },
                device: { id: uuid },
                entitlements: [
                  {
                    plan_id: uuid,
                    plan_name: 'Test',
                    is_free: true,
                    status: 'active',
                    model_ids: models.map((model) => model.id)
                  }
                ]
              }
            : { data: models }
        )
      )

      await expect(service['syncEntitledModels']()).resolves.toMatchObject({
        entitledModelIds: models.map((model) => `${CHERRY_CLOUD_PROVIDER_ID}::${model.id}`)
      })
      expect(dbh.db.select().from(userModelTable).all()).toHaveLength(3)
      for (const remote of models) {
        expect(modelService.getByKey(CHERRY_CLOUD_PROVIDER_ID, remote.id)?.capabilities).toEqual([
          ...remote.capabilities,
          MODEL_CAPABILITY.TEXT_GENERATION
        ])
      }

      models[0].capabilities = []
      await service['syncEntitledModels']()
      expect(modelService.getByKey(CHERRY_CLOUD_PROVIDER_ID, 'feature-only')?.capabilities).toEqual([
        MODEL_CAPABILITY.TEXT_GENERATION
      ])
    }
  )
})
