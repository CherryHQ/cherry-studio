import { dataApiService } from '@data/DataApiService'
import type { Model } from '@shared/data/types/model'
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
import { CHERRY_PROVIDER_PREFIX, CODEX_RESPONSES_ENDPOINT } from './constants'
import { parseDotenv } from './dotenv'
import { makeDraftFile, readDraftFileText, validateCliConfigDraftForWrite } from './draftFiles'
import {
  parseJsonOrThrow,
  parseTomlOrThrow,
  renderDotenvFile,
  renderJsonFile,
  resolveAbs,
  writeExternalConfigFile
} from './file'
import type { InjectCliConfigArgs } from './inject'
import { injectCliConfig } from './inject'
import { asRecord } from './managedKeys'
import {
  modelSupportsReasoningEffort,
  resolveGeminiBaseUrl,
  resolveOpenAIBaseUrl,
  resolveOpenCodeNpmInfo
} from './resolvers'
import { CLI_CONFIG_FILE_SPECS, FILE_CONFIGURED_CLI_TOOLS, getCliConfigTargets } from './targets'
import type { CliConfigFileDraft } from './types'
import { firstApiKey, getConfigBlob, numberValue, sanitizeProviderName, stringValue } from './values'

interface FileSnapshot {
  path: string
  existed: boolean
  previousContent: string
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  try {
    return {
      path,
      existed: true,
      previousContent: await window.api.file.readExternal(path)
    }
  } catch {
    return {
      path,
      existed: false,
      previousContent: ''
    }
  }
}

interface ResolvedCliConfigContext {
  provider: Provider
  apiKey: string
  model: string
  modelRecord: Model | null
  configBlob: Record<string, any>
}

async function resolveContext(args: InjectCliConfigArgs): Promise<ResolvedCliConfigContext | null> {
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

  return {
    provider,
    apiKey: firstApiKey(apiKeysRes?.keys),
    model,
    modelRecord,
    configBlob: getConfigBlob(args.configBlob)
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
  args: InjectCliConfigArgs & { files?: CliConfigFileDraft[] }
): Promise<CliConfigFileDraft[]> {
  const context = await resolveContext(args)
  if (!context) return []
  const { cliTool, files } = args
  const { provider, apiKey, model, modelRecord, configBlob } = context

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const existing = parseJsonOrThrow(await readDraftFileText('claude-settings', files))
      const baseUrl = provider.endpointConfigs?.['anthropic-messages']?.baseUrl ?? ''
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
      const responsesUrl = provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl
      if (!responsesUrl) {
        throw new Error('Codex requires an OpenAI Responses API endpoint, which this provider does not expose')
      }
      const config = parseTomlOrThrow(await readDraftFileText('codex-config', files))
      const auth = parseJsonOrThrow(await readDraftFileText('codex-auth', files))
      const providerName = sanitizeProviderName(provider.name, provider.id)
      return [
        await makeDraftFile(
          'codex-config',
          stringifyToml(
            buildCodexConfig(config, { baseUrl: formatApiHost(responsesUrl), providerName, model }, configBlob)
          )
        ),
        await makeDraftFile('codex-auth', renderJsonFile(buildCodexAuthConfig(auth, apiKey)))
      ]
    }
    case CodeCli.OPEN_CODE: {
      const npmInfo = resolveOpenCodeNpmInfo(provider, modelRecord?.endpointTypes)
      const baseUrl = formatApiHost(provider.endpointConfigs?.[npmInfo.endpointType]?.baseUrl ?? '')
      const existing = parseJsonOrThrow(await readDraftFileText('opencode-config', files))
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
                reasoningEffort: stringValue(configBlob.reasoningEffort),
                thinkingBudgetTokens: numberValue(configBlob.thinkingBudgetTokens),
                autoCompact: configBlob.autoCompact === true,
                maxTurns: numberValue(configBlob.maxTurns)
              }
            )
          )
        )
      ]
    }
    case CodeCli.GEMINI_CLI: {
      const envMap = parseDotenv(await readDraftFileText('gemini-env', files))
      const settings = parseJsonOrThrow(await readDraftFileText('gemini-settings', files))
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
      const existing = parseJsonOrThrow(await readDraftFileText('qwen-settings', files))
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
      const existing = parseTomlOrThrow(await readDraftFileText('kimi-config', files))
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

export async function writeCliConfigDraft(args: {
  cliTool: string
  modelId?: string
  configBlob?: Record<string, unknown>
  files?: CliConfigFileDraft[]
  writePrimaryModel?: boolean
}): Promise<unknown> {
  if (!args.files?.length) {
    if (!args.modelId) throw new Error('Cannot write CLI config without a model id')
    return injectCliConfig({
      cliTool: args.cliTool,
      modelId: args.modelId,
      configBlob: args.configBlob,
      writePrimaryModel: args.writePrimaryModel
    })
  }
  validateCliConfigDraftForWrite(args.files)

  const snapshots: FileSnapshot[] = []
  const writeTargets = await Promise.all(
    args.files.map(async (file) => ({
      path: file.path || (await resolveAbs(CLI_CONFIG_FILE_SPECS[file.target].path)),
      content: file.content
    }))
  )

  try {
    for (const target of writeTargets) {
      snapshots.push(await snapshotFile(target.path))
      await writeExternalConfigFile(target.path, target.content)
    }
  } catch (error) {
    for (const snapshot of snapshots.reverse()) {
      if (snapshot.existed) {
        await writeExternalConfigFile(snapshot.path, snapshot.previousContent)
      } else {
        await window.api.file.deleteExternalFile(snapshot.path).catch(() => undefined)
      }
    }
    throw error
  }
  return undefined
}
