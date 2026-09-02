import { createUniqueModelId } from '@shared/data/types/model'

export const CHERRYAI_PROVIDER_ID = 'cherryai' as const
export const CHERRYAI_PROVIDER_NAME = 'CherryAI' as const
export const CHERRY_CLOUD_PROVIDER_ID = 'cherryai-subscription' as const
export const CHERRYAI_DEFAULT_MODEL_ID = 'qwen' as const
export const CHERRYAI_DEFAULT_MODEL_NAME = 'Qwen' as const
export const CHERRYAI_DEFAULT_MODEL_GROUP = 'Qwen' as const
export const CHERRY_CLOUD_MODEL_GROUP = 'Cherry Cloud' as const
export const CHERRYAI_API_BASE_URL = 'https://api.cherry-ai.com' as const
export const CHERRYAI_DEFAULT_UNIQUE_MODEL_ID = createUniqueModelId(CHERRYAI_PROVIDER_ID, CHERRYAI_DEFAULT_MODEL_ID)

export const CHERRY_CLOUD_MODEL_FEATURE = {
  AGENT: 'agent',
  CHAT: 'chat',
  TRANSLATE: 'translate'
} as const
export type CherryCloudModelFeature = (typeof CHERRY_CLOUD_MODEL_FEATURE)[keyof typeof CHERRY_CLOUD_MODEL_FEATURE]

export function isManagedCherryAiProviderId(providerId: string): boolean {
  return providerId === CHERRYAI_PROVIDER_ID
}

export function isManagedCherryProviderId(providerId: string): boolean {
  return isManagedCherryAiProviderId(providerId) || providerId === CHERRY_CLOUD_PROVIDER_ID
}

export function isManagedCherryAiDefaultModel(providerId: string, modelId: string): boolean {
  return providerId === CHERRYAI_PROVIDER_ID && modelId === CHERRYAI_DEFAULT_MODEL_ID
}

export function isManagedCherryCloudModel(providerId: string): boolean {
  return providerId === CHERRY_CLOUD_PROVIDER_ID
}
