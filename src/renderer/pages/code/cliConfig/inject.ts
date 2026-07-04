import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'
import { stringify as stringifyToml } from 'smol-toml'

import {
  buildClaudeConfig,
  buildCodexAuthConfig,
  buildCodexConfig,
  buildGeminiEnvConfig,
  buildGeminiSettingsConfig,
  buildKimiConfig,
  buildOpenCodeConfig,
  buildQwenConfig
} from './builders'
import { CHERRY_PREFIX, CODEX_RESPONSES_ENDPOINT, FILE_CONFIGURED_CLI_TOOLS } from './constants'
import { parseDotenv } from './dotenv'
import {
  readExternal,
  readValidatedJson,
  readValidatedToml,
  renderDotenvFile,
  renderJsonFile,
  resolveAbs
} from './file'
import {
  modelSupportsReasoningEffort,
  resolveGeminiBaseUrl,
  resolveOpenAIBaseUrl,
  resolveOpenCodeNpmInfo
} from './resolvers'
import {
  CLAUDE_SETTINGS_PATH,
  CODEX_AUTH_PATH,
  CODEX_CONFIG_PATH,
  GEMINI_ENV_PATH,
  GEMINI_SETTINGS_PATH,
  KIMI_CONFIG_PATH,
  OPENCODE_CONFIG_PATH,
  QWEN_CONFIG_PATH
} from './targets'
import { firstApiKey, getConfigBlob, sanitizeProviderName } from './values'

const logger = loggerService.withContext('injectCliConfig')

/**
 * Renderer-side CLI config file injection for the file-based CLI tools.
 *
 * Injection runs at the "enable config" trigger (see CodeCliPage); launch
 * (`ipcApi.request('code_cli.run', …)`) is terminal-only. OpenClaw config is
 * handled by the main-process OpenClawService, so this function is a no-op for it.
 *
 * There is no namespace-resolve IPC, so the renderer resolves the paths via
 * `window.api.resolvePath` instead of `application.getPath`.
 */
export interface InjectCliConfigArgs {
  cliTool: string
  /** Unique model id ("providerId::modelId"). */
  modelId: string
  /** User-edited config blob (claude-code / codex / opencode consume it). */
  configBlob?: Record<string, unknown>
  /** Claude Code only: whether to write env.ANTHROPIC_MODEL. */
  writePrimaryModel?: boolean
}

/**
 * Resolve provider credentials and write them to the CLI tool's config
 * file. No-op for OpenClaw. Throws on
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
      const blob = getConfigBlob(configBlob)
      await window.api.file.write(
        absPath,
        renderJsonFile(
          buildClaudeConfig(existing, blob, { apiKey, baseUrl, model, writePrimaryModel: args.writePrimaryModel })
        )
      )
      logger.info(`Applied Claude Code config body to ${absPath}`)
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
      const blob = getConfigBlob(configBlob)
      const nextConfig = buildCodexConfig(existing, { baseUrl, providerName, model }, blob)
      const nextAuth = buildCodexAuthConfig(existingAuth, apiKey)
      await window.api.file.write(absPath, stringifyToml(nextConfig))
      try {
        await window.api.file.write(authAbsPath, renderJsonFile(nextAuth))
      } catch (err) {
        await window.api.file
          .write(absPath, stringifyToml(existing))
          .catch((rollbackErr) =>
            logger.error('Failed to roll back Codex config.toml after auth.json write failure:', rollbackErr as Error)
          )
        throw err
      }
      logger.info(`Applied Codex config to ${absPath} + ${authAbsPath}`)
      return
    }
    case CodeCli.OPEN_CODE: {
      const npmInfo = resolveOpenCodeNpmInfo(provider, modelRecord?.endpointTypes)
      const rawUrl = provider.endpointConfigs?.[npmInfo.endpointType]?.baseUrl ?? ''
      const baseUrl = formatApiHost(rawUrl)
      if (!apiKey || !baseUrl) {
        throw new Error('OpenCode config is missing required fields (apiKey/baseUrl)')
      }
      const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
      const existing = await readValidatedJson(absPath, 'OpenCode config')
      const blob = getConfigBlob(configBlob)
      const env = blob.env && typeof blob.env === 'object' ? (blob.env as Record<string, any>) : {}
      const nextConfig = buildOpenCodeConfig(
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
      await window.api.file.write(absPath, renderJsonFile(nextConfig))
      logger.info(`Applied OpenCode config to ${absPath}`)
      return
    }
    case CodeCli.GEMINI_CLI: {
      const baseUrl = resolveGeminiBaseUrl(provider)
      if (!apiKey) {
        throw new Error('Gemini CLI config is missing the API key')
      }
      const envMap = parseDotenv(await readExternal(await resolveAbs(GEMINI_ENV_PATH)))
      const settings = await readValidatedJson(await resolveAbs(GEMINI_SETTINGS_PATH), 'Gemini CLI settings')
      const blob = getConfigBlob(configBlob)
      const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
      const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
      await window.api.file.write(envAbsPath, renderDotenvFile(buildGeminiEnvConfig(envMap, { apiKey, baseUrl })))
      await window.api.file.write(settingsAbsPath, renderJsonFile(buildGeminiSettingsConfig(settings, { model }, blob)))
      logger.info(`Applied Gemini CLI config to ${envAbsPath} + ${settingsAbsPath}`)
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
      const blob = getConfigBlob(configBlob)
      await window.api.file.write(
        absPath,
        renderJsonFile(buildQwenConfig(existing, { apiKey, baseUrl, model, modelLabel }, blob))
      )
      logger.info(`Applied Qwen Code config to ${absPath}`)
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
      const maxContextSize = modelRecord?.contextWindow ?? 128000
      const blob = getConfigBlob(configBlob)
      await window.api.file.write(
        absPath,
        stringifyToml(buildKimiConfig(existing, { apiKey, baseUrl, model, modelKey, maxContextSize }, blob))
      )
      logger.info(`Applied Kimi CLI config to ${absPath}`)
      return
    }
    default:
      return
  }
}
