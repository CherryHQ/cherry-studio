import { CHERRY_PROVIDER_PREFIX, OPENCODE_SCHEMA } from './constants'
import {
  applyManagedJsonSettings,
  applyManagedTomlSettings,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_PERMISSION_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_ENV_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  OPEN_CODE_MANAGED_TOP_LEVEL_KEYS,
  QWEN_MANAGED_SETTINGS_KEYS
} from './managedKeys'
import {
  codexPermissionModeToConfig,
  isCodexPermissionMode,
  isCodexReasoningEffort,
  isOpenCodePermissionMode
} from './permissionModes'
import type { OpenCodeNpmInfo } from './resolvers'
import { sanitizeGeminiConfigBlob, sanitizeKimiConfigBlob, sanitizeQwenConfigBlob } from './sanitize'
import {
  asRecord,
  dropFeatureGoalsIfEmpty,
  isCherryManagedModel,
  normalizeUrl,
  omitKeysByPrefix,
  sanitizeProviderName
} from './values'

const CODEX_MANAGED_TOP_LEVEL_KEY_SET = new Set<string>(CODEX_MANAGED_TOP_LEVEL_KEYS)

interface OpenCodeProviderIdentity {
  id: string
  name: string
}

export function buildClaudeConfig(
  existing: Record<string, any>,
  userBlob: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; writePrimaryModel?: boolean }
): Record<string, any> {
  const configEnv = { ...asRecord(userBlob.env) }
  const envBlock: Record<string, any> = { ...configEnv }
  if (resolved.baseUrl) envBlock.ANTHROPIC_BASE_URL = resolved.baseUrl
  if (resolved.apiKey) envBlock.ANTHROPIC_AUTH_TOKEN = resolved.apiKey
  if (resolved.writePrimaryModel === false) delete envBlock.ANTHROPIC_MODEL
  else if (resolved.model) envBlock.ANTHROPIC_MODEL = resolved.model

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
  const nextPermissions = { ...asRecord(existing.permissions) }
  for (const key of CLAUDE_MANAGED_PERMISSION_KEYS) delete nextPermissions[key]
  const userPermissions = asRecord(userBlob.permissions)
  for (const key of CLAUDE_MANAGED_PERMISSION_KEYS) {
    if (userPermissions[key] !== undefined) nextPermissions[key] = userPermissions[key]
  }
  if (Object.keys(nextPermissions).length > 0) merged.permissions = nextPermissions
  else delete merged.permissions
  merged.env = existingEnv ? { ...existingEnv, ...envBlock } : { ...envBlock }
  return merged
}

export function buildCodexConfig(
  existingToml: Record<string, any>,
  resolved: { baseUrl: string; providerName: string; model: string },
  options: Record<string, any>
): Record<string, any> {
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${resolved.providerName.replace(/\./g, '-')}`
  const preservedProviders = omitKeysByPrefix(asRecord(existingToml.model_providers), CHERRY_PROVIDER_PREFIX)
  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(existingToml)) {
    if (!CODEX_MANAGED_TOP_LEVEL_KEY_SET.has(key)) {
      cleaned[key] = value
    }
  }
  dropFeatureGoalsIfEmpty(cleaned)

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
  if (options.disableResponseStorage === true) merged.disable_response_storage = true
  if (options.goalMode === true) {
    const features = asRecord(merged.features)
    features.goals = true
    merged.features = features
  }
  if (isCodexPermissionMode(options.permissionMode)) {
    Object.assign(merged, codexPermissionModeToConfig(options.permissionMode))
  }
  if (isCodexReasoningEffort(options.reasoningEffort)) merged.model_reasoning_effort = options.reasoningEffort
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
    if (options.reasoning === true) {
      modelConfig.reasoning = true
      modelConfig.options = { thinking: { budgetTokens: 10000, type: 'enabled' } }
    }
    return
  }

  if (npmInfo.providerType === 'google') {
    if (options.reasoning === true) {
      modelConfig.reasoning = true
      modelConfig.options = {
        thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }
      }
    }
    return
  }

  if (options.reasoning === true && options.supportsReasoningEffort === true) {
    modelConfig.reasoning = true
    modelConfig.options = { reasoningEffort: 'medium' }
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
  buildOpenCodeModelOptions(modelConfig, npmInfo, {
    reasoning: options.reasoning === true,
    supportsReasoningEffort: options.supportsReasoningEffort === true
  })
  const preservedProviders = omitKeysByPrefix(asRecord(existing.provider), CHERRY_PROVIDER_PREFIX)
  const cleaned: Record<string, any> = { ...existing }
  for (const key of OPEN_CODE_MANAGED_TOP_LEVEL_KEYS) delete cleaned[key]
  const merged: Record<string, any> = {
    $schema: OPENCODE_SCHEMA,
    ...cleaned,
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
  if (isOpenCodePermissionMode(options.permissionMode)) merged.permission = options.permissionMode
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
  applyManagedJsonSettings(next, sanitizeGeminiConfigBlob(configBlob), GEMINI_MANAGED_SETTINGS_KEYS)
  next.model = { ...asRecord(next.model), name: resolved.model }
  return next
}

export function buildQwenConfig(
  existing: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelLabel: string },
  configBlob: Record<string, any>
): Record<string, any> {
  const sanitizedConfigBlob = sanitizeQwenConfigBlob(configBlob)
  const envKey = 'CHERRY_QWEN_API_KEY'
  const existingModels = Array.isArray(existing.modelProviders?.openai) ? [...existing.modelProviders.openai] : []
  const userModels = existingModels.filter((m) => !isCherryManagedModel(m))
  userModels.push({ id: resolved.model, name: resolved.modelLabel, baseUrl: resolved.baseUrl, envKey })

  const existingEnv = omitKeysByPrefix(asRecord(existing.env), 'CHERRY_')
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
  applyManagedJsonSettings(merged, sanitizedConfigBlob, QWEN_MANAGED_SETTINGS_KEYS)
  return merged
}

export function buildKimiConfig(
  existing: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelKey: string; maxContextSize?: number },
  configBlob: Record<string, any>
): Record<string, any> {
  const sanitizedConfigBlob = sanitizeKimiConfigBlob(configBlob)
  const providerTable = omitKeysByPrefix(asRecord(existing.providers), CHERRY_PROVIDER_PREFIX)
  providerTable[resolved.modelKey] = { type: 'openai', base_url: resolved.baseUrl, api_key: resolved.apiKey }

  const modelsTable = omitKeysByPrefix(asRecord(existing.models), CHERRY_PROVIDER_PREFIX)
  const modelConfig: Record<string, any> = {
    provider: resolved.modelKey,
    model: resolved.model
  }
  if (resolved.maxContextSize !== undefined) modelConfig.max_context_size = resolved.maxContextSize
  modelsTable[resolved.modelKey] = modelConfig

  const merged = { ...existing, default_model: resolved.modelKey, providers: providerTable, models: modelsTable }
  applyManagedTomlSettings(merged, sanitizedConfigBlob)
  return merged
}
