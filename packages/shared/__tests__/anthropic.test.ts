import Anthropic from '@anthropic-ai/sdk'
import type { Provider } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSdkClient } from '../anthropic'

vi.mock('@anthropic-ai/sdk', () => {
  const AnthropicMock = vi.fn()
  return {
    default: AnthropicMock
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@types', () => ({}))

const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'new-api',
  type: 'anthropic',
  name: 'New API',
  apiKey: 'test-key',
  apiHost: 'http://localhost:3000/v1',
  anthropicApiHost: 'https://example.newapi.dev/anthropic/v1',
  models: [],
  isSystem: true,
  ...overrides
})

describe('getSdkClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers anthropicApiHost for mixed new-api providers even when type is anthropic', () => {
    const provider = createProvider()

    getSdkClient(provider)

    expect(vi.mocked(Anthropic)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.newapi.dev/anthropic/v1'
      })
    )
  })

  it('keeps apiHost for official anthropic providers', () => {
    const provider = createProvider({
      id: 'anthropic',
      type: 'anthropic',
      apiHost: 'https://api.anthropic.com/v1',
      anthropicApiHost: 'https://custom.invalid/v1'
    })

    getSdkClient(provider)

    expect(vi.mocked(Anthropic)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.anthropic.com/v1'
      })
    )
  })
})
