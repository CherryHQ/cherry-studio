import { CHERRY_PROVIDER_PREFIX, OPENCODE_SCHEMA } from './constants'
import {
  applyManagedJsonSettings,
  applyWritableTomlSettings,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_PERMISSION_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  applyCodexOptions,
  applyOpenCodeOptions,
  QWEN_WRITABLE_SETTINGS_KEYS
} from './managedKeys'
import type { OpenCodeNpmInfo, PiApi } from './resolvers'
import { sanitizeKimiConfigBlob, sanitizeQwenConfigBlob } from './sanitize'
import { asRecord, cliProviderKeyName, isCherryManagedModel, normalizeUrl, omitKeysByPrefix } from './values'

interface OpenCodeProviderIdentity {
  id: string
  name: string
}

function openCodeProviderRequestOptions(options: Record<string, any>): Record<string, any> {
  const headers = Object.fromEntries(
    Object.entries(asRecord(options.providerHeaders)).filter(([, value]) => typeof value === 'string')
  )
  return Object.keys(headers).length > 0 ? { headers } : {}
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

/**
 * Codex's own CLI has special-cased behavior when a model_providers[...].name is
 * exactly "OpenAI" (reserved for the remote-compaction mode). When the user's
 * actual provider display name is literally "OpenAI" but remote compaction is
 * off, we must not emit the same literal or the config readback (parser.ts)
 * would misinterpret it as remoteCompaction being on.
 */
function resolveCodexProviderDisplayName(providerName: string, remoteCompaction: boolean): string {
  if (remoteCompaction) return 'OpenAI'
  return providerName === 'OpenAI' ? 'OpenAI (Cherry)' : providerName
}

export function buildCodexConfig(
  existingToml: Record<string, any>,
  resolved: { baseUrl: string; providerName: string; model: string },
  options: Record<string, any>
): Record<string, any> {
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${resolved.providerName.replace(/\./g, '-')}`
  const preservedProviders = omitKeysByPrefix(asRecord(existingToml.model_providers), CHERRY_PROVIDER_PREFIX)
  const merged: Record<string, any> = {
    ...existingToml,
    model: resolved.model,
    model_provider: providerKey,
    model_providers: {
      ...preservedProviders,
      [providerKey]: {
        name: resolveCodexProviderDisplayName(resolved.providerName, options.remoteCompaction === true),
        base_url: normalizeUrl(resolved.baseUrl),
        wire_api: 'responses',
        requires_openai_auth: true
      }
    }
  }
  applyCodexOptions(merged, options)
  return merged
}

export function buildCodexAuthConfig(existingAuth: Record<string, any>, apiKey: string): Record<string, any> {
  return { ...existingAuth, auth_mode: 'apikey', OPENAI_API_KEY: apiKey }
}

function hasRestorableCodexChatgptAuth(auth: Record<string, any>): boolean {
  const tokens = asRecord(auth.tokens)
  const hasCompleteTokens = ['id_token', 'access_token', 'refresh_token'].every(
    (key) => typeof tokens[key] === 'string' && tokens[key].trim().length > 0
  )
  const lastRefresh = auth.last_refresh
  const hasValidLastRefresh =
    typeof lastRefresh === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(lastRefresh) &&
    Number.isFinite(Date.parse(lastRefresh))
  return hasCompleteTokens && hasValidLastRefresh
}

export function clearCodexApiKeyAuth(existingAuth: Record<string, any>): Record<string, any> | null {
  const nextAuth = { ...existingAuth }
  delete nextAuth.OPENAI_API_KEY

  if (hasRestorableCodexChatgptAuth(nextAuth)) {
    nextAuth.auth_mode = 'chatgpt'
    return nextAuth
  }

  return null
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

function openCodeModelLimit(options: Record<string, any>): Record<string, number> | undefined {
  const limit: Record<string, number> = {}
  if (Number.isInteger(options.contextWindow) && options.contextWindow > 0) limit.context = options.contextWindow
  if (Number.isInteger(options.maxOutputTokens) && options.maxOutputTokens > 0) limit.output = options.maxOutputTokens
  return Object.keys(limit).length > 0 ? limit : undefined
}

export function buildOpenCodeConfig(
  existing: Record<string, any>,
  provider: OpenCodeProviderIdentity,
  npmInfo: OpenCodeNpmInfo,
  resolved: { apiKey: string; baseUrl: string; model: string; modelLabel?: string },
  options: Record<string, any>
): Record<string, any> {
  const providerName = cliProviderKeyName(provider)
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`
  // The models map key is the addressing id sent to the API; `name` is only what
  // OpenCode's UI displays — in gateway mode the id is UUID-prefixed, so show the label.
  const modelConfig: Record<string, any> = { name: resolved.modelLabel ?? resolved.model }
  const limit = openCodeModelLimit(options)
  if (limit) modelConfig.limit = limit
  buildOpenCodeModelOptions(modelConfig, npmInfo, {
    reasoning: options.reasoning === true,
    supportsReasoningEffort: options.supportsReasoningEffort === true
  })
  const preservedProviders = omitKeysByPrefix(asRecord(existing.provider), CHERRY_PROVIDER_PREFIX)
  const merged: Record<string, any> = {
    $schema: OPENCODE_SCHEMA,
    ...existing,
    // OpenCode's default-model selector. It splits at the FIRST "/", so the model id may
    // itself contain "/" (gateway ids do) but providerKey must not — cliProviderKeyName
    // strips it. Without this field OpenCode falls back to its own last-used model.
    model: `${providerKey}/${resolved.model}`,
    provider: {
      ...preservedProviders,
      [providerKey]: {
        npm: npmInfo.npm,
        name: providerKey,
        options: {
          apiKey: resolved.apiKey,
          baseURL: resolved.baseUrl,
          ...openCodeProviderRequestOptions(options)
        },
        models: { [resolved.model]: modelConfig }
      }
    }
  }
  delete merged.autoCompact
  delete merged.maxTurns
  applyOpenCodeOptions(merged, options)
  return merged
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

  const security = asRecord(existing.security)
  const merged = {
    ...existing,
    modelProviders: { ...asRecord(existing.modelProviders), openai: userModels },
    env: existingEnv,
    security: {
      ...security,
      auth: { ...asRecord(security.auth), selectedType: 'openai' }
    },
    model: { name: resolved.model }
  }
  applyManagedJsonSettings(merged, sanitizedConfigBlob, QWEN_WRITABLE_SETTINGS_KEYS)
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
  applyWritableTomlSettings(merged, sanitizedConfigBlob)
  return merged
}

export function buildHermesEnvConfig(envMap: Map<string, string>, apiKey: string): Map<string, string> {
  const next = new Map(envMap)
  next.delete('CHERRY_HERMES_API_KEY')
  if (apiKey) next.set('CHERRY_HERMES_API_KEY', apiKey)
  return next
}

export function buildPiModelsConfig(
  existing: Record<string, any>,
  resolved: {
    api: PiApi
    apiKey: string
    baseUrl: string
    contextWindow?: number
    headers?: Record<string, string>
    input: Array<'image' | 'text'>
    maxTokens?: number
    model: string
    modelLabel: string
    providerKey: string
    reasoning: boolean
  }
): Record<string, any> {
  const model: Record<string, any> = {
    id: resolved.model,
    name: resolved.modelLabel,
    reasoning: resolved.reasoning,
    input: resolved.input
  }
  if (resolved.contextWindow !== undefined) model.contextWindow = resolved.contextWindow
  if (resolved.maxTokens !== undefined) model.maxTokens = resolved.maxTokens

  const provider: Record<string, any> = {
    baseUrl: resolved.baseUrl,
    api: resolved.api,
    apiKey: resolved.apiKey,
    models: [model]
  }
  if (resolved.headers && Object.keys(resolved.headers).length > 0) provider.headers = resolved.headers

  return {
    ...existing,
    providers: {
      ...omitKeysByPrefix(asRecord(existing.providers), CHERRY_PROVIDER_PREFIX),
      [resolved.providerKey]: provider
    }
  }
}

export function buildPiSettingsConfig(
  existing: Record<string, any>,
  resolved: { model: string; providerKey: string }
): Record<string, any> {
  return { ...existing, defaultProvider: resolved.providerKey, defaultModel: resolved.model }
}
