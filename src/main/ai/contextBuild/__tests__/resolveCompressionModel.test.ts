import { describe, expect, it, vi } from 'vitest'

import { resolveCompressionModel } from '../resolveCompressionModel'

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: vi.fn() }
}))
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: vi.fn() }
}))
vi.mock('@main/ai/provider/config', () => ({ providerToAiSdkConfig: vi.fn() }))
vi.mock('@cherrystudio/ai-core', () => ({ createExecutor: vi.fn() }))

describe('resolveCompressionModel', () => {
  it('returns null for a non-UniqueModelId string', async () => {
    expect(await resolveCompressionModel('not-a-unique-id')).toBeNull()
  })

  it('returns null when provider/model lookup throws', async () => {
    const { providerService } = await import('@main/data/services/ProviderService')
    vi.mocked(providerService.getByProviderId).mockRejectedValueOnce(new Error('no such provider'))
    expect(await resolveCompressionModel('ghost::model-x')).toBeNull()
  })

  // The summarize call is issued against the COMPRESSOR, so callers need its
  // window — budgeting by the chat model's window overflows an explicitly
  // picked small compressor (e.g. 8k compressor while chatting on 128k).
  it('carries the compressor own contextWindow in the descriptor', async () => {
    const { providerService } = await import('@main/data/services/ProviderService')
    const { modelService } = await import('@main/data/services/ModelService')
    const { providerToAiSdkConfig } = await import('@main/ai/provider/config')
    const { createExecutor } = await import('@cherrystudio/ai-core')

    vi.mocked(providerService.getByProviderId).mockReturnValue({ id: 'p' } as never)
    vi.mocked(modelService.getByKey).mockReturnValue({ apiModelId: 'small', contextWindow: 8_000 } as never)
    vi.mocked(providerToAiSdkConfig).mockResolvedValue({ providerId: 'openai', providerSettings: {} } as never)
    const languageModel = { id: 'lm' }
    vi.mocked(createExecutor).mockResolvedValue({ languageModel: async () => languageModel } as never)

    const descriptor = await resolveCompressionModel('p::small')
    expect(descriptor).toEqual({ languageModel, contextWindow: 8_000 })
  })

  it('reports a null window when the compressor row declares none', async () => {
    const { providerService } = await import('@main/data/services/ProviderService')
    const { modelService } = await import('@main/data/services/ModelService')
    const { providerToAiSdkConfig } = await import('@main/ai/provider/config')
    const { createExecutor } = await import('@cherrystudio/ai-core')

    vi.mocked(providerService.getByProviderId).mockReturnValue({ id: 'p' } as never)
    vi.mocked(modelService.getByKey).mockReturnValue({ apiModelId: 'x', contextWindow: undefined } as never)
    vi.mocked(providerToAiSdkConfig).mockResolvedValue({ providerId: 'openai', providerSettings: {} } as never)
    vi.mocked(createExecutor).mockResolvedValue({ languageModel: async () => ({ id: 'lm' }) } as never)

    expect((await resolveCompressionModel('p::x'))?.contextWindow).toBeNull()
  })
})
