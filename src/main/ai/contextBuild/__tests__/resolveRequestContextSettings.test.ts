import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrefGet = vi.fn()
vi.mock('@application', () => ({
  application: { get: () => ({ get: mockPrefGet }) }
}))

const mockResolveCompressionModel = vi.fn(async (id: string) => ({ id }) as never)
// Lazy wrapper so the hoisted vi.mock factory doesn't read the const before it initializes.
vi.mock('../resolveCompressionModel', () => ({
  resolveCompressionModel: (id: string) => mockResolveCompressionModel(id)
}))
// resolveContextSettings runs for real — it is a pure 3-layer merge.

import { resolveRequestContextSettings } from '../resolveRequestContextSettings'

/** Wire the mocked PreferenceService to a global-settings snapshot. */
const setPrefs = (
  over: Partial<{ enabled: boolean; truncate: number; compressEnabled: boolean; modelId: string | null }> = {}
) => {
  const map: Record<string, unknown> = {
    'chat.context_settings.enabled': over.enabled ?? true,
    'chat.context_settings.truncate_threshold': over.truncate ?? 100_000,
    'chat.context_settings.compress.enabled': over.compressEnabled ?? true,
    'chat.context_settings.compress.model_id': 'modelId' in over ? over.modelId : null
  }
  mockPrefGet.mockImplementation((k: string) => map[k])
}

const model = { id: 'openai::gpt-4o' } as never

describe('resolveRequestContextSettings — compression-model assembly', () => {
  beforeEach(() => mockResolveCompressionModel.mockClear())

  it('falls back to the request model id when compress.model_id is null', async () => {
    setPrefs({ modelId: null })
    await resolveRequestContextSettings(model)
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('openai::gpt-4o')
  })

  it('uses an explicit compress.model_id when set', async () => {
    setPrefs({ modelId: 'anthropic::claude-x' })
    await resolveRequestContextSettings(model)
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('anthropic::claude-x')
  })

  it('passes an empty compress.model_id straight through (?? does not treat "" as null — CR-009 P2-D note)', async () => {
    setPrefs({ modelId: '' })
    await resolveRequestContextSettings(model)
    // The `??` fallback only replaces null/undefined, so '' reaches resolveCompressionModel,
    // which rejects it as an invalid id and returns null (compression silently off).
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('')
  })

  it('does not resolve a compression model when compression is disabled', async () => {
    setPrefs({ compressEnabled: false })
    const { compressionModel } = await resolveRequestContextSettings(model)
    expect(mockResolveCompressionModel).not.toHaveBeenCalled()
    expect(compressionModel).toBeNull()
  })

  it('does not resolve a compression model when context-build is disabled', async () => {
    setPrefs({ enabled: false })
    const { compressionModel } = await resolveRequestContextSettings(model)
    expect(mockResolveCompressionModel).not.toHaveBeenCalled()
    expect(compressionModel).toBeNull()
  })
})
