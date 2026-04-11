import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'

export type CapabilityKey = 'vision' | 'reasoning' | 'function_calling' | 'web_search' | 'embedding' | 'rerank'
type RuntimeModelCapability = Model['capabilities'][number]

const CAPABILITY_BY_MODEL_TYPE: Record<CapabilityKey, RuntimeModelCapability> = {
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  rerank: MODEL_CAPABILITY.RERANK
}

export function getCapabilityState(model: Pick<Model, 'capabilities'>, type: CapabilityKey): boolean | undefined {
  if (!model.capabilities || model.capabilities.length === 0) {
    return undefined
  }

  return model.capabilities.includes(CAPABILITY_BY_MODEL_TYPE[type])
}
