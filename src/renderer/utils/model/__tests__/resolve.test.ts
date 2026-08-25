import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { mockDataApiService, MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { mockPreferenceService } from '@test-mocks/renderer/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { readConversationSuggestionsModel } from '../resolve'

const createModel = (apiModelId: string, name: string): Model => ({
  id: `openai::${apiModelId}`,
  providerId: 'openai',
  apiModelId,
  name,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

const dedicatedModel = createModel('suggestions', 'Suggestions')
const defaultModel = createModel('default', 'Default')

describe('readConversationSuggestionsModel', () => {
  beforeEach(() => {
    mockPreferenceService.get.mockReset()
    MockDataApiUtils.resetMocks()
  })

  it('uses the dedicated suggestions model when configured', async () => {
    mockPreferenceService.get.mockImplementation(async (key: string) =>
      key === 'chat.suggestions.model_id' ? dedicatedModel.id : defaultModel.id
    )
    MockDataApiUtils.setCustomResponse(`/models/${dedicatedModel.id}`, 'GET', dedicatedModel)

    await expect(readConversationSuggestionsModel()).resolves.toBe(dedicatedModel)
    expect(mockDataApiService.get).toHaveBeenCalledWith(`/models/${dedicatedModel.id}`)
  })

  it('falls back to the global default model when no dedicated model is configured', async () => {
    mockPreferenceService.get.mockImplementation(async (key: string) =>
      key === 'chat.suggestions.model_id' ? null : defaultModel.id
    )
    MockDataApiUtils.setCustomResponse(`/models/${defaultModel.id}`, 'GET', defaultModel)

    await expect(readConversationSuggestionsModel()).resolves.toBe(defaultModel)
    expect(mockDataApiService.get).toHaveBeenCalledWith(`/models/${defaultModel.id}`)
  })

  it('falls back to the global default model when the dedicated model cannot be resolved', async () => {
    mockPreferenceService.get.mockImplementation(async (key: string) =>
      key === 'chat.suggestions.model_id' ? dedicatedModel.id : defaultModel.id
    )
    mockDataApiService.get.mockImplementation(async (path: string) => {
      if (path === `/models/${defaultModel.id}`) return defaultModel
      throw new Error('Model not found')
    })

    await expect(readConversationSuggestionsModel()).resolves.toBe(defaultModel)
    expect(mockDataApiService.get).toHaveBeenCalledWith(`/models/${dedicatedModel.id}`)
    expect(mockDataApiService.get).toHaveBeenCalledWith(`/models/${defaultModel.id}`)
  })

  it('falls back to the global default model when the dedicated model is not chat-capable', async () => {
    const embeddingModel: Model = {
      ...dedicatedModel,
      capabilities: [MODEL_CAPABILITY.EMBEDDING]
    }
    mockPreferenceService.get.mockImplementation(async (key: string) =>
      key === 'chat.suggestions.model_id' ? embeddingModel.id : defaultModel.id
    )
    mockDataApiService.get.mockImplementation(async (path: string) =>
      path === `/models/${embeddingModel.id}` ? embeddingModel : defaultModel
    )

    await expect(readConversationSuggestionsModel()).resolves.toBe(defaultModel)
    expect(mockDataApiService.get).toHaveBeenCalledWith(`/models/${embeddingModel.id}`)
    expect(mockDataApiService.get).toHaveBeenCalledWith(`/models/${defaultModel.id}`)
  })
})
