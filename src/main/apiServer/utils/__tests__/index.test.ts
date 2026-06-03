import type { Model, Provider } from '@types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/aiCore/provider/providerConfig', () => ({
  formatProviderApiHost: vi.fn((provider: Provider) => Promise.resolve(provider))
}))

vi.mock('@main/services/CacheService', () => ({
  CacheService: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('@main/services/LoggerService', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: vi.fn()
  }
}))

vi.mock('@shared/config/providers', () => ({
  isSiliconAnthropicCompatibleModel: vi.fn(() => false)
}))

import { findProviderForModel, transformModelToOpenAI } from '..'

describe('api server model utilities', () => {
  it('exposes legacy CherryAI models under the CherryIN provider id', () => {
    const model = {
      id: 'agent/glm-5',
      name: 'GLM 5',
      provider: 'cherryai'
    } as Model
    const provider = {
      id: 'cherryin',
      name: 'CherryIN',
      type: 'openai',
      models: [model]
    } as Provider

    const result = transformModelToOpenAI(model, provider)

    expect(result.id).toBe('cherryin:agent/glm-5')
    expect(result.provider).toBe('cherryin')
    expect(result.provider_name).toBe('CherryIN')
  })

  it('resolves legacy CherryAI model lookups to matching CherryIN provider config', () => {
    const providers = [
      {
        id: 'cherryin',
        name: 'CherryIN',
        type: 'openai',
        models: [{ id: 'agent/glm-5', provider: 'cherryai' }]
      }
    ] as Provider[]

    const provider = findProviderForModel(providers, 'cherryai', 'agent/glm-5')

    expect(provider?.id).toBe('cherryin')
  })
})
