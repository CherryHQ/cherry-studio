import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { isCherryAIProviderId } from '@shared/utils/provider'

export const CHERRYIN_PROVIDER_ID = 'cherryin' as const

const CHERRY_TRIAL_PROVIDER_OVERRIDES: Record<string, string> = {
  'Qwen/Qwen3-8B': CHERRYIN_PROVIDER_ID,
  'Qwen/Qwen3-Next-80B-A3B-Instruct': CHERRYIN_PROVIDER_ID
}

function resolveRawModelId(modelId: string, apiModelId?: string | null): string {
  if (apiModelId) return apiModelId
  return isUniqueModelId(modelId) ? parseUniqueModelId(modelId).modelId : modelId
}

export function resolveFreeTrialLinkedProviderId(input: {
  providerId: string | null | undefined
  modelId: string
  apiModelId?: string | null
}): string | undefined {
  if (!isCherryAIProviderId(input.providerId)) return undefined
  return CHERRY_TRIAL_PROVIDER_OVERRIDES[resolveRawModelId(input.modelId, input.apiModelId)]
}
