import { describe, expect, it, vi } from 'vitest'

import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'

const list = vi.fn()
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { list: (...a: unknown[]) => list(...a) }
}))

const { buildAutoFallbackModelIds } = await import('../autoFallbackModels')

const id = (value: string) => value as RetryFallbackModelId

const chatModel = (providerId: string, rawId: string): Model =>
  ({
    id: `${providerId}::${rawId}`,
    providerId,
    name: rawId,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    capabilities: [],
    endpointTypes: ['chat']
  }) as unknown as Model

describe('buildAutoFallbackModelIds', () => {
  it('includes a chat model whose last probe passed', () => {
    list.mockReturnValue([chatModel('openai', 'gpt-4o'), chatModel('groq', 'llama-3.1-70b')])
    const health: ModelHealthMemory = { 'openai::gpt-4o': { ok: true, checkedAt: Date.now() } }

    expect(buildAutoFallbackModelIds(health)).toEqual([id('openai::gpt-4o')])
  })

  it('excludes a healthy model once it is disabled (absent from modelService.list)', () => {
    list.mockReturnValue([chatModel('groq', 'llama-3.1-70b')])
    const health: ModelHealthMemory = { 'openai::gpt-4o': { ok: true, checkedAt: Date.now() } }

    expect(buildAutoFallbackModelIds(health)).toEqual([])
  })
})
