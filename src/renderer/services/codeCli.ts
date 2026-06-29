import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { parse as parseJsonc } from 'jsonc-parser'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

const logger = loggerService.withContext('injectCliConfig')

/**
 * Renderer-side native-config injection for the file-based CLI tools.
 *
 * Injection runs at the "enable config" trigger (see CodeCliPage); launch
 * (`window.api.codeCli.run`) is terminal-only. Hermes and OpenClaw are
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

/**
 * Top-level keys Cherry manages inside ~/.claude/settings.json. Cleared on
 * config switch so each config is self-contained (no leakage across configs).
 */
const CLAUDE_MANAGED_TOP_LEVEL_KEYS = ['attribution'] as const
/**
 * env keys Cherry manages inside the `env` block of ~/.claude/settings.json.
 * Must cover everything ClaudeConfigFields can write plus the credentials
 * injected here — a missing entry leaks the previous config's value on switch.
 */
const CLAUDE_MANAGED_ENV_KEYS = [
  // Credentials + request model injected here
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  // Model role mapping (each role writes both _MODEL and _MODEL_NAME)
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  // Quick-option toggles
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'DISABLE_AUTOUPDATER'
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

function parseTomlSafe(content: string): Record<string, any> {
  if (!content) return {}
  try {
    return parseToml(content) as Record<string, any>
  } catch {
    return {}
  }
}

function parseJsonSafe(content: string): Record<string, any> {
  if (!content) return {}
  const parsed = parseJsonc(content, undefined, { allowTrailingComma: true, disallowComments: false })
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

function resolveNpmPackage(providerType: string): string {
  return providerType === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible'
}

/** Whether a model advertises reasoning-effort support (shapes opencode's
 * `reasoningEffort` option for openai-compatible providers). */
function modelSupportsReasoningEffort(modelRecord: Model | null): boolean {
  return !!modelRecord?.reasoning?.supportedEfforts?.length
}

/** Apply the claude-code config body to ~/.claude/settings.json (merged). */
async function writeClaude(
  userBlob: Record<string, any>,
  resolved: { apiKey: string; baseUrl: string; model: string }
): Promise<void> {
  const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)
  const existing = parseJsonSafe(await readExternal(absPath))

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
    wireApi: 'responses' | 'chat_completions'
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
    model_reasoning_effort: 'high',
    disable_response_storage: true,
    model_providers: {
      ...preservedProviders,
      [providerKey]: {
        // `name = "OpenAI"` opts into Codex's remote (server-side) compaction.
        name: options.remoteCompaction ? 'OpenAI' : providerName,
        base_url: baseUrl.replace(/\/$/, ''),
        wire_api: resolved.wireApi,
        requires_openai_auth: true
      }
    }
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
  await window.api.file.write(absPath, stringifyToml(merged))
  await window.api.file.write(authAbsPath, `${JSON.stringify(mergedAuth, null, 2)}\n`)
  logger.info(`Applied Codex config to ${absPath} + ${authAbsPath}`)
}

/** Per-config OpenCode model options read from the user-edited config blob. */
interface OpenCodeModelOptions {
  reasoning: boolean
  supportsReasoningEffort: boolean
}

/** Apply the opencode config to ~/.config/opencode/opencode.json (merged). */
async function writeOpenCode(
  existing: Record<string, any>,
  provider: Provider,
  resolved: { apiKey: string; baseUrl: string; model: string; isAnthropic: boolean },
  options: OpenCodeModelOptions
): Promise<void> {
  const { apiKey, baseUrl, model, isAnthropic } = resolved
  const providerType = isAnthropic ? 'anthropic' : 'openai'
  const providerName = sanitizeProviderName(provider.name, provider.id)

  const modelConfig: Record<string, any> = { name: model }
  if (options.reasoning) {
    modelConfig.reasoning = true
    if (isAnthropic) {
      modelConfig.options = { thinking: { budgetTokens: 10000, type: 'enabled' } }
    } else if (options.supportsReasoningEffort) {
      modelConfig.options = { reasoningEffort: 'medium' }
    }
  }

  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`
  const cherryProvider = {
    npm: resolveNpmPackage(providerType),
    name: providerKey,
    options: { apiKey, baseURL: baseUrl },
    models: { [model]: modelConfig }
  }
  const existingProviders = existing.provider && typeof existing.provider === 'object' ? existing.provider : {}
  const preservedProviders = Object.fromEntries(
    Object.entries(existingProviders).filter(([key]) => !key.startsWith(CHERRY_PROVIDER_PREFIX))
  )
  const merged = {
    $schema: OPENCODE_SCHEMA,
    ...existing,
    provider: { ...preservedProviders, [providerKey]: cherryProvider }
  }
  const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
  await window.api.file.write(absPath, `${JSON.stringify(merged, null, 2)}\n`)
  logger.info(`Applied OpenCode config to ${absPath}`)
}

export interface InjectCliConfigArgs {
  cliTool: string
  /** Unique model id ("providerId::modelId"). */
  modelId: string
  /** User-edited config blob (claude-code, codex, and opencode consume it). */
  configBlob?: Record<string, unknown>
}

/**
 * Resolve provider credentials and write them to the CLI tool's native config
 * file. No-op for hermes/openclaw (still injected in main `run()`). Throws on
 * failure so callers can surface a toast.
 */
export async function injectCliConfig(args: InjectCliConfigArgs): Promise<void> {
  const { cliTool, configBlob } = args

  // Only the file-based tools are injected here.
  if (cliTool !== CodeCli.CLAUDE_CODE && cliTool !== CodeCli.OPENAI_CODEX && cliTool !== CodeCli.OPEN_CODE) {
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
      await writeClaude(configBlob && typeof configBlob === 'object' ? (configBlob as Record<string, any>) : {}, {
        apiKey,
        baseUrl,
        model
      })
      return
    }
    case CodeCli.OPENAI_CODEX: {
      const responsesUrl = provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl
      const chatUrl = provider.endpointConfigs?.[CODEX_CHAT_ENDPOINT]?.baseUrl
      const baseUrl = responsesUrl ?? chatUrl ?? ''
      const wireApi: 'responses' | 'chat_completions' = responsesUrl ? 'responses' : 'chat_completions'
      const providerName = sanitizeProviderName(provider.name, provider.id)
      if (!apiKey) {
        throw new Error('Codex config is missing the API key')
      }
      if (!baseUrl) {
        throw new Error('Codex config is missing the OpenAI endpoint base URL')
      }
      const absPath = await resolveAbs(CODEX_CONFIG_PATH)
      const authAbsPath = await resolveAbs(CODEX_AUTH_PATH)
      const existing = parseTomlSafe(await readExternal(absPath))
      const existingAuth = parseJsonSafe(await readExternal(authAbsPath))
      const blob = configBlob && typeof configBlob === 'object' ? (configBlob as Record<string, any>) : {}
      await writeCodex(
        existing,
        existingAuth,
        { apiKey, baseUrl, providerName, model, wireApi },
        {
          goalMode: blob.goalMode === true,
          remoteCompaction: blob.remoteCompaction === true
        }
      )
      return
    }
    case CodeCli.OPEN_CODE: {
      const isAnthropic = !!provider.endpointConfigs?.['anthropic-messages']?.baseUrl
      const endpointType = isAnthropic
        ? 'anthropic-messages'
        : (provider.defaultChatEndpoint ?? 'openai-chat-completions')
      const baseUrl = provider.endpointConfigs?.[endpointType]?.baseUrl ?? ''
      if (!apiKey || !baseUrl) {
        throw new Error('OpenCode config is missing required fields (apiKey/baseUrl)')
      }
      const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
      const existing = parseJsonSafe(await readExternal(absPath))
      const env =
        configBlob && typeof configBlob.env === 'object' && configBlob.env
          ? (configBlob.env as Record<string, any>)
          : {}
      await writeOpenCode(
        existing,
        provider,
        { apiKey, baseUrl, model, isAnthropic },
        {
          reasoning: env.OPENCODE_REASONING === 'true',
          supportsReasoningEffort: modelSupportsReasoningEffort(modelRecord)
        }
      )
      return
    }
    default:
      return
  }
}
