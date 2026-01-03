import { CacheService } from '@main/services/CacheService'
import type { Model, Provider } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn()
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: selectMock
  }
}))

import { getProviderByModel, transformModelToOpenAI, validateModelId } from '..'

describe('api server provider alias', () => {
  beforeEach(() => {
    CacheService.clear()
    selectMock.mockReset()
  })

  it('formats model id using provider apiIdentifier when present', () => {
    const provider: Provider = {
      id: 'test-provider-uuid',
      apiIdentifier: 'short',
      type: 'openai',
      name: 'Custom Provider',
      apiKey: 'test-key',
      apiHost: 'https://example.com/v1',
      models: [],
      enabled: true
    }

    const model: Model = {
      id: 'glm-4.6',
      provider: provider.id,
      name: 'glm-4.6',
      group: 'glm'
    }

    const apiModel = transformModelToOpenAI(model, provider)
    expect(apiModel.id).toBe('short:glm-4.6')
    expect(apiModel.provider).toBe('test-provider-uuid')
  })

  it('resolves provider by apiIdentifier for model routing', async () => {
    const provider: Provider = {
      id: 'test-provider-uuid',
      apiIdentifier: 'short',
      type: 'openai',
      name: 'Custom Provider',
      apiKey: 'test-key',
      apiHost: 'https://example.com/v1',
      models: [],
      enabled: true
    }

    selectMock.mockResolvedValue([provider])

    const resolved = await getProviderByModel('short:glm-4.6')
    expect(resolved?.id).toBe('test-provider-uuid')
  })

  it('validates model ids with apiIdentifier prefix', async () => {
    const provider: Provider = {
      id: 'test-provider-uuid',
      apiIdentifier: 'short',
      type: 'openai',
      name: 'Custom Provider',
      apiKey: 'test-key',
      apiHost: 'https://example.com/v1',
      models: [
        {
          id: 'glm-4.6',
          provider: 'test-provider-uuid',
          name: 'glm-4.6',
          group: 'glm'
        }
      ],
      enabled: true
    }

    selectMock.mockResolvedValue([provider])

    const result = await validateModelId('short:glm-4.6')
    expect(result.valid).toBe(true)
    expect(result.provider?.id).toBe('test-provider-uuid')
    expect(result.modelId).toBe('glm-4.6')
  })

  it('still supports provider.id prefix', async () => {
    const provider: Provider = {
      id: 'test-provider-uuid',
      apiIdentifier: 'short',
      type: 'openai',
      name: 'Custom Provider',
      apiKey: 'test-key',
      apiHost: 'https://example.com/v1',
      models: [
        {
          id: 'glm-4.6',
          provider: 'test-provider-uuid',
          name: 'glm-4.6',
          group: 'glm'
        }
      ],
      enabled: true
    }

    selectMock.mockResolvedValue([provider])

    const result = await validateModelId('test-provider-uuid:glm-4.6')
    expect(result.valid).toBe(true)
    expect(result.provider?.id).toBe('test-provider-uuid')
    expect(result.modelId).toBe('glm-4.6')
  })
})
