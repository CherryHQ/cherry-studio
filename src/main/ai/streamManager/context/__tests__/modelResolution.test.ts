import { createUniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getByKeyMock } = vi.hoisted(() => ({
  getByKeyMock: vi.fn()
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: getByKeyMock }
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: { getById: vi.fn() }
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: { getChildrenByParentId: vi.fn() }
}))

import { resolveModels } from '../modelResolution'

describe('resolveModels', () => {
  beforeEach(() => {
    getByKeyMock.mockReset()
    getByKeyMock.mockImplementation((providerId: string, modelId: string) => ({
      id: createUniqueModelId(providerId, modelId),
      providerId,
      apiModelId: modelId,
      name: modelId,
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }))
  })

  it('shares one reasoning config cache across mentioned models', () => {
    const models = resolveModels(
      [createUniqueModelId('openai', 'gpt-4o'), createUniqueModelId('openai', 'o3')],
      createUniqueModelId('openai', 'gpt-4o')
    )

    expect(models).toHaveLength(2)
    const firstCache = getByKeyMock.mock.calls[0][2]
    expect(firstCache).toBeInstanceOf(Map)
    expect(getByKeyMock.mock.calls[1][2]).toBe(firstCache)
  })
})
