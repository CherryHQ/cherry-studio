import type { ModelConfig } from '../src/schemas/model'
import type { ProviderModelOverride } from '../src/schemas/provider-models'
import { modelMatchId } from '../src/utils/modelMatchId'

/** Browser-safe projection of the same records written to models.json and provider-models.json. */
export function buildRequestPoliciesGen(models: ModelConfig[], overrides: ProviderModelOverride[]): string {
  const modelIndex = new Map(models.map((model) => [model.id, model]))
  const entries: Record<string, unknown> = {}
  const project = (model?: ModelConfig, override?: ProviderModelOverride) => ({
    ...(model?.parameterSupport || override?.parameterSupport
      ? { parameterSupport: { ...model?.parameterSupport, ...override?.parameterSupport } }
      : {}),
    ...(model?.messageCompatibility || override?.messageCompatibility
      ? { messages: { ...model?.messageCompatibility, ...override?.messageCompatibility } }
      : {})
  })
  for (const model of models) {
    const policy = project(model)
    if (Object.keys(policy).length) entries[model.id] = policy
  }
  for (const override of overrides) {
    const model = modelIndex.get(override.modelId)
    const policy = project(model, override)
    if (!Object.keys(policy).length) continue
    entries[`${override.providerId}/${modelMatchId(override.apiModelId ?? override.modelId)}`] = policy
    if (!override.apiModelId || modelMatchId(override.apiModelId) === override.modelId) {
      entries[`${override.providerId}/${override.modelId}`] = policy
    }
  }
  return `// Generated from the catalog. Do not edit.
import type { ModelConfig } from '../schemas/model'
import type { MessageCompatibility } from '../schemas/requestPolicy'

export const REQUEST_POLICIES: Record<string, { parameterSupport?: Partial<NonNullable<ModelConfig['parameterSupport']>>; messages?: MessageCompatibility }> = ${JSON.stringify(Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))), null, 2)}
`
}
