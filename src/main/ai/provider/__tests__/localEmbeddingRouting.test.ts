import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { LocalModelSeeder } from '@main/data/db/seeding/seeders/LocalModelSeeder'
import { modelService } from '@main/data/services/ModelService'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { providerService } from '@main/data/services/ProviderService'
import { LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'

import { resolveRequestEndpoint } from '../endpoint'
import { resolveSdkConfig } from '../sdkConfig'

const dbh = setupTestDatabase()
afterEach(() => {
  vi.restoreAllMocks()
  providerRegistryService.clearCache()
})

it('routes the seeded local embedding model to its in-process adapter without a network endpoint', async () => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()!
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data'
      ? resolve('packages/provider-registry/data', filename ?? '')
      : key === 'app.root'
        ? resolve(filename ?? '')
        : getPath(key, filename)
  )
  providerRegistryService.clearCache()
  new LocalModelSeeder().run(dbh.db)
  const provider = providerService.getByProviderId(LOCAL_EMBEDDING_PROVIDER_ID)
  const model = modelService.getByKey(LOCAL_EMBEDDING_PROVIDER_ID, LOCAL_EMBEDDING_MODEL_ID)

  const { sdkConfig } = await resolveSdkConfig(provider, model, resolveRequestEndpoint(provider, model, 'embedding'))
  expect(sdkConfig).toMatchObject({
    providerId: LOCAL_EMBEDDING_PROVIDER_ID,
    modelId: LOCAL_EMBEDDING_MODEL_ID
  })
  expect(sdkConfig.providerSettings).not.toHaveProperty('baseURL')
  expect(sdkConfig.providerSettings).not.toHaveProperty('apiKey')
  expect(() => resolveRequestEndpoint(provider, model, 'speech')).toThrow('no endpoint')
})
