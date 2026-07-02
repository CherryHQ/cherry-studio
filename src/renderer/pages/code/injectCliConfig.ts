import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

const logger = loggerService.withContext('injectCliConfig')

/**
 * Renderer-side native-config injection for the file-based CLI tools.
 *
 * Injection runs at the "enable config" trigger (see CodeCliPage); launch
 * (`ipcApi.request('code_cli.run', …)`) is terminal-only. Hermes and OpenClaw are
 * injected in the main-process `run()` instead, so this function is a no-op
 * for them.
 *
 * There is no namespace-resolve IPC, so the renderer resolves the paths via
 * `window.api.resolvePath` instead of `application.getPath`.
 */
const CLAUDE_SETTINGS_PATH = '~/.claude/settings.json'
const CODEX_AUTH_PATH = '~/.codex/auth.json'
const CODEX_CONFIG_PATH = '~/.codex/config.toml'
const CODEX_RESPONSES_ENDPOINT = 'openai-responses'
const CODEX_CHAT_ENDPOINT = 'openai-chat-completions'
const OPENCODE_CONFIG_PATH = '~/.config/opencode/opencode.json'
const GEMINI_ENV_PATH = '~/.gemini/.env'
const GEMINI_SETTINGS_PATH = '~/.gemini/settings.json'
const QWEN_CONFIG_PATH = '~/.qwen/settings.json'
const KIMI_CONFIG_PATH = '~/.kimi-code/config.toml'

/** aihubmix's Gemini endpoint lives at `/gemini`, not its preset's bare domain. */
const GEMINI_AGGREGATOR_BASE_URLS: Record<string, string> = {
  aihubmix: 'https://aihubmix.com/gemini'
}

/** File-based CLI tools injected here at "enable config" time. */
const FILE_CONFIGURED_CLI_TOOLS: ReadonlySet<string> = new Set([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.OPEN_CODE,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

/** Resolve the Gemini base URL, honoring known aggregator overrides. */
function resolveGeminiBaseUrl(provider: Provider): string {
  return (
    GEMINI_AGGREGATOR_BASE_URLS[provider.id] ?? provider.endpointConfigs?.['google-generate-content']?.baseUrl ?? ''
  )
}

function resolveOpenAIBaseUrl(provider: Provider): string {
  const responses = provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl
  const chat = provider.endpointConfigs?.[CODEX_CHAT_ENDPOINT]?.baseUrl
  return formatApiHost(responses ?? chat)
}

/**
 * Top-level keys Cherry manages inside ~/.claude/settings.json. Cleared on
 * config switch so each config is self-contained (no leakage across configs).
 */
const CLAUDE_MANAGED_TOP_LEVEL_KEYS = ['attribution', 'permissions'] as const
/**
 * env keys Cherry manages inside the `env` block of ~/.claude/settings.json.
 * Must cover everything ClaudeConfigFields can write plus the credentials
 * injected here — a missing entry leaks the previous config's value on switch.
 */
const CLAUDE_MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'DISABLE_AUTOUPDATER',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS',
  'DISABLE_COMPACT',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'DISABLE_EXTRA_USAGE_COMMAND',
  'CLAUDE_CODE_ATTRIBUTION_HEADER'
] as const

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
const CHERRY_PROVIDER_PREFIX = 'cherry-'
const CODEX_MANAGED_TOP_LEVEL_KEYS = [
  'model_reasoning_effort',
  'disable_response_storage',
  'personality',
  'model_verbosity',
  'model_context_window',
  'model_auto_compact_token_limit',
  'review_model'
] as const

/** Resolve `~`/relative paths to absolute (renderer cannot call application.getPath). */
async function resolveAbs(p: string): Promise<string> {
  return window.api.resolvePath(p)
}

/** Read an external file as text; returns '' when missing or unreadable. */
async function readExternal(absPath: string): Promise<string> {
  try {
    return await window.api.file.readExternal(absPath)
  } catch {
    return ''
  }
}

/** Read + parse JSONC, throwing a contextual error on a malformed file so the
 * caller surfaces a toast instead of silently overwriting the file with a
 * merge-into-empty that wipes the user's config. */
async function readValidatedJson(absPath: string, label: string): Promise<Record<string, any>> {
  try {
    return parseJsonOrThrow(await readExternal(absPath))
  } catch (err) {
    throw new Error(`Failed to parse ${label} at ${absPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Read + parse TOML, throwing a contextual error on a malformed file (see
 * `readValidatedJson`). */
async function readValidatedToml(absPath: string, label: string): Promise<Record<string, any>> {
  try {
    return parseTomlOrThrow(await readExternal(absPath))
  } catch (err) {
    throw new Error(`Failed to parse ${label} at ${absPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function parseTomlOrThrow(content: string): Record<string, any> {
  if (!content) return {}
  return parseToml(content) as Record<string, any>
}

function parseJsonOrThrow(content: string): Record<string, any> {
  if (!content) return {}
  const errors: ParseError[] = []
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length) {
    throw new Error(`invalid JSONC (${errors.length} parse error(s))`)
  }
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {}
}

/** Sanitize a provider display name for use as a config key segment. */
function sanitizeProviderName(name: string, fallback: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_\s.-]/g, '').replace(/\s+/g, '-')
  return sanitized || fallback
}

/** First enabled API key value, falling back to the first key if none enabled. */
function firstApiKey(keys: ApiKeyEntry[] | undefined): string {
  if (!keys?.length) return ''
  return keys.find((k) => k.isEnabled)?.key ?? keys[0]?.key ?? ''
}

interface OpenCodeNpmInfo {
  npm: string
  providerType: 'anthropic' | 'google' | 'openai' | 'openai-compatible'
}

function resolveOpenCodeNpmInfo(provider: Provider): OpenCodeNpmInfo {
  if (provider.endpointConfigs?.['google-generate-content']?.baseUrl) {
    return { npm: '@ai-sdk/google', providerType: 'google' }
  }
  if (provider.endpointConfigs?.['anthropic-messages']?.baseUrl) {
    return { npm: '@ai-sdk/anthropic', providerType: 'anthropic' }
  }
  if (provider.endpointConfigs?.['openai-responses']?.baseUrl) {
    return { npm: '@ai-sdk/openai', providerType: 'openai' }
  }
  // openai-chat-completions or any unrecognised → openai-compatible
  return { npm: '@ai-sdk/openai-compatible', providerType: 'openai-compatible' }
}

/** Whether a model advertises reasoning-effort support (shapes opencode's
 * `reasoningEffort` option for openai-compatible providers). */
function modelSupportsReasoningEffort(modelRecord: Model | null): boolean {
  return !!modelRecord?.reasoning?.supportedEfforts?.length
}

/** Apply the claude-code config body to ~/.claude/settings.json (merged). */
async function writeClaude(
  existing: Record<string, any>,
  userBlob: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string }
): Promise<void> {
  const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)

  // Inject env into a copy of the user blob, then deep-merge into existing,
  // clearing managed ANTHROPIC_* keys from the on-disk env first so a config
  // switch doesn't leak stale tokens.
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
  // Each config is independent: drop any Cherry-managed top-level key the new
  // blob doesn't re-assert (e.g. `attribution` from a previous config).
  for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) {
    if (!(key in userBlob)) delete merged[key]
  }
  merged.env = existingEnv ? { ...existingEnv, ...envBlock } : { ...envBlock }

  await window.api.file.write(absPath, `${JSON.stringify(merged, null, 2)}\n`)
  logger.info(`Applied Claude Code config body to ${absPath}`)
}

/** Per-config Codex toggles read from the user-edited config blob. */
interface CodexConfigOptions {
  goalMode?: boolean
  remoteCompaction?: boolean
  disableResponseStorage?: boolean
  modelReasoningEffort?: string
  modelVerbosity?: string
  modelContextWindow?: number
  modelAutoCompactTokenLimit?: number
  personality?: string
}

/** Apply the codex config to ~/.codex/config.toml + ~/.codex/auth.json (merged).
 *
 * Codex splits its config across two files: `auth.json` holds the API key as
 * `OPENAI_API_KEY`, and `config.toml` holds model/provider wiring. The Cherry
 * provider is written with `requires_openai_auth = true` so Codex reads the key
 * from auth.json. */
async function writeCodex(
  existingToml: Record<string, any>,
  existingAuth: Record<string, any>,
  resolved: {
    apiKey: string
    baseUrl: string
    providerName: string
    model: string
  },
  options: CodexConfigOptions = {}
): Promise<void> {
  const { apiKey, baseUrl, providerName, model } = resolved
  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName.replace(/\./g, '-')}`
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

  // `features.goals` is Cherry-managed (goal-mode toggle): drop any stale value
  // from the on-disk config so toggling it off doesn't leak across configs.
  // Other user `features` keys are preserved.
  if (cleaned.features && typeof cleaned.features === 'object') {
    const features = { ...(cleaned.features as Record<string, any>) }
    delete features.goals
    if (Object.keys(features).length === 0) delete cleaned.features
    else cleaned.features = features
  }

  const merged: Record<string, any> = {
    ...cleaned,
    model,
    model_provider: providerKey,
    model_providers: {
      ...preservedProviders,
      [providerKey]: {
        // `name = "OpenAI"` opts into Codex's remote (server-side) compaction.
        name: options.remoteCompaction ? 'OpenAI' : providerName,
        base_url: baseUrl.replace(/\/$/, ''),
        wire_api: 'responses',
        requires_openai_auth: true
      }
    }
  }

  // User-configured top-level keys — apply only when explicitly set.
  if (options.modelReasoningEffort) {
    merged.model_reasoning_effort = options.modelReasoningEffort
  }

  if (options.disableResponseStorage) {
    merged.disable_response_storage = true
  }

  if (options.modelVerbosity) {
    merged.model_verbosity = options.modelVerbosity
  }

  if (options.modelContextWindow) {
    merged.model_context_window = options.modelContextWindow
  }

  if (options.modelAutoCompactTokenLimit) {
    merged.model_auto_compact_token_limit = options.modelAutoCompactTokenLimit
  }

  if (options.personality) {
    merged.personality = options.personality
  }

  if (options.goalMode) {
    const features =
      merged.features && typeof merged.features === 'object' ? { ...(merged.features as Record<string, any>) } : {}
    features.goals = true
    merged.features = features
  }

  // auth.json: merge OPENAI_API_KEY, preserving unrelated keys (e.g. OAuth
  // login material).
  const mergedAuth = { ...existingAuth, OPENAI_API_KEY: apiKey }

  const absPath = await resolveAbs(CODEX_CONFIG_PATH)
  const authAbsPath = await resolveAbs(CODEX_AUTH_PATH)
  // Two files: write config first, then auth. If the auth write fails, roll
  // config back to its pre-injection text so we never leave a config.toml
  // pointing at a provider whose auth.json wasn't updated.
  await window.api.file.write(absPath, stringifyToml(merged))
  try {
    await window.api.file.write(authAbsPath, `${JSON.stringify(mergedAuth, null, 2)}\n`)
  } catch (err) {
    await window.api.file
      .write(absPath, stringifyToml(existingToml))
      .catch((rollbackErr) =>
        logger.error('Failed to roll back Codex config.toml after auth.json write failure:', rollbackErr as Error)
      )
    throw err
  }
  logger.info(`Applied Codex config to ${absPath} + ${authAbsPath}`)
}

/** Per-config OpenCode options read from the user-edited config blob. */
interface OpenCodeModelOptions {
  reasoning: boolean
  supportsReasoningEffort: boolean
  reasoningEffort?: string
  thinkingBudgetTokens?: number
  autoCompact?: boolean
  maxTurns?: number
}

function buildOpenCodeModelOptions(
  modelConfig: Record<string, any>,
  npmInfo: OpenCodeNpmInfo,
  options: OpenCodeModelOptions
): void {
  const { providerType } = npmInfo

  if (providerType === 'anthropic') {
    if (options.reasoning || options.thinkingBudgetTokens) {
      modelConfig.reasoning = true
      const budgetTokens = options.thinkingBudgetTokens ?? 10000
      modelConfig.options = { thinking: { budgetTokens, type: 'enabled' } }
    }
    return
  }

  if (providerType === 'google') {
    if (options.reasoning) {
      modelConfig.reasoning = true
      modelConfig.options = {
        thinkingConfig: { includeThoughts: true, thinkingBudget: options.thinkingBudgetTokens ?? -1 }
      }
    }
    return
  }

  // openai / openai-compatible: reasoning-effort based
  if (options.reasoning && options.supportsReasoningEffort) {
    modelConfig.reasoning = true
    modelConfig.options = { reasoningEffort: options.reasoningEffort || 'medium' }
  } else if (options.reasoningEffort) {
    // Reasoning effort can be set even without the reasoning toggle.
    modelConfig.options = { reasoningEffort: options.reasoningEffort }
  }
}

/** Apply the opencode config to ~/.config/opencode/opencode.json (merged). */
async function writeOpenCode(
  existing: Record<string, any>,
  provider: Provider,
  npmInfo: OpenCodeNpmInfo,
  resolved: { apiKey: string; baseUrl: string; model: string },
  options: OpenCodeModelOptions
): Promise<void> {
  const { apiKey, baseUrl, model } = resolved
  const providerName = sanitizeProviderName(provider.name, provider.id)

  const modelConfig: Record<string, any> = { name: model }
  buildOpenCodeModelOptions(modelConfig, npmInfo, options)

  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`
  const cherryProvider = {
    npm: npmInfo.npm,
    name: providerKey,
    options: { apiKey, baseURL: baseUrl },
    models: { [model]: modelConfig }
  }
  const existingProviders = existing.provider && typeof existing.provider === 'object' ? existing.provider : {}
  const preservedProviders = Object.fromEntries(
    Object.entries(existingProviders).filter(([key]) => !key.startsWith(CHERRY_PROVIDER_PREFIX))
  )
  const merged: Record<string, any> = {
    $schema: OPENCODE_SCHEMA,
    ...existing,
    provider: { ...preservedProviders, [providerKey]: cherryProvider }
  }

  // Top-level config keys — apply only when explicitly set.
  if (options.autoCompact) {
    merged.autoCompact = true
  }
  if (options.maxTurns) {
    merged.maxTurns = options.maxTurns
  }

  const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
  await window.api.file.write(absPath, `${JSON.stringify(merged, null, 2)}\n`)
  logger.info(`Applied OpenCode config to ${absPath}`)
}

/** Gemini env keys Cherry manages inside ~/.gemini/.env (cleared on switch). */
const GEMINI_MANAGED_ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'] as const

/** Parse a dotenv file into an ordered key→value map, preserving entry order. */
function parseDotenv(content: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out.set(key, value)
  }
  return out
}

/** Apply gemini-cli credentials to ~/.gemini/.env + model to settings.json. */
async function writeGemini(
  envMap: Map<string, string>,
  settings: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string }
): Promise<void> {
  const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
  for (const key of GEMINI_MANAGED_ENV_KEYS) envMap.delete(key)
  if (resolved.apiKey) envMap.set('GEMINI_API_KEY', resolved.apiKey)
  if (resolved.baseUrl) envMap.set('GOOGLE_GEMINI_BASE_URL', resolved.baseUrl)
  const envBody = `${[...envMap.entries()].map(([k, v]) => `${k}=${v}`).join('\n')}\n`
  await window.api.file.write(envAbsPath, envBody)

  const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
  settings.model = {
    ...(settings.model && typeof settings.model === 'object' ? settings.model : {}),
    name: resolved.model
  }
  await window.api.file.write(settingsAbsPath, `${JSON.stringify(settings, null, 2)}\n`)
  logger.info(`Applied Gemini CLI config to ${envAbsPath} + ${settingsAbsPath}`)
}

/** Prefix marking Qwen env keys / Kimi tables as Cherry-managed. */
const CHERRY_PREFIX = 'cherry-'

/** Apply qwen-code config to ~/.qwen/settings.json (merged).
 *
 * Qwen Code keys models under a protocol bucket (`modelProviders.openai`),
 * not a provider name. Cherry marks its entries with a `CHERRY_*` envKey so a
 * config switch strips the previous config without touching user models. */
async function writeQwen(
  existing: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelLabel: string }
): Promise<void> {
  const envKey = 'CHERRY_QWEN_API_KEY'
  const openaiBucket: Record<string, any> =
    existing.modelProviders?.openai && typeof existing.modelProviders.openai === 'object'
      ? { ...(existing.modelProviders.openai as Record<string, any>) }
      : { protocol: 'openai' }
  if (!openaiBucket.protocol) openaiBucket.protocol = 'openai'
  const existingModels = Array.isArray(openaiBucket.models) ? [...openaiBucket.models] : []
  const userModels = existingModels.filter(
    (m) => !(m && typeof m === 'object' && typeof m.envKey === 'string' && m.envKey.startsWith('CHERRY_'))
  )
  userModels.push({ id: resolved.model, name: resolved.modelLabel, baseUrl: resolved.baseUrl, envKey })
  openaiBucket.models = userModels

  const existingEnv =
    existing.env && typeof existing.env === 'object' ? { ...(existing.env as Record<string, any>) } : {}
  for (const k of Object.keys(existingEnv)) {
    if (k.startsWith('CHERRY_')) delete existingEnv[k]
  }
  existingEnv[envKey] = resolved.apiKey

  const merged = {
    ...existing,
    modelProviders: { ...existing.modelProviders, openai: openaiBucket },
    env: existingEnv,
    security: {
      ...existing.security,
      auth: { ...existing.security?.auth, selectedType: 'openai' }
    },
    model: { name: resolved.model }
  }

  const absPath = await resolveAbs(QWEN_CONFIG_PATH)
  await window.api.file.write(absPath, `${JSON.stringify(merged, null, 2)}\n`)
  logger.info(`Applied Qwen Code config to ${absPath}`)
}

/** Apply kimi-code config to ~/.kimi-code/config.toml (merged).
 *
 * Cherry owns one provider+model pair under `cherry-<provider>` tables; a
 * switch strips any prior `cherry-*` providers/models before writing. */
async function writeKimi(
  existing: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string; modelKey: string }
): Promise<void> {
  const providerTable =
    existing.providers && typeof existing.providers === 'object'
      ? { ...(existing.providers as Record<string, any>) }
      : {}
  for (const k of Object.keys(providerTable)) {
    if (k.startsWith(CHERRY_PREFIX)) delete providerTable[k]
  }
  providerTable[resolved.modelKey] = { type: 'openai', base_url: resolved.baseUrl, api_key: resolved.apiKey }

  const modelsTable =
    existing.models && typeof existing.models === 'object' ? { ...(existing.models as Record<string, any>) } : {}
  for (const k of Object.keys(modelsTable)) {
    if (k.startsWith(CHERRY_PREFIX)) delete modelsTable[k]
  }
  modelsTable[resolved.modelKey] = { provider: resolved.modelKey, model: resolved.model }

  const merged = { ...existing, default_model: resolved.modelKey, providers: providerTable, models: modelsTable }

  const absPath = await resolveAbs(KIMI_CONFIG_PATH)
  await window.api.file.write(absPath, stringifyToml(merged))
  logger.info(`Applied Kimi CLI config to ${absPath}`)
}

export interface InjectCliConfigArgs {
  cliTool: string
  /** Unique model id ("providerId::modelId"). */
  modelId: string
  /** User-edited config blob (claude-code / codex / opencode consume it). */
  configBlob?: Record<string, unknown>
}

/**
 * Resolve provider credentials and write them to the CLI tool's native config
 * file. No-op for hermes/openclaw (still injected in main `run()`). Throws on
 * failure so callers can surface a toast.
 */
export async function injectCliConfig(args: InjectCliConfigArgs): Promise<unknown> {
  const { cliTool, configBlob } = args

  // Only the file-based tools are injected here.
  if (!FILE_CONFIGURED_CLI_TOOLS.has(cliTool)) {
    return
  }
  if (!isUniqueModelId(args.modelId)) {
    logger.warn('Skipping injection: model id is not a UniqueModelId', { cliTool })
    return
  }
  const { providerId, modelId: model } = parseUniqueModelId(args.modelId)

  const provider = (await dataApiService.get(`/providers/${providerId}`)) as Provider | undefined
  const apiKeysRes = (await dataApiService.get(`/providers/${providerId}/api-keys`)) as
    | { keys?: ApiKeyEntry[] }
    | undefined
  const modelRecord = await dataApiService.get(`/models/${args.modelId}`).catch(() => null)

  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }
  const apiKey = firstApiKey(apiKeysRes?.keys)

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const baseUrl = provider.endpointConfigs?.['anthropic-messages']?.baseUrl ?? ''
      const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)
      const existing = await readValidatedJson(absPath, 'Claude Code settings')
      await writeClaude(
        existing,
        configBlob && typeof configBlob === 'object' ? (configBlob as Record<string, any>) : {},
        { apiKey, baseUrl, model }
      )
      return
    }
    case CodeCli.OPENAI_CODEX: {
      const responsesUrl = provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl
      const providerName = sanitizeProviderName(provider.name, provider.id)
      if (!apiKey) {
        throw new Error('Codex config is missing the API key')
      }
      // Codex dropped `wire_api = "chat"`; only the Responses API is supported,
      // so a provider without a responses endpoint cannot back Codex.
      if (!responsesUrl) {
        throw new Error('Codex requires an OpenAI Responses API endpoint, which this provider does not expose')
      }
      const baseUrl = formatApiHost(responsesUrl)
      const absPath = await resolveAbs(CODEX_CONFIG_PATH)
      const authAbsPath = await resolveAbs(CODEX_AUTH_PATH)
      const existing = await readValidatedToml(absPath, 'Codex config')
      const existingAuth = await readValidatedJson(authAbsPath, 'Codex auth')
      const blob = configBlob && typeof configBlob === 'object' ? (configBlob as Record<string, any>) : {}
      await writeCodex(
        existing,
        existingAuth,
        { apiKey, baseUrl, providerName, model },
        {
          goalMode: blob.goalMode === true,
          remoteCompaction: blob.remoteCompaction === true,
          disableResponseStorage: blob.disableResponseStorage === true,
          modelReasoningEffort: typeof blob.modelReasoningEffort === 'string' ? blob.modelReasoningEffort : undefined,
          modelVerbosity: typeof blob.modelVerbosity === 'string' ? blob.modelVerbosity : undefined,
          modelContextWindow: typeof blob.modelContextWindow === 'number' ? blob.modelContextWindow : undefined,
          modelAutoCompactTokenLimit:
            typeof blob.modelAutoCompactTokenLimit === 'number' ? blob.modelAutoCompactTokenLimit : undefined,
          personality: typeof blob.personality === 'string' ? blob.personality : undefined
        }
      )
      return
    }
    case CodeCli.OPEN_CODE: {
      const npmInfo = resolveOpenCodeNpmInfo(provider)
      // Pick the primary endpoint to source the baseUrl from, in priority order
      // matching resolveOpenCodeNpmInfo: google → anthropic → responses → chat.
      const endpointType =
        npmInfo.providerType === 'google'
          ? 'google-generate-content'
          : npmInfo.providerType === 'anthropic'
            ? 'anthropic-messages'
            : npmInfo.providerType === 'openai'
              ? 'openai-responses'
              : (provider.defaultChatEndpoint ?? 'openai-chat-completions')
      const rawUrl = provider.endpointConfigs?.[endpointType]?.baseUrl ?? ''
      const baseUrl = formatApiHost(rawUrl)
      if (!apiKey || !baseUrl) {
        throw new Error('OpenCode config is missing required fields (apiKey/baseUrl)')
      }
      const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
      const existing = await readValidatedJson(absPath, 'OpenCode config')
      const blob = configBlob && typeof configBlob === 'object' ? (configBlob as Record<string, any>) : {}
      const env = blob.env && typeof blob.env === 'object' ? (blob.env as Record<string, any>) : {}
      await writeOpenCode(
        existing,
        provider,
        npmInfo,
        { apiKey, baseUrl, model },
        {
          reasoning: env.OPENCODE_REASONING === 'true',
          supportsReasoningEffort: modelSupportsReasoningEffort(modelRecord),
          reasoningEffort: typeof blob.reasoningEffort === 'string' ? blob.reasoningEffort : undefined,
          thinkingBudgetTokens: typeof blob.thinkingBudgetTokens === 'number' ? blob.thinkingBudgetTokens : undefined,
          autoCompact: blob.autoCompact === true,
          maxTurns: typeof blob.maxTurns === 'number' ? blob.maxTurns : undefined
        }
      )
      return
    }
    case CodeCli.GEMINI_CLI: {
      const baseUrl = resolveGeminiBaseUrl(provider)
      if (!apiKey) {
        throw new Error('Gemini CLI config is missing the API key')
      }
      const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
      const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
      const envMap = parseDotenv(await readExternal(envAbsPath))
      const settings = await readValidatedJson(settingsAbsPath, 'Gemini CLI settings')
      await writeGemini(envMap, settings, { apiKey, baseUrl, model })
      return
    }
    case CodeCli.QWEN_CODE: {
      const baseUrl = resolveOpenAIBaseUrl(provider)
      if (!apiKey) {
        throw new Error('Qwen Code config is missing the API key')
      }
      if (!baseUrl) {
        throw new Error('Qwen Code config is missing the OpenAI endpoint base URL')
      }
      const absPath = await resolveAbs(QWEN_CONFIG_PATH)
      const existing = await readValidatedJson(absPath, 'Qwen Code config')
      const modelLabel = modelRecord?.name ?? model
      await writeQwen(existing, { apiKey, baseUrl, model, modelLabel })
      return
    }
    case CodeCli.KIMI_CODE: {
      const baseUrl = resolveOpenAIBaseUrl(provider)
      if (!apiKey) {
        throw new Error('Kimi CLI config is missing the API key')
      }
      if (!baseUrl) {
        throw new Error('Kimi CLI config is missing the OpenAI endpoint base URL')
      }
      const absPath = await resolveAbs(KIMI_CONFIG_PATH)
      const existing = await readValidatedToml(absPath, 'Kimi Code config')
      const providerName = sanitizeProviderName(provider.name, provider.id)
      const modelKey = `${CHERRY_PREFIX}${providerName}`
      await writeKimi(existing, { apiKey, baseUrl, model, modelKey })
      return
    }
    default:
      return
  }
}

export interface ClearCliConfigArgs {
  /** CLI tool whose native config file should be scrubbed. */
  cliTool: string
}

/** Remove every Cherry-managed key from a CLI tool's native config file,
 * leaving user-owned keys intact. Used on "disable current provider" so stale
 * credentials don't linger. No-op for hermes/openclaw/provider-less tools.
 * Throws on a malformed native file (same parse-safety contract as injection). */
export async function clearCliConfig(args: ClearCliConfigArgs): Promise<void> {
  const { cliTool } = args
  if (!FILE_CONFIGURED_CLI_TOOLS.has(cliTool)) return

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)
      const existing = await readValidatedJson(absPath, 'Claude Code settings')
      const next: Record<string, any> = { ...existing }
      for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
      if (next.env && typeof next.env === 'object') {
        const env = { ...(next.env as Record<string, any>) }
        for (const key of CLAUDE_MANAGED_ENV_KEYS) delete env[key]
        next.env = env
      }
      await window.api.file.write(absPath, `${JSON.stringify(next, null, 2)}\n`)
      return
    }
    case CodeCli.OPENAI_CODEX: {
      const absPath = await resolveAbs(CODEX_CONFIG_PATH)
      const authAbsPath = await resolveAbs(CODEX_AUTH_PATH)
      const existing = await readValidatedToml(absPath, 'Codex config')
      const existingAuth = await readValidatedJson(authAbsPath, 'Codex auth')
      const next: Record<string, any> = {}
      for (const [k, v] of Object.entries(existing)) {
        if (
          !(CODEX_MANAGED_TOP_LEVEL_KEYS as readonly string[]).includes(k) &&
          k !== 'model' &&
          k !== 'model_provider'
        ) {
          next[k] = v
        }
      }
      if (next.model_providers && typeof next.model_providers === 'object') {
        const mp: Record<string, any> = {}
        for (const [k, v] of Object.entries(next.model_providers as Record<string, any>)) {
          if (!k.startsWith(CHERRY_PROVIDER_PREFIX)) mp[k] = v
        }
        next.model_providers = mp
      }
      if (next.features && typeof next.features === 'object') {
        const f = { ...(next.features as Record<string, any>) }
        delete f.goals
        if (Object.keys(f).length === 0) delete next.features
        else next.features = f
      }
      await window.api.file.write(absPath, stringifyToml(next))
      if (existingAuth.OPENAI_API_KEY !== undefined) {
        const nextAuth = { ...existingAuth }
        delete nextAuth.OPENAI_API_KEY
        await window.api.file.write(authAbsPath, `${JSON.stringify(nextAuth, null, 2)}\n`)
      }
      return
    }
    case CodeCli.OPEN_CODE: {
      const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
      const existing = await readValidatedJson(absPath, 'OpenCode config')
      const next: Record<string, any> = { ...existing }
      if (next.provider && typeof next.provider === 'object') {
        const pp: Record<string, any> = {}
        for (const [k, v] of Object.entries(next.provider as Record<string, any>)) {
          if (!k.startsWith(CHERRY_PROVIDER_PREFIX)) pp[k] = v
        }
        next.provider = pp
      }
      await window.api.file.write(absPath, `${JSON.stringify(next, null, 2)}\n`)
      return
    }
    case CodeCli.GEMINI_CLI: {
      const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
      const envMap = parseDotenv(await readExternal(envAbsPath))
      for (const key of GEMINI_MANAGED_ENV_KEYS) envMap.delete(key)
      await window.api.file.write(envAbsPath, `${[...envMap.entries()].map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
      const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
      const settings = await readValidatedJson(settingsAbsPath, 'Gemini CLI settings')
      if (settings.model && typeof settings.model === 'object') {
        delete settings.model.name
        if (Object.keys(settings.model as Record<string, any>).length === 0) delete settings.model
      }
      await window.api.file.write(settingsAbsPath, `${JSON.stringify(settings, null, 2)}\n`)
      return
    }
    case CodeCli.QWEN_CODE: {
      const absPath = await resolveAbs(QWEN_CONFIG_PATH)
      const existing = await readValidatedJson(absPath, 'Qwen Code config')
      const next: Record<string, any> = { ...existing }
      if (next.env && typeof next.env === 'object') {
        const env: Record<string, any> = {}
        for (const [k, v] of Object.entries(next.env as Record<string, any>)) {
          if (!k.startsWith('CHERRY_')) env[k] = v
        }
        next.env = env
      }
      if (next.modelProviders?.openai && typeof next.modelProviders.openai === 'object') {
        const bucket: Record<string, any> = { ...(next.modelProviders.openai as Record<string, any>) }
        if (Array.isArray(bucket.models)) {
          bucket.models = bucket.models.filter(
            (m: any) => !(m && typeof m === 'object' && typeof m.envKey === 'string' && m.envKey.startsWith('CHERRY_'))
          )
        }
        next.modelProviders = { ...(next.modelProviders as Record<string, any>), openai: bucket }
      }
      delete next.model
      await window.api.file.write(absPath, `${JSON.stringify(next, null, 2)}\n`)
      return
    }
    case CodeCli.KIMI_CODE: {
      const absPath = await resolveAbs(KIMI_CONFIG_PATH)
      const existing = await readValidatedToml(absPath, 'Kimi Code config')
      const next: Record<string, any> = { ...existing }
      for (const table of ['providers', 'models'] as const) {
        if (next[table] && typeof next[table] === 'object') {
          const cleaned: Record<string, any> = {}
          for (const [k, v] of Object.entries(next[table] as Record<string, any>)) {
            if (!k.startsWith(CHERRY_PREFIX)) cleaned[k] = v
          }
          next[table] = cleaned
        }
      }
      delete next.default_model
      await window.api.file.write(absPath, stringifyToml(next))
      return
    }
    default:
      return
  }
}
