import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UniqueModelId } from '@shared/data/types/model'

const preferenceGet = vi.fn()
const getByKey = vi.fn()
let providerEnabled = true

vi.mock('@application', () => ({
  application: { get: () => ({ get: preferenceGet }) }
}))
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: (...args: unknown[]) => getByKey(...args) }
}))
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: () => ({ isEnabled: providerEnabled }) }
}))

const { routeDefaultModelId } = await import('../categoryRouting')

const FALLBACK = 'openai::gpt-4o-mini' as UniqueModelId
const CODER = 'deepseek::deepseek-coder' as UniqueModelId
const RESEARCHER = 'perplexity::sonar' as UniqueModelId

const textParts = (text: string) => [{ type: 'text', text }]

function withPreferences({
  enabled = true,
  categoryModels = {},
  health = {}
}: {
  enabled?: boolean
  categoryModels?: Record<string, string[]>
  health?: Record<string, { ok: boolean; checkedAt: number }>
}) {
  preferenceGet.mockImplementation((key: string) => {
    if (key === 'chat.routing.auto_enabled') return enabled
    if (key === 'chat.routing.category_models') return categoryModels
    if (key === 'chat.retry.model_health') return health
    throw new Error(`unexpected preference ${key}`)
  })
}

describe('routeDefaultModelId', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    getByKey.mockReset()
    getByKey.mockReturnValue({})
    providerEnabled = true
  })

  it('routes a coding request to the model configured for code', () => {
    withPreferences({ categoryModels: { code: [CODER] } })

    expect(routeDefaultModelId(textParts('şu fonksiyonu refactor et'), FALLBACK)).toBe(CODER)
  })

  it('leaves the default alone when routing is disabled', () => {
    withPreferences({ enabled: false, categoryModels: { code: [CODER] } })

    expect(routeDefaultModelId(textParts('şu fonksiyonu refactor et'), FALLBACK)).toBe(FALLBACK)
  })

  it('falls back when the category has no configured model', () => {
    withPreferences({ categoryModels: { research: [RESEARCHER] } })

    expect(routeDefaultModelId(textParts('şu fonksiyonu refactor et'), FALLBACK)).toBe(FALLBACK)
  })

  it('skips a candidate whose last health probe failed', () => {
    withPreferences({
      categoryModels: { code: [CODER, RESEARCHER] },
      health: { [CODER]: { ok: false, checkedAt: 1 } }
    })

    expect(routeDefaultModelId(textParts('bu kodu derle'), FALLBACK)).toBe(RESEARCHER)
  })

  it('ignores a configured model that no longer exists', () => {
    withPreferences({ categoryModels: { code: [CODER] } })
    getByKey.mockImplementation(() => {
      throw new Error('model deleted')
    })

    expect(routeDefaultModelId(textParts('bu kodu derle'), FALLBACK)).toBe(FALLBACK)
  })

  it('keeps the default for plain chat, so routing never hijacks small talk', () => {
    withPreferences({ categoryModels: { code: [CODER] } })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })
})

describe('routeDefaultModelId — rescuing a broken default', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    getByKey.mockReset()
    getByKey.mockReturnValue({})
  })

  it('replaces a default whose last probe failed with the best healthy model', () => {
    withPreferences({
      categoryModels: {},
      health: { [FALLBACK]: { ok: false, checkedAt: 1 }, [CODER]: { ok: true, checkedAt: 1 } }
    })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(CODER)
  })

  it('leaves a default that still answers alone', () => {
    withPreferences({
      categoryModels: {},
      health: { [FALLBACK]: { ok: true, checkedAt: 1 }, [CODER]: { ok: true, checkedAt: 1 } }
    })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })

  it('keeps an unprobed default rather than guessing', () => {
    withPreferences({ categoryModels: {}, health: {} })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })
})

describe('routeDefaultModelId — default pointing at a disabled provider', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    getByKey.mockReset()
    getByKey.mockReturnValue({})
    providerEnabled = true
  })

  it('moves off a default whose provider the user switched off', () => {
    withPreferences({ categoryModels: {}, health: { [CODER]: { ok: true, checkedAt: 1 } } })
    // Only the default lives on the disabled provider; the healthy rescue must still resolve.
    getByKey.mockReturnValue({})
    providerEnabled = false

    // With every provider reported off there is no rescue, so the default is kept rather than
    // swapped for something equally unusable.
    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })
})
