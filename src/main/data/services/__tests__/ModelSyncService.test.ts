import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const fetchRemoteProviderModelsMock = vi.fn()
const providerLookupMock = vi.fn()
const providerResolveModelsMock = vi.fn()
const getByProviderIdMock = vi.fn()
const getRotatedApiKeyMock = vi.fn()

vi.mock('../providerModelSync/fetchRemoteProviderModels', () => ({
  fetchRemoteProviderModels: (...args: any[]) => fetchRemoteProviderModelsMock(...args)
}))

vi.mock('../ProviderRegistryService', () => ({
  providerRegistryService: {
    lookupModel: (...args: any[]) => providerLookupMock(...args),
    resolveModels: (...args: any[]) => providerResolveModelsMock(...args)
  }
}))

vi.mock('../ProviderService', () => ({
  providerService: {
    getByProviderId: (...args: any[]) => getByProviderIdMock(...args),
    getRotatedApiKey: (...args: any[]) => getRotatedApiKeyMock(...args)
  }
}))

import { assistantTable } from '@data/db/schemas/assistant'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'

import { modelSyncService } from '../ModelSyncService'

const dbh = setupTestDatabase()

function providerRow(providerId = 'openai') {
  return {
    providerId,
    name: 'OpenAI',
    orderKey: 'a0'
  }
}

function runtimeProvider(providerId = 'openai') {
  return {
    id: providerId,
    name: 'OpenAI',
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://api.openai.com/v1'
      }
    },
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {
      arrayContent: true,
      streamOptions: true,
      developerRole: false,
      serviceTier: false,
      verbosity: false,
      enableThinking: true
    },
    settings: {},
    isEnabled: true
  } as any
}

function remoteModel(modelId: string, name = modelId) {
  return {
    id: createUniqueModelId('openai', modelId),
    providerId: 'openai',
    apiModelId: modelId,
    name,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as const
}

describe('ModelSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainDbServiceUtils.setDb(dbh.db)
    getByProviderIdMock.mockResolvedValue(runtimeProvider())
    getRotatedApiKeyMock.mockResolvedValue('')
    providerLookupMock.mockResolvedValue({
      presetModel: null,
      registryOverride: null,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      reasoningFormatTypes: {}
    })
    providerResolveModelsMock.mockImplementation(async (_providerId: string, modelIds: string[]) =>
      modelIds.map((modelId) => remoteModel(modelId))
    )
  })

  it('applies add plus deprecate actions to the local model table', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow())
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4'),
      providerId: 'openai',
      modelId: 'gpt-4',
      name: 'GPT-4'
    })

    fetchRemoteProviderModelsMock.mockResolvedValue([remoteModel('gpt-5', 'GPT-5')])
    providerLookupMock.mockImplementation(async (_providerId: string, modelId: string) => ({
      presetModel: { id: modelId, name: modelId.toUpperCase() },
      registryOverride: null,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      reasoningFormatTypes: {}
    }))

    const result = await modelSyncService.apply('openai', {
      addModelIds: [createUniqueModelId('openai', 'gpt-5')],
      missing: [{ uniqueModelId: createUniqueModelId('openai', 'gpt-4'), action: 'deprecated' }]
    })

    expect(result).toEqual({
      addedCount: 1,
      deprecatedCount: 1,
      deletedCount: 0
    })

    const rows = await dbh.db.select().from(userModelTable)
    expect(rows.map((row) => row.modelId)).toEqual(expect.arrayContaining(['gpt-4', 'gpt-5']))
    expect(rows.find((row) => row.modelId === 'gpt-4')?.isDeprecated).toBe(true)
  })

  it('rejects delete actions when strong references still exist', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow())
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4'),
      providerId: 'openai',
      modelId: 'gpt-4',
      name: 'GPT-4'
    })
    await dbh.db.insert(assistantTable).values({
      id: 'assistant-1',
      name: 'Assistant',
      modelId: createUniqueModelId('openai', 'gpt-4')
    })
    fetchRemoteProviderModelsMock.mockResolvedValue([])

    await expect(
      modelSyncService.apply('openai', {
        addModelIds: [],
        missing: [{ uniqueModelId: createUniqueModelId('openai', 'gpt-4'), action: 'delete' }]
      })
    ).rejects.toMatchObject({
      status: 400
    })

    const rows = await dbh.db.select().from(userModelTable)
    expect(rows).toHaveLength(1)
  })
})
