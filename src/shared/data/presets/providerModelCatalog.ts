/**
 * Provider model catalog: which providers offer which canonical models,
 * free tier availability, and registration links.
 *
 * Used in Settings > About > System Health for "discover this model from where"
 * and model selection hints.
 */

export interface ProviderModelCatalogEntry {
  /** Canonical model ID (e.g., "deepseek-v3", "qwen2.5-72b") */
  modelId: string
  /** Provider ID in provider registry */
  providerId: string
  /** Whether this provider's free tier includes this model */
  hasFreeAccess: boolean
  /** API model ID at this provider (e.g., "deepseek-ai/DeepSeek-V3" for SiliconFlow) */
  apiModelId: string
  /** Link to sign up / get API key for this provider */
  signupUrl?: string
}

/**
 * Catalog entries: canonical model ↔ provider mappings with free tier status
 * and signup links. Sorted by provider free tier first, then alphabetical.
 *
 * Note: Requires Z1 (model equivalence) to define canonical model IDs.
 * Currently using placeholder model IDs; will be populated once Z1 is complete.
 */
export const PROVIDER_MODEL_CATALOG: ProviderModelCatalogEntry[] = [
  // DeepSeek V3
  {
    modelId: 'deepseek-v3',
    providerId: 'openrouter',
    hasFreeAccess: true,
    apiModelId: 'deepseek/deepseek-chat',
    signupUrl: 'https://openrouter.ai/sign-up'
  },
  {
    modelId: 'deepseek-v3',
    providerId: 'siliconflow',
    hasFreeAccess: true,
    apiModelId: 'deepseek-ai/DeepSeek-V3',
    signupUrl: 'https://cloud.siliconflow.cn/i/MzI5NzAx'
  },
  {
    modelId: 'deepseek-v3',
    providerId: 'deepseek',
    hasFreeAccess: false,
    apiModelId: 'deepseek-chat',
    signupUrl: 'https://platform.deepseek.com'
  },

  // Claude 3.5 Sonnet
  {
    modelId: 'claude-3.5-sonnet',
    providerId: 'anthropic',
    hasFreeAccess: false,
    apiModelId: 'claude-3-5-sonnet-20241022',
    signupUrl: 'https://console.anthropic.com'
  },
  {
    modelId: 'claude-3.5-sonnet',
    providerId: 'openrouter',
    hasFreeAccess: true,
    apiModelId: 'anthropic/claude-3.5-sonnet',
    signupUrl: 'https://openrouter.ai/sign-up'
  },

  // Gemini 2.0 Flash
  {
    modelId: 'gemini-2.0-flash',
    providerId: 'google',
    hasFreeAccess: true,
    apiModelId: 'gemini-2.0-flash',
    signupUrl: 'https://ai.google.dev'
  },
  {
    modelId: 'gemini-2.0-flash',
    providerId: 'openrouter',
    hasFreeAccess: true,
    apiModelId: 'google/gemini-2.0-flash-001',
    signupUrl: 'https://openrouter.ai/sign-up'
  },

  // Qwen 2.5 72B
  {
    modelId: 'qwen-2.5-72b',
    providerId: 'siliconflow',
    hasFreeAccess: true,
    apiModelId: 'Qwen/Qwen2.5-72B-Instruct',
    signupUrl: 'https://cloud.siliconflow.cn/i/MzI5NzAx'
  },
  {
    modelId: 'qwen-2.5-72b',
    providerId: 'openrouter',
    hasFreeAccess: true,
    apiModelId: 'qwen/qwen-2.5-72b-instruct',
    signupUrl: 'https://openrouter.ai/sign-up'
  },

  // Llama 3.3 70B
  {
    modelId: 'llama-3.3-70b',
    providerId: 'groq',
    hasFreeAccess: true,
    apiModelId: 'llama-3.3-70b-versatile',
    signupUrl: 'https://console.groq.com/keys'
  },
  {
    modelId: 'llama-3.3-70b',
    providerId: 'openrouter',
    hasFreeAccess: true,
    apiModelId: 'meta-llama/llama-3.3-70b-instruct',
    signupUrl: 'https://openrouter.ai/sign-up'
  },
  {
    modelId: 'llama-3.3-70b',
    providerId: 'siliconflow',
    hasFreeAccess: true,
    apiModelId: 'meta-llama/Llama-3.3-70B-Instruct',
    signupUrl: 'https://cloud.siliconflow.cn/i/MzI5NzAx'
  }
]

/**
 * Get all providers that offer a canonical model with free tier access
 */
export function getFreeAccessProvidersForModel(modelId: string): ProviderModelCatalogEntry[] {
  return PROVIDER_MODEL_CATALOG.filter((entry) => entry.modelId === modelId && entry.hasFreeAccess)
}

/**
 * Get all canonical models available from a specific provider
 */
export function getCanonicalModelsFromProvider(providerId: string): Array<{ modelId: string; hasFreeAccess: boolean }> {
  const seen = new Set<string>()
  return PROVIDER_MODEL_CATALOG.filter((entry) => entry.providerId === providerId)
    .filter((entry) => {
      if (seen.has(entry.modelId)) return false
      seen.add(entry.modelId)
      return true
    })
    .map((entry) => ({
      modelId: entry.modelId,
      hasFreeAccess: entry.hasFreeAccess
    }))
}

/**
 * Get signup URL for a specific provider-model pair
 */
export function getSignupUrlForModel(modelId: string, providerId: string): string | undefined {
  const entry = PROVIDER_MODEL_CATALOG.find((e) => e.modelId === modelId && e.providerId === providerId)
  return entry?.signupUrl
}
