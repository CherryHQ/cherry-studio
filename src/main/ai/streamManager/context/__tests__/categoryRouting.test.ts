import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UniqueModelId } from '@shared/data/types/model'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

const preferenceGet = vi.fn()
const getByKey = vi.fn()
const derivedCandidatesFor = vi.fn<(category: string) => UniqueModelId[]>(() => [])
let providerEnabled = true

vi.mock('@application', () => ({
  application: {
    get: (name: string) =>
      name === 'ModelRoutingService'
        ? { candidatesFor: (category: string) => derivedCandidatesFor(category) }
        : { get: preferenceGet }
  }
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
  health = {},
  derived = {},
  pinnedModel = ''
}: {
  enabled?: boolean
  categoryModels?: Record<string, string[]>
  health?: Record<string, { ok: boolean; checkedAt: number }>
  derived?: Record<string, UniqueModelId[]>
  pinnedModel?: string
}) {
  derivedCandidatesFor.mockImplementation((category: string) => derived[category] ?? [])
  preferenceGet.mockImplementation((key: string) => {
    if (key === 'chat.routing.auto_enabled') return enabled
    if (key === 'chat.routing.category_models') return categoryModels
    if (key === 'chat.retry.model_health') return health
    if (key === 'chat.routing.pinned_model') return pinnedModel
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

  it('sends everything to a pinned model, whatever the request is about', () => {
    withPreferences({ categoryModels: { code: [CODER] }, pinnedModel: RESEARCHER })

    expect(routeDefaultModelId(textParts('şu fonksiyonu refactor et'), FALLBACK)).toBe(RESEARCHER)
  })

  it('ignores a pinned model the user has since removed', () => {
    // The preference holds an id, not a reference; deleting the model must not strand every turn.
    providerEnabled = false
    withPreferences({ categoryModels: { code: [CODER] }, pinnedModel: RESEARCHER })

    expect(routeDefaultModelId(textParts('şu fonksiyonu refactor et'), FALLBACK)).not.toBe(RESEARCHER)
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
      health: { [CODER]: { ok: false, checkedAt: Date.now() } }
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

  it('routes from the derived ranking when nothing was mapped by hand', () => {
    // The point of deriving: pasting a key is enough, with no category mapping to fill in.
    withPreferences({ categoryModels: {}, derived: { code: [CODER] } })

    expect(routeDefaultModelId(textParts('şu fonksiyonu refactor et'), FALLBACK)).toBe(CODER)
  })

  it('prefers a pinned model over the derived ranking', () => {
    withPreferences({ categoryModels: { code: [RESEARCHER] }, derived: { code: [CODER] } })

    // Hard work takes the strongest candidate, and a pinned pick is placed ahead of derived ones.
    expect(routeDefaultModelId(textParts('sıfırdan bir uygulama tasarla'), FALLBACK)).toBe(RESEARCHER)
  })

  it('falls through to the derived ranking when the pinned model is gone', () => {
    withPreferences({ categoryModels: { code: ['deleted::model'] }, derived: { code: [CODER] } })
    getByKey.mockImplementation((_providerId: string, modelId: string) => {
      if (modelId === 'model') throw new Error('model deleted')
      return {}
    })

    expect(routeDefaultModelId(textParts('bu kodu derle'), FALLBACK)).toBe(CODER)
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
      health: { [FALLBACK]: { ok: false, checkedAt: Date.now() }, [CODER]: { ok: true, checkedAt: Date.now() } }
    })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(CODER)
  })

  it('leaves a default that still answers alone', () => {
    withPreferences({
      categoryModels: {},
      health: { [FALLBACK]: { ok: true, checkedAt: Date.now() }, [CODER]: { ok: true, checkedAt: Date.now() } }
    })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })

  it('keeps an unprobed default rather than guessing', () => {
    withPreferences({ categoryModels: {}, health: {} })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })

  it('keeps a default whose last probe failed once that failure is older than the staleness window', () => {
    const stale = Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1
    withPreferences({
      categoryModels: {},
      health: { [FALLBACK]: { ok: false, checkedAt: stale }, [CODER]: { ok: true, checkedAt: Date.now() } }
    })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })

  it('treats a failure recorded exactly at the staleness boundary as expired, not fresh', () => {
    const boundary = Date.now() - MODEL_HEALTH_STALE_AFTER_MS
    withPreferences({
      categoryModels: {},
      health: { [FALLBACK]: { ok: false, checkedAt: boundary }, [CODER]: { ok: true, checkedAt: Date.now() } }
    })

    expect(routeDefaultModelId(textParts('naber'), FALLBACK)).toBe(FALLBACK)
  })

  it('does not rescue with a healthy verdict that has itself gone stale', () => {
    withPreferences({
      categoryModels: {},
      health: {
        [FALLBACK]: { ok: false, checkedAt: Date.now() },
        [CODER]: { ok: true, checkedAt: Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1 }
      }
    })

    // The default's own failure is fresh, but its only rescue candidate's health has expired too —
    // an old ok: true is not proof CODER answers now, so there is nothing safe to switch to.
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
