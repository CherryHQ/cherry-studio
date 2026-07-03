import { CHERRY_PREFIX, CHERRY_PROVIDER_PREFIX, OPENCODE_SCHEMA } from './constants'
import {
  applyManagedJsonSettings,
  applyManagedTomlSettings,
  asRecord,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_ENV_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  QWEN_MANAGED_SETTINGS_KEYS
} from './managedKeys'
import type { OpenCodeNpmInfo } from './resolvers'
import { normalizeUrl, sanitizeProviderName } from './values'

interface OpenCodeProviderIdentity {
  id: string
  name: string
}

export function buildClaudeConfig(
  existing: Record<string, any>,
  userBlob: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string }
): Record<string, any> {
  const configEnv = userBlob.env && typeof userBlob.env === 'object' ? { ...(userBlob.env as Record<string, any>) } : {}
  const envBlock: Record<string, any> = { ...configEnv }
  if (resolved.baseUrl) envBlock.ANTHROPIC_BASE_URL = resolved.baseUrl
  if (resolved.apiKey) envBlock.ANTHROPIC_AUTH_TOKEN = resolved.apiKey
  if (resolved.model) envBlock.ANTHROPIC_MODEL = resolved.model

  const existingEnv =
    existing.env && typeof existing.env === 'object' ? { ...(existing.env as Record<string, any>) } : null
  if (existingEnv) {
    for (const key of CLAUDE_MANAGED_ENV_KEYS) {
      if (!(key in envBlock)) delete existingEnv[key]
    }
  }

  const merged: Record<string, any> = { ...existing, ...userBlob }
  for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) {
    if (!(key in userBlob)) delete merged[key]
  }
  merged.env = existingEnv ? { ...existingEnv, ...envBlock } : { ...envBlock }
  return merged
}

export function buildCodexConfig(
  existingToml: Record<string, any>,
  resolved: { baseUrl: string; providerName: string; model: string },
  options: Record<string, any>
): Record<string, any> {
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${resolved.providerName.replace(/\./g, '-')}`
  const existingProviders =
    existingToml.model_providers && typeof existingToml.model_providers === 'object' ? existingToml.model_providers : {}
  const preservedProviders = Object.fromEntries(
    Object.entries(existingProviders).filter(([key]) => !key.startsWith(CHERRY_PROVIDER_PREFIX))
  )
  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(existingToml)) {
    if (!CODEX_MANAGED_TOP_LEVEL_KEYS.includes(key as (typeof CODEX_MANAGED_TOP_LEVEL_KEYS)[number])) {
      cleaned[key] = value
    }
  }
  if (cleaned.features && typeof cleaned.features === 'object') {
    const features = { ...(cleaned.features as Record<string, any>) }
    delete features.goals
    if (Object.keys(features).length === 0) delete cleaned.features
    else cleaned.features = features
  }

  const merged: Record<string, any> = {
    ...cleaned,
    model: resolved.model,
    model_provider: providerKey,
    model_providers: {
      ...preservedProviders,
      [providerKey]: {
        name: options.remoteCompaction === true ? 'OpenAI' : resolved.providerName,
        base_url: normalizeUrl(resolved.baseUrl),
        wire_api: 'responses',
        requires_openai_auth: true
      }
    }
  }
  if (typeof options.modelReasoningEffort === 'string') merged.model_reasoning_effort = options.modelReasoningEffort
  if (options.disableResponseStorage === true) merged.disable_response_storage = true
  if (typeof options.modelVerbosity === 'string') merged.model_verbosity = options.modelVerbosity
  if (typeof options.modelContextWindow === 'number') merged.model_context_window = options.modelContextWindow
  if (typeof options.modelAutoCompactTokenLimit === 'number') {
    merged.model_auto_compact_token_limit = options.modelAutoCompactTokenLimit
  }
  if (typeof options.personality === 'string') merged.personality = options.personality
  if (options.goalMode === true) {
    const features = asRecord(merged.features)
    features.goals = true
    merged.features = features
  }
  return merged
}

export function buildCodexAuthConfig(existingAuth: Record<string, any>, apiKey: string): Record<string, any> {
  return { ...existingAuth, OPENAI_API_KEY: apiKey }
}

function buildOpenCodeModelOptions(
  modelConfig: Record<string, any>,
  npmInfo: OpenCodeNpmInfo,
  options: Record<string, any>
): void {
  if (npmInfo.providerType === 'anthropic') {
    if (options.reasoning === true || typeof options.thinkingBudgetTokens === 'number') {
      modelConfig.reasoning = true
      modelConfig.options = { thinking: { budgetTokens: options.thinkingBudgetTokens ?? 10000, type: 'enabled' } }
    }
    return
  }

  if (npmInfo.providerType === 'google') {
    if (options.reasoning === true) {
      modelConfig.reasoning = true
      modelConfig.options = {
        thinkingConfig: { includeThoughts: true, thinkingBudget: options.thinkingBudgetTokens ?? -1 }
      }
    }
    return
  }

  if (options.reasoning === true && options.supportsReasoningEffort === true) {
    modelConfig.reasoning = true
    modelConfig.options = { reasoningEffort: options.reasoningEffort || 'medium' }
  } else if (typeof options.reasoningEffort === 'string') {
    modelConfig.options = { reasoningEffort: options.reasoningEffort }
  }
}

export function buildOpenCodeConfig(
  existing: Record<string, any>,
  provider: OpenCodeProviderIdentity,
  npmInfo: OpenCodeNpmInfo,
  resolved: { apiKey: string; baseUrl: string; model: string },
  options: Record<string, any>
): Record<string, any> {
  const providerName = sanitizeProviderName(provider.name, provider.id)
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`
  const modelConfig: Record<string, any> = { name: resolved.model }
  buildOpenCodeModelOptions(modelConfig, npmInfo, options)
  const existingProviders = existing.provider && typeof existing.provider === 'object' ? existing.provider : {}
  const preservedProviders = Object.fromEntries(
    Object.entries(existingProviders).filter(([key]) => !key.startsWith(CHERRY_PROVIDER_PREFIX))
  )
  const merged: Record<string, any> = {
    $schema: OPENCODE_SCHEMA,
    ...existing,
    provider: {
      ...preservedProviders,
      [providerKey]: {
        npm: npmInfo.npm,
        name: providerKey,
        options: { apiKey: resolved.apiKey, baseURL: resolved.baseUrl },
        models: { [resolved.model]: modelConfig }
      }
    }
  }
  if (options.autoCompact === true) merged.autoCompact = true
  if (typeof options.maxTurns === 'number') merged.maxTurns = options.maxTurns
  return merged
}

export function buildGeminiEnvConfig(
  envMap: Map<string, string>,
  resolved: { apiKey: string; baseUrl: string }
): Map<string, string> {
  const next = new Map(envMap)
  for (const key of GEMINI_MANAGED_ENV_KEYS) next.delete(key)
  if (resolved.apiKey) next.set('GEMINI_API_KEY', resolved.apiKey)
  if (resolved.baseUrl) next.set('GOOGLE_GEMINI_BASE_URL', resolved.baseUrl)
  return next
}

export function buildGeminiSettingsConfig(
  settings: Record<string, any>,
  resolved: { model: string },
  configBlob: Record<string, any>
): Record<string, any> {
  const next = { ...settings }
  applyManagedJsonSettings(next, configBlob, GEMINI_MANAGED_SETTINGS_KEYS)
  next.model = { ...asRecord(next.model), name: resolved.model }
  return next
}

export function buildQwenConfig(
  existing: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelLabel: string },
  configBlob: Record<string, any>
): Record<string, any> {
  const envKey = 'CHERRY_QWEN_API_KEY'
  const existingModels = Array.isArray(existing.modelProviders?.openai) ? [...existing.modelProviders.openai] : []
  const userModels = existingModels.filter(
    (m) => !(m && typeof m === 'object' && typeof m.envKey === 'string' && m.envKey.startsWith('CHERRY_'))
  )
  userModels.push({ id: resolved.model, name: resolved.modelLabel, baseUrl: resolved.baseUrl, envKey })

  const existingEnv =
    existing.env && typeof existing.env === 'object' ? { ...(existing.env as Record<string, any>) } : {}
  for (const key of Object.keys(existingEnv)) {
    if (key.startsWith('CHERRY_')) delete existingEnv[key]
  }
  existingEnv[envKey] = resolved.apiKey

  const merged = {
    ...existing,
    modelProviders: { ...existing.modelProviders, openai: userModels },
    env: existingEnv,
    security: {
      ...existing.security,
      auth: { ...existing.security?.auth, selectedType: 'openai' }
    },
    model: { name: resolved.model }
  }
  applyManagedJsonSettings(merged, configBlob, QWEN_MANAGED_SETTINGS_KEYS)
  return merged
}

export function buildKimiConfig(
  existing: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelKey: string; maxContextSize?: number },
  configBlob: Record<string, any>
): Record<string, any> {
  const providerTable = { ...asRecord(existing.providers) }
  for (const key of Object.keys(providerTable)) {
    if (key.startsWith(CHERRY_PREFIX)) delete providerTable[key]
  }
  providerTable[resolved.modelKey] = { type: 'openai', base_url: resolved.baseUrl, api_key: resolved.apiKey }

  const modelsTable = { ...asRecord(existing.models) }
  for (const key of Object.keys(modelsTable)) {
    if (key.startsWith(CHERRY_PREFIX)) delete modelsTable[key]
  }
  const modelConfig: Record<string, any> = {
    provider: resolved.modelKey,
    model: resolved.model
  }
  if (resolved.maxContextSize !== undefined) modelConfig.max_context_size = resolved.maxContextSize
  modelsTable[resolved.modelKey] = modelConfig

  const merged = { ...existing, default_model: resolved.modelKey, providers: providerTable, models: modelsTable }
  applyManagedTomlSettings(merged, configBlob)
  return merged
}
