/**
 * Shared API key configuration for provider scripts
 * Used by generate-provider-models.ts and inspect-provider-apis.ts
 */

/**
 * Map provider ID to environment variable name
 * Format: {PROVIDER_ID}_API_KEY (uppercase, hyphens → underscores)
 */
export function getApiKeyEnvName(providerId: string): string {
  return `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`
}

/**
 * Special mappings for common provider names
 */
export const API_KEY_ENV_ALIASES: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  aihubmix: ['AIHUBMIX_API_KEY'],
  zhipu: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  dashscope: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
  baichuan: ['BAICHUAN_API_KEY'],
  yi: ['YI_API_KEY', 'LINGYIWANWU_API_KEY'],
  stepfun: ['STEPFUN_API_KEY'],
  doubao: ['DOUBAO_API_KEY', 'ARK_API_KEY'],
  infini: ['INFINI_API_KEY'],
  grok: ['GROK_API_KEY', 'XAI_API_KEY'],
  hyperbolic: ['HYPERBOLIC_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
  github: ['GITHUB_TOKEN', 'GITHUB_API_KEY'],
  poe: ['POE_API_KEY'],
  mimo: ['XIAOMI_API_KEY', 'MIMO_API_KEY'],
  '302ai': ['302AI_API_KEY', 'AI_302_API_KEY'],
  'vercel-gateway': ['VERCEL_API_KEY', 'VERCEL_TOKEN'],
  gateway: ['VERCEL_API_KEY', 'VERCEL_TOKEN'],
  perplexity: ['PERPLEXITY_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  longcat: ['LONGCAT_API_KEY'],
  tokenflux: ['TOKENFLUX_API_KEY'],
  jina: ['JINA_API_KEY'],
  ppio: ['PPIO_API_KEY']
}

/**
 * Get API key for a provider from environment variables
 */
export function getApiKey(providerId: string): string | undefined {
  // Check aliases first
  const aliases = API_KEY_ENV_ALIASES[providerId]
  if (aliases) {
    for (const alias of aliases) {
      const key = process.env[alias]
      if (key) return key
    }
  }

  // Fall back to standard naming: {PROVIDER_ID}_API_KEY
  const standardEnvName = getApiKeyEnvName(providerId)
  return process.env[standardEnvName]
}

/**
 * Get authentication headers for a provider
 */
export function getAuthHeaders(providerId: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {}

  if (!apiKey) return headers

  if (providerId === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (providerId === 'gemini' || providerId === 'google') {
    headers['x-goog-api-key'] = apiKey
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  return headers
}
