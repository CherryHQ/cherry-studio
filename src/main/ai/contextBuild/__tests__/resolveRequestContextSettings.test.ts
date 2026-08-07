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

  // The assistant override's schema is `z.string().min(1)`, so clearing it there
  // yields null. The GLOBAL preference is a plain `string | null` — its schema is
  // generated from classification.json and can't carry that refinement — so an
  // empty string is representable. `??` alone would pass it through to
  // `resolveCompressionModel('')`, which returns null and silently switched
  // compression off; blank must read as "no pick" and use the current model.
  it.each([[''], ['   ']])('treats a blank compress.model_id (%j) as "use the current model"', async (blank) => {
    setPrefs({ modelId: blank })
    await resolveRequestContextSettings(model)
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('openai::gpt-4o')
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

describe('resolveRequestContextSettings — assistant override layer (P2-D)', () => {
  beforeEach(() => mockResolveCompressionModel.mockClear())

  it('lets an assistant compress.modelId beat the global pick', async () => {
    setPrefs({ modelId: 'openai::global-compressor' })
    await resolveRequestContextSettings(model, { compress: { modelId: 'anthropic::assistant-compressor' } })
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('anthropic::assistant-compressor')
  })

  it('lets an assistant disable compression while global keeps it on', async () => {
    setPrefs({ compressEnabled: true })
    const { contextSettings, compressionModel } = await resolveRequestContextSettings(model, {
      compress: { enabled: false }
    })
    expect(contextSettings.compress.enabled).toBe(false)
    expect(mockResolveCompressionModel).not.toHaveBeenCalled()
    expect(compressionModel).toBeNull()
  })

  it('lets an assistant enable compression while global has it off', async () => {
    setPrefs({ compressEnabled: false })
    const { contextSettings } = await resolveRequestContextSettings(model, { compress: { enabled: true } })
    expect(contextSettings.compress.enabled).toBe(true)
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('openai::gpt-4o')
  })

  it('applies an assistant truncateThreshold override', async () => {
    setPrefs({ truncate: 100_000 })
    const { contextSettings } = await resolveRequestContextSettings(model, { truncateThreshold: 4000 })
    expect(contextSettings.truncateThreshold).toBe(4000)
  })

  it.each([
    ['null override', null],
    ['undefined override', undefined]
  ])('inherits globals for %s (identical to no override)', async (_label, override) => {
    setPrefs({ modelId: 'openai::global-compressor', truncate: 100_000 })
    const { contextSettings } = await resolveRequestContextSettings(model, override)
    expect(contextSettings.compress.modelId).toBe('openai::global-compressor')
    expect(contextSettings.truncateThreshold).toBe(100_000)
  })

  it('does not let an assistant modelId of null override the global explicit pick (?? passthrough)', async () => {
    setPrefs({ modelId: 'openai::global-compressor' })
    await resolveRequestContextSettings(model, { compress: { modelId: null } })
    expect(mockResolveCompressionModel).toHaveBeenCalledWith('openai::global-compressor')
  })
})
