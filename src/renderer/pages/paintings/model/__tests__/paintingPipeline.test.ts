import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paintingGenerate } from '../paintingPipeline'
import type { GenerateInput } from '../types/generateInput'
import type { PaintingData } from '../types/paintingData'

// paintingGenerate is glue: prefetch the model's image-generation support, resolve
// the effective mode + requirePrompt, and hand them to canonicalGenerate. Mock both
// edges to assert the handoff (the real prefetch/canonicalGenerate are covered
// elsewhere).
const prefetchMock = vi.fn()
vi.mock('@data/hooks/useDataApi', () => ({
  prefetch: (...args: unknown[]) => prefetchMock(...args)
}))

const canonicalGenerateMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [])
vi.mock('../canonicalGenerate', () => ({
  canonicalGenerate: (...args: unknown[]) => canonicalGenerateMock(...args)
}))

function makeInput(overrides: Partial<PaintingData> = {}): GenerateInput {
  const painting: PaintingData = {
    id: 'p1',
    providerId: 'aihubmix',
    mode: 'edit',
    model: 'qwen-image-edit',
    prompt: 'a fox',
    files: [],
    params: {},
    ...overrides
  }
  return {
    painting,
    provider: {
      id: 'aihubmix',
      name: 'AiHubMix',
      apiHost: 'https://example.com',
      isEnabled: true,
      getApiKey: async () => 'api-key'
    } as never,
    tab: 'default',
    abortController: new AbortController()
  }
}

const SUPPORT_KEY = '/providers/:providerId/models/:modelId*/image-generation-support'

describe('paintingGenerate', () => {
  beforeEach(() => {
    prefetchMock.mockReset()
    canonicalGenerateMock.mockClear()
  })

  it('prefetches support and threads support + effective mode + requirePrompt into canonicalGenerate', async () => {
    const support = {
      modes: {
        edit: { requirePrompt: false, supports: { seed: { type: 'text' } }, vendorTransport: { endpoint: '/e' } }
      }
    }
    prefetchMock.mockResolvedValue(support)

    const input = makeInput({ mode: 'edit', model: 'qwen-image-edit' })
    await paintingGenerate(input)

    expect(prefetchMock).toHaveBeenCalledWith(SUPPORT_KEY, {
      params: { providerId: 'aihubmix', modelId: 'qwen-image-edit' }
    })
    expect(canonicalGenerateMock).toHaveBeenCalledWith(input, { requirePrompt: false, support, mode: 'edit' })
  })

  it('falls back to the first declared mode when the tab mode is unsupported', async () => {
    // painting.mode 'edit' → canonicalMode 'edit', but the model only declares 'generate'.
    const support = { modes: { generate: { requirePrompt: true, supports: {} } } }
    prefetchMock.mockResolvedValue(support)

    const input = makeInput({ mode: 'edit', model: 'qwen-image' })
    await paintingGenerate(input)

    expect(canonicalGenerateMock).toHaveBeenCalledWith(input, { requirePrompt: true, support, mode: 'generate' })
  })

  it('passes no options when the model has no id (skips the prefetch handoff)', async () => {
    const input = makeInput({ model: undefined })
    await paintingGenerate(input)

    expect(prefetchMock).not.toHaveBeenCalled()
    expect(canonicalGenerateMock).toHaveBeenCalledWith(input, undefined)
  })

  it('still generates (no options) when the support prefetch fails', async () => {
    prefetchMock.mockRejectedValue(new Error('offline'))

    const input = makeInput({ mode: 'edit', model: 'qwen-image-edit' })
    await paintingGenerate(input)

    expect(canonicalGenerateMock).toHaveBeenCalledWith(input, undefined)
  })
})
