import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { UpdateModelSchema } from '@shared/data/api/schemas/models'

const dbh = setupTestDatabase()

beforeEach(() => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()!
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data'
      ? resolve('packages/provider-registry/data', filename ?? '')
      : key === 'app.root'
        ? resolve(filename ?? '')
        : getPath(key, filename)
  )
  providerRegistryService.clearCache()
  for (const [providerId, endpoint] of [
    ['google-relay', 'google-generate-content'],
    ['openai-relay', 'openai-chat-completions']
  ] as const) {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId,
        name: providerId,
        orderKey: 'a0',
        defaultChatEndpoint: endpoint,
        endpointConfigs: {
          [endpoint]: {
            baseUrl: 'https://relay.example/v1',
            adapterFamily: endpoint === 'google-generate-content' ? 'google' : 'openai'
          }
        }
      })
      .run()
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  providerRegistryService.clearCache()
})

function create(providerId: string, modelId: string) {
  return modelService.create([
    { dto: { providerId, modelId }, registryData: providerRegistryService.lookupModel(providerId, modelId) }
  ])[0]
}

function stored(id: string) {
  return dbh.db.select().from(userModelTable).where(eq(userModelTable.id, id)).get()!
}

describe('model defaults and explicit overrides', () => {
  it.each([
    ['google-relay', 'gemini-2.5-flash-image', 'image-generation', 'google-generate-content'],
    ['openai-relay', 'tts-1', 'audio-generation', 'openai-text-to-speech'],
    ['openai-relay', 'text-embedding-3-small', 'embedding', 'openai-embeddings']
  ])('uses the same defaults for preview and creation: %s / %s', (providerId, modelId, capability, endpoint) => {
    const [preview] = providerRegistryService.resolveModels(providerId, [modelId])
    const created = create(providerId, modelId)
    const loaded = modelService.getByKey(providerId, modelId)
    expect(loaded).toMatchObject({
      apiModelId: modelId,
      capabilities: expect.arrayContaining([capability]),
      endpointTypes: [endpoint]
    })
    expect(created.capabilities).toEqual(preview.capabilities)
    expect(loaded.endpointTypes).toEqual(preview.endpointTypes)
    expect(stored(created.id)).toMatchObject({
      capabilities: null,
      endpointTypes: null,
      inputModalitiesExplicit: false
    })
  })

  it('preserves clearing and resets only selected fields back to live defaults', () => {
    const model = create('openai-relay', 'tts-1')
    modelService.update('openai-relay', 'tts-1', { capabilities: [], inputModalities: [], name: 'My voice' })
    expect(modelService.getByKey('openai-relay', 'tts-1').capabilities).toEqual([])
    const reset = modelService.update('openai-relay', 'tts-1', { resetFields: ['capabilities', 'inputModalities'] })
    expect(reset).toMatchObject({ name: 'My voice', capabilities: ['audio-generation'], inputModalities: ['text'] })
    expect(stored(model.id)).toMatchObject({
      capabilities: null,
      inputModalities: null,
      inputModalitiesExplicit: false
    })
  })

  it('rejects contradictory and unknown-model resets without partial writes', () => {
    create('openai-relay', 'opaque-model')
    expect(UpdateModelSchema.safeParse({ capabilities: [], resetFields: ['capabilities'] }).success).toBe(false)
    expect(() =>
      modelService.update('openai-relay', 'opaque-model', { name: 'Changed', resetFields: ['capabilities'] })
    ).toThrow()
    expect(modelService.getByKey('openai-relay', 'opaque-model').name).toBe('opaque-model')
  })

  it('does not force Google transport onto an OpenAI-compatible Gemini deployment', () => {
    const model = create('openai-relay', 'gemini-2.5-flash')
    expect(model.endpointTypes).toEqual(['openai-chat-completions'])
    expect(model.apiModelId).toBe('gemini-2.5-flash')
  })

  it('resolves each batch item independently and rolls back a batch containing an invalid reset', () => {
    const providerId = 'openai-relay'
    const ids = ['tts-1', 'text-embedding-3-small', 'opaque-model']
    const defaults = providerRegistryService.lookupModels(providerId, ids)
    const models = modelService.create(
      ids.map((modelId, index) => ({ dto: { providerId, modelId }, registryData: defaults[index] }))
    )
    expect(models.map((model) => model.capabilities)).toEqual([['audio-generation'], ['embedding'], []])
    modelService.update(providerId, 'tts-1', { capabilities: [] })
    expect(() =>
      modelService.bulkUpdate([
        { providerId, modelId: 'tts-1', patch: { resetFields: ['capabilities'] } },
        { providerId, modelId: 'opaque-model', patch: { resetFields: ['capabilities'] } }
      ])
    ).toThrow()
    expect(modelService.getByKey(providerId, 'tts-1').capabilities).toEqual([])
    expect(stored(models[0].id).capabilities).toEqual([])
  })
})
