import type { Model, Provider, Usage } from '@renderer/types'
import type { LanguageModelUsage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trackTokenUsage } from '../analytics'

vi.mock('@renderer/services/ProviderService', () => ({
  getProviderById: vi.fn()
}))

vi.mock('@renderer/types', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    isSystemProvider: vi.fn()
  }
})

import { getProviderById } from '@renderer/services/ProviderService'
import { isSystemProvider } from '@renderer/types'

describe('trackTokenUsage', () => {
  const mockTrackTokenUsage = vi.fn()
  const mockGetProviderById = vi.mocked(getProviderById)
  const mockIsSystemProvider = vi.mocked(isSystemProvider)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      api: { analytics: { trackTokenUsage: mockTrackTokenUsage } }
    })
    // Default: system provider
    mockGetProviderById.mockReturnValue({ id: 'openai', isSystem: true } as Provider)
    mockIsSystemProvider.mockReturnValue(true)
  })

  const createModel = (provider: string, id: string): Model => ({ provider, id }) as Model

  const createUsage = (prompt: number, completion: number): Usage => ({
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion
  })

  it('should track OpenAI format usage', () => {
    trackTokenUsage({ usage: createUsage(100, 50), model: createModel('openai', 'gpt-4') })

    expect(mockTrackTokenUsage).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4',
      input_tokens: 100,
      output_tokens: 50
    })
  })

  it('should track AI SDK format usage', () => {
    mockGetProviderById.mockReturnValue({ id: 'anthropic', isSystem: true } as Provider)
    const usage: LanguageModelUsage = { inputTokens: 200, outputTokens: 100, totalTokens: 300 }

    trackTokenUsage({ usage, model: createModel('anthropic', 'claude-3') })

    expect(mockTrackTokenUsage).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-3',
      input_tokens: 200,
      output_tokens: 100
    })
  })

  it('should not track when usage or model is invalid', () => {
    trackTokenUsage({ usage: undefined, model: createModel('openai', 'gpt-4') })
    trackTokenUsage({ usage: createUsage(100, 50), model: undefined })
    trackTokenUsage({ usage: createUsage(0, 0), model: createModel('openai', 'gpt-4') })

    expect(mockTrackTokenUsage).not.toHaveBeenCalled()
  })

  describe('getProviderTrackId', () => {
    it('should return "unknown" when provider not found', () => {
      mockGetProviderById.mockReturnValue(undefined)

      trackTokenUsage({ usage: createUsage(100, 50), model: createModel('test', 'model') })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'unknown' }))
    })

    it('should return provider.id for system providers', () => {
      mockGetProviderById.mockReturnValue({ id: 'anthropic', isSystem: true } as Provider)
      mockIsSystemProvider.mockReturnValue(true)

      trackTokenUsage({ usage: createUsage(100, 50), model: createModel('anthropic', 'claude') })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic' }))
    })

    it('should extract hostname from apiHost for custom providers', () => {
      mockGetProviderById.mockReturnValue({
        id: 'custom',
        apiHost: 'https://api.example.com/v1/chat'
      } as Provider)
      mockIsSystemProvider.mockReturnValue(false)

      trackTokenUsage({ usage: createUsage(100, 50), model: createModel('custom', 'model') })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'api.example.com' }))
    })

    it('should fallback to name/id when apiHost is invalid', () => {
      mockGetProviderById.mockReturnValue({
        id: 'custom',
        name: 'My Provider',
        apiHost: 'invalid-url'
      } as Provider)
      mockIsSystemProvider.mockReturnValue(false)

      trackTokenUsage({ usage: createUsage(100, 50), model: createModel('custom', 'model') })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'My Provider' }))
    })

    it('should fallback to name when no apiHost', () => {
      mockGetProviderById.mockReturnValue({
        id: 'custom',
        name: 'Local Provider'
      } as Provider)
      mockIsSystemProvider.mockReturnValue(false)

      trackTokenUsage({ usage: createUsage(100, 50), model: createModel('custom', 'model') })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'Local Provider' }))
    })

    it('should fallback to id when no apiHost and no name', () => {
      mockGetProviderById.mockReturnValue({ id: 'custom-id' } as Provider)
      mockIsSystemProvider.mockReturnValue(false)

      trackTokenUsage({ usage: createUsage(100, 50), model: createModel('custom-id', 'model') })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'custom-id' }))
    })
  })
})
