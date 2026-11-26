import type { ModelConfig } from './schemas/model'
import type { ProviderModelOverride } from './schemas/provider-models'
import {
  colonVariantTagToHyphen,
  extractParameterSize,
  normalizeModelId,
  normalizeVersionSeparators,
  stripDateSnapshot
} from './utils/normalize'

function canonicalVariantPriority(override: ProviderModelOverride): number {
  const { apiModelId, modelId } = override
  if (!apiModelId || apiModelId === modelId) return 3
  const apiName = normalizeVersionSeparators(apiModelId.slice(apiModelId.lastIndexOf('/') + 1).toLowerCase())
  if (apiName === modelId) return 2
  return stripDateSnapshot(apiName) === modelId ? 1 : 0
}

function prefersCanonicalOffer(candidate: ProviderModelOverride, current: ProviderModelOverride | undefined): boolean {
  if (!current) return true
  const priority = canonicalVariantPriority(candidate) - canonicalVariantPriority(current)
  if (priority !== 0) return priority > 0
  return (candidate.apiModelId ?? candidate.modelId) < (current.apiModelId ?? current.modelId)
}

export class ModelIndex {
  private modelById: Map<string, ModelConfig> = new Map()
  private modelByNormId: Map<string, ModelConfig> = new Map()
  private modelBySizedNorm: Map<string, ModelConfig> = new Map()
  constructor(models: readonly ModelConfig[]) {
    for (const m of models) {
      this.modelById.set(m.id, m)
      const nid = normalizeModelId(m.id)
      if (!this.modelByNormId.has(nid)) {
        this.modelByNormId.set(nid, m)
      }
      const sid = normalizeModelId(m.id, { keepParameterSize: true })
      if (!this.modelBySizedNorm.has(sid)) {
        this.modelBySizedNorm.set(sid, m)
      }
    }
  }

  findModel(modelId: string): ModelConfig | null {
    const exact = this.modelById.get(modelId)
    if (exact) return exact
    if (colonVariantTagToHyphen(modelId) !== modelId) {
      return this.modelBySizedNorm.get(normalizeModelId(modelId, { keepParameterSize: true })) ?? null
    }
    const sizedModelId = normalizeModelId(modelId, { keepParameterSize: true })
    const sizedHit = this.modelBySizedNorm.get(sizedModelId)
    if (sizedHit) return sizedHit
    if (extractParameterSize(sizedModelId)) return null
    return this.modelByNormId.get(normalizeModelId(modelId)) ?? null
  }
}

export class ProviderModelIndex {
  private overrideByKey: Map<string, ProviderModelOverride> = new Map()
  private overrideByNormKey: Map<string, ProviderModelOverride> = new Map()
  private overrideBySizedNormKey: Map<string, ProviderModelOverride> = new Map()
  private overrideByApiKey: Map<string, ProviderModelOverride> = new Map()
  private overrideByNormApiKey: Map<string, ProviderModelOverride> = new Map()
  private overrideBySizedNormApiKey: Map<string, ProviderModelOverride> = new Map()
  private overridesByProvider: Map<string, ProviderModelOverride[]> = new Map()

  constructor(overrides: readonly ProviderModelOverride[]) {
    for (const pm of overrides) {
      const providerOffers = this.overridesByProvider.get(pm.providerId) ?? []
      providerOffers.push(pm)
      this.overridesByProvider.set(pm.providerId, providerOffers)
      if (pm.apiModelId) this.overrideByApiKey.set(`${pm.providerId}::${pm.apiModelId}`, pm)

      // Canonical fallback can reuse metadata from the standard CherryIN offer.
      if (pm.providerId === 'cherryin' && pm.apiModelId && pm.pricing && canonicalVariantPriority(pm) < 2) continue
      const key = `${pm.providerId}::${pm.modelId}`
      if (prefersCanonicalOffer(pm, this.overrideByKey.get(key))) {
        this.overrideByKey.set(key, pm)
      }
      const normKey = `${pm.providerId}::${normalizeModelId(pm.modelId)}`
      if (!this.overrideByNormKey.has(normKey)) {
        this.overrideByNormKey.set(normKey, pm)
      }
      const sizedNormKey = `${pm.providerId}::${normalizeModelId(pm.modelId, { keepParameterSize: true })}`
      if (prefersCanonicalOffer(pm, this.overrideBySizedNormKey.get(sizedNormKey))) {
        this.overrideBySizedNormKey.set(sizedNormKey, pm)
      }
      if (pm.apiModelId) {
        const normApiKey = `${pm.providerId}::${normalizeModelId(pm.apiModelId)}`
        if (!this.overrideByNormApiKey.has(normApiKey)) {
          this.overrideByNormApiKey.set(normApiKey, pm)
        }
        const sizedNormApiKey = `${pm.providerId}::${normalizeModelId(pm.apiModelId, { keepParameterSize: true })}`
        if (!this.overrideBySizedNormApiKey.has(sizedNormApiKey)) {
          this.overrideBySizedNormApiKey.set(sizedNormApiKey, pm)
        }
      }
    }
  }

  findOverride(providerId: string, modelId: string): ProviderModelOverride | null {
    const key = `${providerId}::${modelId}`
    const exact = this.overrideByApiKey.get(key)
    if (exact) return exact

    const fallback = this.findModelOverride(providerId, modelId, key)
    if (fallback?.providerId !== 'cherryin' || !fallback.apiModelId || !fallback.pricing) return fallback
    if (modelId.includes('/')) return null
    return { ...fallback, apiModelId: undefined, pricing: undefined }
  }

  private findModelOverride(providerId: string, modelId: string, key: string): ProviderModelOverride | null {
    const canonical = this.overrideByKey.get(key)
    if (canonical) return canonical

    const sizedModelId = normalizeModelId(modelId, { keepParameterSize: true })
    const sizedNormKey = `${providerId}::${sizedModelId}`
    const sizedHit = this.overrideBySizedNormKey.get(sizedNormKey) ?? this.overrideBySizedNormApiKey.get(sizedNormKey)
    if (sizedHit) return sizedHit
    if (extractParameterSize(sizedModelId)) return null

    const normKey = `${providerId}::${normalizeModelId(modelId)}`
    return this.overrideByNormKey.get(normKey) ?? this.overrideByNormApiKey.get(normKey) ?? null
  }

  getOverridesForProvider(providerId: string): ProviderModelOverride[] {
    return this.overridesByProvider.get(providerId) ?? []
  }
}
