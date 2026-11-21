import type { TomlTable } from 'smol-toml'

import type { Serializable } from '@shared/types/serializable'

import { CHERRY_PROVIDER_PREFIX, OPENCODE_SCHEMA } from './constants'
import {
  applyManagedJsonSettings,
  applyWritableTomlSettings,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_PERMISSION_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_ENV_KEYS,
  GEMINI_WRITABLE_SETTINGS_KEYS,
  OPEN_CODE_MANAGED_TOP_LEVEL_KEYS,
  QWEN_WRITABLE_SETTINGS_KEYS
} from './managedKeys'
import {
  codexPermissionModeToConfig,
  isCodexPermissionMode,
  isCodexReasoningEffort,
  isOpenCodePermissionMode
} from './permissionModes'
import type { OpenCodeNpmInfo, PiApi } from './resolvers'
import { sanitizeGeminiConfigBlob, sanitizeKimiConfigBlob, sanitizeQwenConfigBlob } from './sanitize'
import type { CliConfigWriteArgs } from './types'
import {
  asRecord,
  cliProviderKeyName,
  dropFeatureGoalsIfEmpty,
  isCherryManagedModel,
  normalizeUrl,
  omitKeysByPrefix
} from './values'

const CODEX_MANAGED_TOP_LEVEL_KEY_SET = new Set<string>(CODEX_MANAGED_TOP_LEVEL_KEYS)

/** Values from the editable options blob are checked by the Codex builder before use. */
export interface CodexConfigOptions {
  contextWindow?: unknown
  disableResponseStorage?: unknown
  goalMode?: unknown
  permissionMode?: unknown
  reasoningEffort?: unknown
  remoteCompaction?: unknown
}

/** The rebuild path reads these values from user-edited JSON as well as model metadata. */
interface OpenCodeConfigOptions {
  autoCompact?: unknown
  contextWindow?: unknown
  maxOutputTokens?: unknown
  permissionMode?: unknown
  providerHeaders?: unknown
  reasoning?: unknown
  supportsReasoningEffort?: unknown
}

interface OpenCodeProviderIdentity {
  id: string
  name: string
}

function openCodeProviderRequestOptions(options: Pick<OpenCodeConfigOptions, 'providerHeaders'>): {
  headers?: Record<string, string>
} {
  const headers = Object.fromEntries(
    Object.entries(asRecord(options.providerHeaders)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  return Object.keys(headers).length > 0 ? { headers } : {}
}

export function buildClaudeConfig(
  existing: Record<string, Serializable>,
  userBlob: NonNullable<CliConfigWriteArgs['configBlob']>,
  resolved: { apiKey: string; baseUrl: string; model: string; writePrimaryModel?: boolean }
) {
  const configEnv = { ...asRecord(userBlob.env) }
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Foreign env values from the edited blob are preserved until JSON rendering; only managed values are overwritten.
  const envBlock: Record<string, unknown> = { ...configEnv }
  if (resolved.baseUrl) envBlock.ANTHROPIC_BASE_URL = resolved.baseUrl
  if (resolved.apiKey) envBlock.ANTHROPIC_AUTH_TOKEN = resolved.apiKey
  if (resolved.writePrimaryModel === false) delete envBlock.ANTHROPIC_MODEL
  else if (resolved.model) envBlock.ANTHROPIC_MODEL = resolved.model

  // SAFETY: Existing env fields come from the JSONC parser; the branch below checks the object container.
  const existingEnv =
    existing.env && typeof existing.env === 'object' ? { ...(existing.env as Record<string, Serializable>) } : null
  if (existingEnv) {
    for (const key of CLAUDE_MANAGED_ENV_KEYS) {
      if (!(key in envBlock)) delete existingEnv[key]
    }
  }

  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The edited blob may retain unvalidated extension values; JSON rendering owns omission and serialization errors.
  const merged: Record<string, unknown> = { ...existing, ...userBlob }
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
  existingToml: TomlTable,
  resolved: { baseUrl: string; providerName: string; model: string },
  options: CodexConfigOptions
): TomlTable {
  const isValidTokenCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  const existingWindow = existingToml.model_context_window
  const existingCompaction = existingToml.model_auto_compact_token_limit
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${resolved.providerName.replace(/\./g, '-')}`
  // SAFETY: Existing provider entries come from parsed TOML; the container view preserves native TOML values.
  const preservedProviders = omitKeysByPrefix(
    asRecord(existingToml.model_providers) as TomlTable,
    CHERRY_PROVIDER_PREFIX
  )
  const cleaned: TomlTable = {}
  for (const [key, value] of Object.entries(existingToml)) {
    if (!CODEX_MANAGED_TOP_LEVEL_KEY_SET.has(key)) {
      cleaned[key] = value
    }
  }
  dropFeatureGoalsIfEmpty(cleaned)

  const merged: TomlTable = {
    ...cleaned,
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
  if (isValidTokenCount(options.contextWindow)) merged.model_context_window = options.contextWindow
  else if (isValidTokenCount(existingWindow)) merged.model_context_window = existingWindow
  if (isValidTokenCount(existingCompaction)) merged.model_auto_compact_token_limit = existingCompaction
  if (options.disableResponseStorage === true) merged.disable_response_storage = true
  if (options.goalMode === true) {
    // SAFETY: The existing feature fields retain the parsed TOML value domain after managed-key deletion.
    const features = asRecord(merged.features) as TomlTable
    features.goals = true
    merged.features = features
  }
  if (isCodexPermissionMode(options.permissionMode)) {
    Object.assign(merged, codexPermissionModeToConfig(options.permissionMode))
  }
  if (isCodexReasoningEffort(options.reasoningEffort)) merged.model_reasoning_effort = options.reasoningEffort
  return merged
}

export function buildCodexAuthConfig(
  existingAuth: Record<string, Serializable>,
  apiKey: string
): Record<string, Serializable> {
  return { ...existingAuth, auth_mode: 'apikey', OPENAI_API_KEY: apiKey }
}

function hasRestorableCodexChatgptAuth(auth: Record<string, Serializable>): boolean {
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

export function clearCodexApiKeyAuth(existingAuth: Record<string, Serializable>): Record<string, Serializable> | null {
  const nextAuth = { ...existingAuth }
  delete nextAuth.OPENAI_API_KEY

  if (hasRestorableCodexChatgptAuth(nextAuth)) {
    nextAuth.auth_mode = 'chatgpt'
    return nextAuth
  }

  return null
}

function buildOpenCodeModelOptions(
  modelConfig: Record<string, Serializable>,
  npmInfo: OpenCodeNpmInfo,
  options: { reasoning: boolean; supportsReasoningEffort: boolean }
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

function openCodeModelLimit(options: OpenCodeConfigOptions): Partial<Record<'context' | 'output', number>> | undefined {
  const limit: Partial<Record<'context' | 'output', number>> = {}
  if (
    typeof options.contextWindow === 'number' &&
    Number.isInteger(options.contextWindow) &&
    options.contextWindow > 0
  ) {
    limit.context = options.contextWindow
  }
  if (
    typeof options.maxOutputTokens === 'number' &&
    Number.isInteger(options.maxOutputTokens) &&
    options.maxOutputTokens > 0
  ) {
    limit.output = options.maxOutputTokens
  }
  return Object.keys(limit).length > 0 ? limit : undefined
}

export function buildOpenCodeConfig(
  existing: Record<string, Serializable>,
  provider: OpenCodeProviderIdentity,
  npmInfo: OpenCodeNpmInfo,
  resolved: { apiKey: string; baseUrl: string; model: string; modelLabel?: string },
  options: OpenCodeConfigOptions
): Record<string, Serializable> {
  const providerName = cliProviderKeyName(provider)
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`
  // The models map key is the addressing id sent to the API; `name` is only what
  // OpenCode's UI displays — in gateway mode the id is UUID-prefixed, so show the label.
  const modelConfig: Record<string, Serializable> = { name: resolved.modelLabel ?? resolved.model }
  const limit = openCodeModelLimit(options)
  if (limit) modelConfig.limit = limit
  buildOpenCodeModelOptions(modelConfig, npmInfo, {
    reasoning: options.reasoning === true,
    supportsReasoningEffort: options.supportsReasoningEffort === true
  })
  // SAFETY: Existing provider entries come from parsed JSON; the container check does not change their value domain.
  const preservedProviders = omitKeysByPrefix(
    asRecord(existing.provider) as Record<string, Serializable>,
    CHERRY_PROVIDER_PREFIX
  )
  const cleaned: Record<string, Serializable> = { ...existing }
  for (const key of OPEN_CODE_MANAGED_TOP_LEVEL_KEYS) delete cleaned[key]
  // SAFETY: Existing compaction values come from parsed JSON and are copied without interpretation.
  const compaction = { ...(asRecord(existing.compaction) as Record<string, Serializable>) }
  delete cleaned.compaction
  delete compaction.auto
  if (options.autoCompact === true) compaction.auto = true
  const merged: Record<string, Serializable> = {
    $schema: OPENCODE_SCHEMA,
    ...cleaned,
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
  if (Object.keys(compaction).length > 0) merged.compaction = compaction
  if (isOpenCodePermissionMode(options.permissionMode)) merged.permission = options.permissionMode
  return merged
}

export function buildGeminiEnvConfig(
  envMap: Map<string, string>,
  resolved: { apiKey: string; baseUrl: string; gateway?: boolean }
): Map<string, string> {
  const next = new Map(envMap)
  for (const key of GEMINI_MANAGED_ENV_KEYS) next.delete(key)
  if (resolved.apiKey) next.set('GEMINI_API_KEY', resolved.apiKey)
  if (resolved.baseUrl) next.set('GOOGLE_GEMINI_BASE_URL', resolved.baseUrl)
  // The gateway serves only `/v1beta`. Force the SDK's API version so a stale
  // `GOOGLE_GENAI_API_VERSION=v1` left in the user's ~/.gemini/.env can't redirect
  // gemini-cli's @google/genai to the unsupported `/v1` prefix and break launch.
  if (resolved.gateway) next.set('GOOGLE_GENAI_API_VERSION', 'v1beta')
  return next
}

export function buildGeminiSettingsConfig(
  settings: Record<string, Serializable>,
  resolved: { model: string },
  configBlob: NonNullable<CliConfigWriteArgs['configBlob']>
) {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Managed-key copying can retain raw edited values; JSON rendering validates their final representation.
  const next: Record<string, unknown> = { ...settings }
  applyManagedJsonSettings(next, sanitizeGeminiConfigBlob(configBlob), GEMINI_WRITABLE_SETTINGS_KEYS)
  next.model = { ...asRecord(next.model), name: resolved.model }
  const security = asRecord(next.security)
  next.security = { ...security, auth: { ...asRecord(security.auth), selectedType: 'gemini-api-key' } }
  return next
}

export function buildQwenConfig(
  existing: Record<string, Serializable>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelLabel: string },
  configBlob: NonNullable<CliConfigWriteArgs['configBlob']>
) {
  const sanitizedConfigBlob = sanitizeQwenConfigBlob(configBlob)
  const envKey = 'CHERRY_QWEN_API_KEY'
  const modelProviders = asRecord(existing.modelProviders)
  const existingModels = Array.isArray(modelProviders.openai) ? [...modelProviders.openai] : []
  const userModels = existingModels.filter((m) => !isCherryManagedModel(m))
  userModels.push({ id: resolved.model, name: resolved.modelLabel, baseUrl: resolved.baseUrl, envKey })

  const existingEnv = omitKeysByPrefix(asRecord(existing.env), 'CHERRY_')
  existingEnv[envKey] = resolved.apiKey

  const security = asRecord(existing.security)
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The managed settings copied below still contain raw edited values; JSON rendering owns their serialization.
  const merged: Record<string, unknown> = {
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
  existing: TomlTable,
  resolved: { apiKey: string; baseUrl: string; model: string; modelKey: string; maxContextSize?: number },
  configBlob: NonNullable<CliConfigWriteArgs['configBlob']>
) {
  const sanitizedConfigBlob = sanitizeKimiConfigBlob(configBlob)
  const providerTable = omitKeysByPrefix(asRecord(existing.providers), CHERRY_PROVIDER_PREFIX)
  providerTable[resolved.modelKey] = { type: 'openai', base_url: resolved.baseUrl, api_key: resolved.apiKey }

  const modelsTable = omitKeysByPrefix(asRecord(existing.models), CHERRY_PROVIDER_PREFIX)
  const modelConfig: TomlTable = {
    provider: resolved.modelKey,
    model: resolved.model
  }
  if (resolved.maxContextSize !== undefined) modelConfig.max_context_size = resolved.maxContextSize
  modelsTable[resolved.modelKey] = modelConfig

  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Preserve native TOML entries and raw managed values until the target TOML serializer validates them.
  const merged: Record<string, unknown> = {
    ...existing,
    default_model: resolved.modelKey,
    providers: providerTable,
    models: modelsTable
  }
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
  existing: Record<string, Serializable>,
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
): Record<string, Serializable> {
  const model: Record<string, Serializable> = {
    id: resolved.model,
    name: resolved.modelLabel,
    reasoning: resolved.reasoning,
    input: resolved.input
  }
  if (resolved.contextWindow !== undefined) model.contextWindow = resolved.contextWindow
  if (resolved.maxTokens !== undefined) model.maxTokens = resolved.maxTokens

  const provider: Record<string, Serializable> = {
    baseUrl: resolved.baseUrl,
    api: resolved.api,
    apiKey: resolved.apiKey,
    models: [model]
  }
  if (resolved.headers && Object.keys(resolved.headers).length > 0) provider.headers = resolved.headers

  // SAFETY: Existing provider entries come from parsed JSON; only the managed prefix is replaced.
  const preservedProviders = omitKeysByPrefix(
    asRecord(existing.providers) as Record<string, Serializable>,
    CHERRY_PROVIDER_PREFIX
  )

  return {
    ...existing,
    providers: {
      ...preservedProviders,
      [resolved.providerKey]: provider
    }
  }
}

export function buildPiSettingsConfig(
  existing: Record<string, Serializable>,
  resolved: { model: string; providerKey: string }
): Record<string, Serializable> {
  return { ...existing, defaultProvider: resolved.providerKey, defaultModel: resolved.model }
}
