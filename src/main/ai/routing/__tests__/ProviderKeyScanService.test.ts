import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createUniqueModelId } from '@shared/data/types/model'

const checkModel = vi.hoisted(() => vi.fn())
const listProviders = vi.hoisted(() => vi.fn())
const listModels = vi.hoisted(() => vi.fn())
const isProviderQuotaExhausted = vi.hoisted(() => vi.fn(() => false))
const recordModelHealth = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('../../../../../tests/__mocks__/main/application')
  const base = mockApplicationFactory()
  const originalGet = base.application.get
  base.application.get = vi.fn((name: string) => (name === 'AiService' ? { checkModel } : originalGet(name)))
  return base
})

vi.mock('@main/data/services/ProviderService', () => ({ providerService: { list: listProviders } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { list: listModels } }))
vi.mock('@main/data/services/apiKeyQuota', () => ({ isProviderQuotaExhausted }))
vi.mock('@main/ai/runtime/aiSdk', () => ({ recordModelHealth }))

const { ProviderKeyScanService } = await import('../ProviderKeyScanService')

const MODEL_ID = createUniqueModelId('deepseek', 'deepseek-chat')
const OTHER_MODEL_ID = createUniqueModelId('deepseek', 'deepseek-reasoner')
const HOURS = 60 * 60 * 1000

function provider(overrides: Partial<{ id: string; apiKeys: Array<{ id: string; isEnabled: boolean }> }> = {}) {
  return { id: 'deepseek', apiKeys: [{ id: 'k1', isEnabled: true }], ...overrides }
}

function model(id = MODEL_ID) {
  return { id, providerId: 'deepseek' }
}

describe('ProviderKeyScanService', () => {
  // `@Injectable` allows one instance per process, so it is built once and re-armed per test.
  const service = new ProviderKeyScanService()

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.background_scan_enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.model_health', {})
    listProviders.mockReturnValue([provider()])
    listModels.mockReturnValue([model()])
    isProviderQuotaExhausted.mockReturnValue(false)
    checkModel.mockResolvedValue({ latency: 200 })
  })

  it('marks a provider unhealthy when its key no longer answers', async () => {
    checkModel.mockRejectedValue(new Error('Insufficient Balance'))

    await service.tick()

    expect(recordModelHealth).toHaveBeenCalledWith(MODEL_ID, false)
  })

  it('records the latency of a key that still answers', async () => {
    await service.tick()

    expect(checkModel).toHaveBeenCalledWith(expect.objectContaining({ uniqueModelId: MODEL_ID }))
    expect(recordModelHealth).toHaveBeenCalledWith(MODEL_ID, true, 200)
  })

  it('spends nothing on a provider that ordinary traffic answered for recently', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.model_health', {
      [MODEL_ID]: { ok: true, checkedAt: Date.now() - 1 * HOURS }
    })

    await service.tick()

    expect(checkModel).not.toHaveBeenCalled()
  })

  it('treats one recently used model as proof the whole account works', async () => {
    listModels.mockReturnValue([model(), model(OTHER_MODEL_ID)])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.model_health', {
      [MODEL_ID]: { ok: true, checkedAt: Date.now() - 1 * HOURS }
    })

    await service.tick()

    expect(checkModel).not.toHaveBeenCalled()
  })

  it('probes the model that has been quiet longest', async () => {
    listModels.mockReturnValue([model(), model(OTHER_MODEL_ID)])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.model_health', {
      [MODEL_ID]: { ok: true, checkedAt: Date.now() - 20 * HOURS },
      [OTHER_MODEL_ID]: { ok: true, checkedAt: Date.now() - 100 * HOURS }
    })

    await service.tick()

    expect(checkModel).toHaveBeenCalledWith(expect.objectContaining({ uniqueModelId: OTHER_MODEL_ID }))
  })

  it('never spends the last request of a provider that is already out of quota', async () => {
    isProviderQuotaExhausted.mockReturnValue(true)

    await service.tick()

    expect(checkModel).not.toHaveBeenCalled()
  })

  it('skips a provider whose only key is switched off', async () => {
    listProviders.mockReturnValue([provider({ apiKeys: [{ id: 'k1', isEnabled: false }] })])

    await service.tick()

    expect(checkModel).not.toHaveBeenCalled()
  })

  it('sends nothing at all when the user turned the scan off', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.background_scan_enabled', false)

    await service.tick()

    expect(checkModel).not.toHaveBeenCalled()
  })

  it('probes one provider per tick so a quiet morning cannot drain a free tier', async () => {
    listProviders.mockReturnValue([
      provider({ id: 'deepseek' }),
      provider({ id: 'openrouter' }),
      provider({ id: 'groq' })
    ])
    listModels.mockImplementation(() => [
      { id: createUniqueModelId('deepseek', 'a'), providerId: 'deepseek' },
      { id: createUniqueModelId('openrouter', 'b'), providerId: 'openrouter' },
      { id: createUniqueModelId('groq', 'c'), providerId: 'groq' }
    ])

    await service.tick()

    expect(checkModel).toHaveBeenCalledTimes(1)
  })
})
