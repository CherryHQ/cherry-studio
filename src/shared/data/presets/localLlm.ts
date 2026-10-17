import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { LocalModelBundleId } from './localModel'

/**
 * Built-in provider for chat models that run on this machine (node-llama-cpp in the
 * `inference.llm` utility process). Separate from `local-embedding`, which serves only
 * the knowledge base. Its model rows exist for the model selector and are enabled only
 * while the model is installed; the files on disk stay the install state.
 */
export const LOCAL_LLM_PROVIDER_ID = 'local-llm' as const
export const LOCAL_LLM_PROVIDER_NAME = 'Local Models' as const

export interface LocalLlmModel {
  /** Also the row's `modelId`, so a request names the bundle that serves it. */
  bundleId: LocalModelBundleId
  name: string
  group: string
  contextWindow: number
}

export const LOCAL_LLM_MODELS = [
  { bundleId: 'qwen3.5-4b-q4_k_m', name: 'Qwen3.5 4B', group: 'Qwen', contextWindow: 65_536 }
] as const satisfies readonly LocalLlmModel[]

export function localLlmUniqueModelId(bundleId: LocalModelBundleId): UniqueModelId {
  return createUniqueModelId(LOCAL_LLM_PROVIDER_ID, bundleId)
}
