import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'
import { isOllamaProvider, OLLAMA_PLACEHOLDER_AUTH_TOKEN } from '@shared/utils/provider'
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
import { CHERRY_PROVIDER_PREFIX } from './constants'
import { parseDotenv, renderDotenvFile } from './dotenv'
import { makeDraftFile, readAndParseDraftFile, readDraftFileText, validateCliConfigDraftForWrite } from './draftFiles'
import {
  parseJsonOrThrow,
  parseTomlOrThrow,
  readExternalOrNull,
  renderJsonFile,
  resolveAbs,
  writeExternalConfigFile
} from './file'
import {
  buildCodexOwnLoginConfig,
  buildGeminiOwnLoginSettings,
  buildKimiOwnLoginConfig,
  buildQwenOwnLoginConfig
} from './ownLogin'
import {
  modelSupportsReasoningEffort,
  resolveClaudeBaseUrl,
  resolveCodexBaseUrl,
  resolveGeminiBaseUrl,
  resolveOpenAIBaseUrl,
  resolveOpenCodeNpmInfo
} from './resolvers'
import { sanitizeCliConfigBlob } from './sanitize'
import { CLI_CONFIG_FILE_SPECS, FILE_CONFIGURED_CLI_TOOLS, getCliConfigTargets } from './targets'
import type { CliConfigFileDraft } from './types'
import { asRecord, firstApiKey, sanitizeProviderName } from './values'

const logger = loggerService.withContext('writeCliConfigDraft')

/**
 * Renderer-side CLI config file writing for the file-based CLI tools.
 *
 * Injection runs at the "enable config" trigger (see CodeCliPage); launch
 * (`ipcApi.request('code_cli.run', …)`) is terminal-only. OpenClaw config is
 * handled by the main-process OpenClawService, so this module is a no-op for it.
 *
 * There is no namespace-resolve IPC, so the renderer resolves the paths via
 * `window.api.resolvePath` instead of `application.getPath`.
 */
export interface CliConfigWriteArgs {
  cliTool: string
  /** Unique model id ("providerId::modelId"). */
  modelId: string
  /** User-edited config blob (claude-code / codex / opencode consume it). */
  configBlob?: Record<string, unknown>
  /** Claude Code only: whether to write env.ANTHROPIC_MODEL. */
  writePrimaryModel?: boolean
}

interface FileSnapshot {
  path: string
  existed: boolean
  previousContent: string
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  const previousContent = await readExternalOrNull(path)
  return { path, existed: previousContent !== null, previousContent: previousContent ?? '' }
}

interface ResolvedCliConfigContext {
  provider: Provider
  apiKey: string
  model: string
  modelRecord: Model | null
  configBlob: Record<string, any>
}

/**
 * File-configured tools Ollama can actually be selected for — it only exposes
 * an anthropic-messages endpoint (see CLI_TOOL_PROVIDER_MAP), so Codex/Gemini
 * CLI/Qwen Code/Kimi CLI never offer it as a provider option.
 */
const OLLAMA_FALLBACK_TOOLS: string[] = [CodeCli.CLAUDE_CODE, CodeCli.OPEN_CODE]

async function resolveContext(args: CliConfigWriteArgs): Promise<ResolvedCliConfigContext | null> {
  if (!FILE_CONFIGURED_CLI_TOOLS.has(args.cliTool)) return null
  if (!isUniqueModelId(args.modelId)) {
    throw new Error(`Invalid model id: ${args.modelId}`)
  }
  const { providerId, modelId: model } = parseUniqueModelId(args.modelId)
  // The three reads are independent; run them concurrently (this resolver reruns
  // on every advanced-field keystroke in the edit panel).
  const [provider, apiKeysRes, modelRecord] = await Promise.all([
    dataApiService.get(`/providers/${providerId}`) as Promise<Provider | undefined>,
    dataApiService.get(`/providers/${providerId}/api-keys`) as Promise<{ keys?: ApiKeyEntry[] } | undefined>,
    dataApiService.get(`/models/${args.modelId}`).catch(() => null)
  ])
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  const apiKey = firstApiKey(apiKeysRes?.keys)
  // Ollama's local server needs no real credential, but the Claude Code and
  // OpenCode SDKs still require a non-empty auth token — mirrors the same
  // fallback used for the in-app agent runtime (agentSessionWarmup.ts).
  const effectiveApiKey =
    apiKey ||
    (OLLAMA_FALLBACK_TOOLS.includes(args.cliTool) && isOllamaProvider(provider) ? OLLAMA_PLACEHOLDER_AUTH_TOKEN : '')

  return {
    provider,
    apiKey: effectiveApiKey,
    model,
    modelRecord,
    configBlob: sanitizeCliConfigBlob(args.cliTool, args.configBlob)
  }
}

export async function readCliConfigFiles(
  cliTool: string,
  options: { includeEmpty?: boolean } = {}
): Promise<CliConfigFileDraft[]> {
  const files = await Promise.all(
    getCliConfigTargets(cliTool).map(async (target) => makeDraftFile(target, await readDraftFileText(target)))
  )
  return options.includeEmpty || files.some((file) => file.content.trim()) ? files : []
}

export async function readCliConfigDraft(
  args: CliConfigWriteArgs & { files?: CliConfigFileDraft[] }
): Promise<CliConfigFileDraft[]> {
  const context = await resolveContext(args)
  if (!context) return []
  return buildCliConfigDraftFiles(args, context)
}

async function buildCliConfigDraftFiles(
  args: CliConfigWriteArgs & { files?: CliConfigFileDraft[] },
  context: ResolvedCliConfigContext
): Promise<CliConfigFileDraft[]> {
  const { cliTool, files } = args
  const { provider, apiKey, model, modelRecord, configBlob } = context

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const existing = await readAndParseDraftFile('claude-settings', parseJsonOrThrow, files)
      const baseUrl = resolveClaudeBaseUrl(provider)
      return [
        await makeDraftFile(
          'claude-settings',
          renderJsonFile(
            buildClaudeConfig(existing, configBlob, {
              apiKey,
              baseUrl,
              model,
              writePrimaryModel: args.writePrimaryModel
            })
          )
        )
      ]
    }
    case CodeCli.OPENAI_CODEX: {
      const responsesUrl = resolveCodexBaseUrl(provider)
      if (!responsesUrl) {
        throw new Error('Codex requires an OpenAI Responses API endpoint, which this provider does not expose')
      }
      const config = await readAndParseDraftFile('codex-config', parseTomlOrThrow, files)
      const auth = await readAndParseDraftFile('codex-auth', parseJsonOrThrow, files)
      const providerName = sanitizeProviderName(provider.name, provider.id)
      return [
        await makeDraftFile(
          'codex-config',
          stringifyToml(buildCodexConfig(config, { baseUrl: responsesUrl, providerName, model }, configBlob))
        ),
        await makeDraftFile('codex-auth', renderJsonFile(buildCodexAuthConfig(auth, apiKey)))
      ]
    }
    case CodeCli.OPEN_CODE: {
      const npmInfo = resolveOpenCodeNpmInfo(provider, modelRecord?.endpointTypes)
      const baseUrl = formatApiHost(provider.endpointConfigs?.[npmInfo.endpointType]?.baseUrl ?? '')
      const existing = await readAndParseDraftFile('opencode-config', parseJsonOrThrow, files)
      const env = asRecord(configBlob.env)
      return [
        await makeDraftFile(
          'opencode-config',
          renderJsonFile(
            buildOpenCodeConfig(
              existing,
              provider,
              npmInfo,
              { apiKey, baseUrl, model },
              {
                reasoning: env.OPENCODE_REASONING === 'true',
                supportsReasoningEffort: modelSupportsReasoningEffort(modelRecord),
                autoCompact: configBlob.autoCompact === true,
                permissionMode: configBlob.permissionMode
              }
            )
          )
        )
      ]
    }
    case CodeCli.GEMINI_CLI: {
      const envMap = parseDotenv(await readDraftFileText('gemini-env', files))
      const settings = await readAndParseDraftFile('gemini-settings', parseJsonOrThrow, files)
      const baseUrl = resolveGeminiBaseUrl(provider)
      return [
        await makeDraftFile('gemini-env', renderDotenvFile(buildGeminiEnvConfig(envMap, { apiKey, baseUrl }))),
        await makeDraftFile(
          'gemini-settings',
          renderJsonFile(buildGeminiSettingsConfig(settings, { model }, configBlob))
        )
      ]
    }
    case CodeCli.QWEN_CODE: {
      const baseUrl = resolveOpenAIBaseUrl(provider)
      const existing = await readAndParseDraftFile('qwen-settings', parseJsonOrThrow, files)
      return [
        await makeDraftFile(
          'qwen-settings',
          renderJsonFile(
            buildQwenConfig(existing, { apiKey, baseUrl, model, modelLabel: modelRecord?.name ?? model }, configBlob)
          )
        )
      ]
    }
    case CodeCli.KIMI_CODE: {
      const baseUrl = resolveOpenAIBaseUrl(provider)
      const existing = await readAndParseDraftFile('kimi-config', parseTomlOrThrow, files)
      const providerName = sanitizeProviderName(provider.name, provider.id)
      return [
        await makeDraftFile(
          'kimi-config',
          stringifyToml(
            buildKimiConfig(
              existing,
              {
                apiKey,
                baseUrl,
                model,
                modelKey: `${CHERRY_PROVIDER_PREFIX}${providerName}`,
                maxContextSize: modelRecord?.contextWindow ?? 128000
              },
              configBlob
            )
          )
        )
      ]
    }
    default:
      return []
  }
}

/**
 * Per-tool required-credential checks (missing apiKey/baseUrl). Run only on the
 * immediate-write path, before anything is read/written — preview
 * (`readCliConfigDraft`) tolerates incomplete credentials and just renders
 * around them, so it must never call this.
 */
function assertCliConfigCredentials(cliTool: string, context: ResolvedCliConfigContext): void {
  const { provider, apiKey, modelRecord } = context
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      if (!apiKey) throw new Error('Claude Code config is missing the API key')
      return
    case CodeCli.OPENAI_CODEX:
      if (!apiKey) throw new Error('Codex config is missing the API key')
      return
    case CodeCli.OPEN_CODE: {
      const npmInfo = resolveOpenCodeNpmInfo(provider, modelRecord?.endpointTypes)
      const baseUrl = formatApiHost(provider.endpointConfigs?.[npmInfo.endpointType]?.baseUrl ?? '')
      if (!apiKey || !baseUrl) throw new Error('OpenCode config is missing required fields (apiKey/baseUrl)')
      return
    }
    case CodeCli.GEMINI_CLI:
      if (!apiKey) throw new Error('Gemini CLI config is missing the API key')
      return
    case CodeCli.QWEN_CODE:
      if (!apiKey) throw new Error('Qwen Code config is missing the API key')
      if (!resolveOpenAIBaseUrl(provider)) throw new Error('Qwen Code config is missing the OpenAI endpoint base URL')
      return
    case CodeCli.KIMI_CODE:
      if (!apiKey) throw new Error('Kimi CLI config is missing the API key')
      if (!resolveOpenAIBaseUrl(provider)) throw new Error('Kimi CLI config is missing the OpenAI endpoint base URL')
      return
    default:
      return
  }
}

export async function writeCliConfigDraft(args: {
  cliTool: string
  modelId?: string
  configBlob?: Record<string, unknown>
  files?: CliConfigFileDraft[]
  writePrimaryModel?: boolean
}): Promise<unknown> {
  let files = args.files
  if (args.modelId) {
    const writeArgs = {
      cliTool: args.cliTool,
      modelId: args.modelId,
      configBlob: args.configBlob,
      writePrimaryModel: args.writePrimaryModel
    }
    const context = await resolveContext(writeArgs)
    if (!context) return
    assertCliConfigCredentials(args.cliTool, context)
    if (!files?.length) {
      files = await buildCliConfigDraftFiles(writeArgs, context)
    }
  } else if (!files?.length) {
    throw new Error('Cannot write CLI config without a model id')
  }
  validateCliConfigDraftForWrite(files)

  const snapshots: FileSnapshot[] = []
  const writeTargets = await Promise.all(
    files.map(async (file) => ({
      path: file.path || (await resolveAbs(CLI_CONFIG_FILE_SPECS[file.target].path)),
      content: file.content
    }))
  )

  try {
    let writeQueue = Promise.resolve()
    for (const target of writeTargets) {
      writeQueue = writeQueue.then(async () => {
        snapshots.push(await snapshotFile(target.path))
        await writeExternalConfigFile(target.path, target.content)
        logger.info(`Applied ${args.cliTool} config to ${target.path}`)
      })
    }
    await writeQueue
  } catch (error) {
    let rollbackQueue = Promise.resolve()
    for (const snapshot of snapshots.slice().reverse()) {
      rollbackQueue = rollbackQueue.then(async () => {
        if (snapshot.existed) {
          await writeExternalConfigFile(snapshot.path, snapshot.previousContent).catch((rollbackError) => {
            logger.error(`Failed to roll back ${snapshot.path} after write failure`, rollbackError as Error)
          })
        } else {
          await window.api.file.deleteExternalFile(snapshot.path).catch((rollbackError) => {
            logger.error(`Failed to delete ${snapshot.path} during rollback`, rollbackError as Error)
          })
        }
      })
    }
    await rollbackQueue
    throw error
  }
  return undefined
}

/**
 * Login-capable tools whose "own login" entry also exposes a config panel (tool
 * params only, no model/credentials). Each must have a `buildOwnLoginConfigDraftFiles`
 * case. Qoder / GitHub Copilot are fully provider-less and never reach here.
 */
const OWN_LOGIN_CONFIGURABLE_TOOLS = new Set<string>([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

export function isOwnLoginConfigurable(cliTool: string): boolean {
  return OWN_LOGIN_CONFIGURABLE_TOOLS.has(cliTool)
}

/**
 * Build the tool-param config file for an "own login" selection: the user's tool
 * params (permission mode / effort / toggles) with no credentials or model, so
 * the CLI keeps using its own stored account login. The per-tool builders strip
 * every Cherry-managed credential/model/provider key and re-apply only the tool
 * params. Credential-only side files (Codex `auth.json`, Gemini `.env`) carry no
 * tool params and are scrubbed by `clearCliConfig` on select, not here.
 */
async function buildOwnLoginConfigDraftFiles(
  cliTool: string,
  configBlob: Record<string, unknown>
): Promise<CliConfigFileDraft[]> {
  const blob = sanitizeCliConfigBlob(cliTool, configBlob)
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const existing = await readAndParseDraftFile('claude-settings', parseJsonOrThrow)
      return [
        await makeDraftFile(
          'claude-settings',
          renderJsonFile(
            buildClaudeConfig(existing, blob, { apiKey: '', baseUrl: '', model: '', writePrimaryModel: false })
          )
        )
      ]
    }
    case CodeCli.OPENAI_CODEX: {
      const config = await readAndParseDraftFile('codex-config', parseTomlOrThrow)
      return [await makeDraftFile('codex-config', stringifyToml(buildCodexOwnLoginConfig(config, blob)))]
    }
    case CodeCli.GEMINI_CLI: {
      const settings = await readAndParseDraftFile('gemini-settings', parseJsonOrThrow)
      return [await makeDraftFile('gemini-settings', renderJsonFile(buildGeminiOwnLoginSettings(settings, blob)))]
    }
    case CodeCli.QWEN_CODE: {
      const existing = await readAndParseDraftFile('qwen-settings', parseJsonOrThrow)
      return [await makeDraftFile('qwen-settings', renderJsonFile(buildQwenOwnLoginConfig(existing, blob)))]
    }
    case CodeCli.KIMI_CODE: {
      const existing = await readAndParseDraftFile('kimi-config', parseTomlOrThrow)
      return [await makeDraftFile('kimi-config', stringifyToml(buildKimiOwnLoginConfig(existing, blob)))]
    }
    default:
      throw new Error(`Own-login config is not supported for ${cliTool}`)
  }
}

/**
 * Build (but do not write) the "own login" CLI config file draft — the raw file
 * preview shown in the config panel's advanced editor, so power users can hand-
 * edit `settings.json` on top of the tool params.
 */
export async function readOwnLoginCliConfigDraft(args: {
  cliTool: string
  configBlob?: Record<string, unknown>
}): Promise<CliConfigFileDraft[]> {
  return buildOwnLoginConfigDraftFiles(args.cliTool, args.configBlob ?? {})
}

/**
 * Apply an "own login" config to the CLI config file without writing any
 * credentials/model. Writes hand-edited `files` verbatim when provided,
 * otherwise rebuilds them from the tool params. Reuses `writeCliConfigDraft`'s
 * files path (snapshot + rollback), bypassing the credential-requiring
 * `resolveContext`.
 */
export async function writeOwnLoginCliConfigDraft(args: {
  cliTool: string
  configBlob?: Record<string, unknown>
  files?: CliConfigFileDraft[]
}): Promise<void> {
  const files = args.files?.length
    ? args.files
    : await buildOwnLoginConfigDraftFiles(args.cliTool, args.configBlob ?? {})
  await writeCliConfigDraft({ cliTool: args.cliTool, files })
}
