import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { FILE_CONFIGURED_CLI_TOOLS, getCliConfigTargets, isFileConfiguredCli } from '@shared/utils/cliConfig'
import { isOllamaProvider, OLLAMA_PLACEHOLDER_AUTH_TOKEN } from '@shared/utils/provider'

import { getAdapter, sanitizeCliConfigBlob } from './adapters'
import { makeDraftFile, readDraftFileText, validateCliConfigDraftForWrite } from './draftFiles'
import type {
  CliConfigDraftBuildArgs,
  CliConfigFileDraft,
  CliConfigGatewayContext,
  CliConfigWriteArgs,
  ResolvedCliConfigContext
} from './types'
import { firstApiKey } from './values'

const logger = loggerService.withContext('writeCliConfigDraft')

/**
 * Renderer-side CLI config drafting for the file-based CLI tools.
 *
 * This module builds and validates the config-file drafts; the disk write is
 * main-process (`code_cli.write_config`, which owns path resolution, atomic
 * 0600 writes, and snapshot/rollback). Injection runs at the "enable config"
 * trigger (see CodeCliPage); launch (`ipcApi.request('code_cli.run', …)`) is
 * terminal-only. OpenClaw config is handled by the main-process
 * OpenClawService, so this module is a no-op for it.
 */

/**
 * File-configured tools Ollama can actually be selected for — it only exposes
 * an anthropic-messages endpoint (see CLI_TOOL_PROVIDER_MAP), so Codex/Gemini
 * CLI/Qwen Code/Kimi CLI never offer it as a provider option.
 */
const OLLAMA_FALLBACK_TOOLS: string[] = [CodeCli.CLAUDE_CODE, CodeCli.OPEN_CODE, CodeCli.PI]

async function resolveContext(args: CliConfigWriteArgs): Promise<ResolvedCliConfigContext | null> {
  if (!FILE_CONFIGURED_CLI_TOOLS.has(args.cliTool)) return null
  if (!isUniqueModelId(args.modelId)) {
    throw new Error(`Invalid model id: ${args.modelId}`)
  }
  const { providerId, modelId: model } = parseUniqueModelId(args.modelId)

  // Cherry gateway: resolve against the synthetic gateway provider + gateway key instead of the
  // real provider, and write the gateway-addressed model id ("providerId:apiModelId"). The real
  // provider key is never fetched, so it can't land in the CLI config file. Model metadata is still
  // read by the real model id (for contextWindow etc.); a failed read degrades to the raw model id.
  if (args.gateway) {
    const modelRecord = await dataApiService
      .get(`/models/${args.modelId}`)
      .then((record) => record as Model | null)
      .catch((error) => {
        logger.warn(`Failed to load model record for ${args.modelId}`, error as Error)
        return null
      })
    return {
      provider: args.gateway.provider,
      apiKey: args.gateway.apiKey,
      model: formatGatewayModelId(providerId, modelRecord?.apiModelId ?? model),
      // The gateway addressing id is UUID-prefixed and unreadable; label with the model's
      // display name (falling back to the bare model id) for CLIs that show one.
      modelLabel: modelRecord?.name ?? modelRecord?.apiModelId ?? model,
      modelRecord,
      configBlob: sanitizeCliConfigBlob(args.cliTool, args.configBlob)
    }
  }
  // The three reads are independent; run them concurrently (this resolver reruns
  // on every advanced-field keystroke in the edit panel).
  const [provider, apiKeysRes, modelRecord] = await Promise.all([
    dataApiService.get(`/providers/${providerId}`) as Promise<Provider | undefined>,
    dataApiService.get(`/providers/${providerId}/api-keys`) as Promise<{ keys?: ApiKeyEntry[] } | undefined>,
    // Model metadata only tunes optional fields (endpoint pick, context window),
    // so a fetch failure degrades the config quietly — leave a breadcrumb.
    dataApiService
      .get(`/models/${args.modelId}`)
      .catch((error) => {
        logger.warn(`Failed to load model record for ${args.modelId}`, error as Error)
        return null
      })
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
    modelLabel: modelRecord?.name ?? model,
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

export async function readCliConfigDraft(args: CliConfigDraftBuildArgs): Promise<CliConfigFileDraft[]> {
  const context = await resolveContext(args)
  if (!context) return []
  return buildCliConfigDraftFiles(args, context)
}

async function buildCliConfigDraftFiles(
  args: CliConfigDraftBuildArgs,
  context: ResolvedCliConfigContext
): Promise<CliConfigFileDraft[]> {
  return (await getAdapter(args.cliTool)?.buildDraft(args, context)) ?? []
}

/**
 * Per-tool required-credential checks (missing apiKey/baseUrl). Run only on the
 * immediate-write path, before anything is read/written — preview
 * (`readCliConfigDraft`) tolerates incomplete credentials and just renders
 * around them, so it must never call this.
 */
function assertCliConfigCredentials(cliTool: string, context: ResolvedCliConfigContext): void {
  getAdapter(cliTool)?.assertCredentials(context)
}

export async function writeCliConfigDraft(args: {
  cliTool: string
  modelId?: UniqueModelId
  configBlob?: Record<string, unknown>
  files?: CliConfigFileDraft[]
  writePrimaryModel?: boolean
  gateway?: CliConfigGatewayContext
}): Promise<unknown> {
  let files = args.files
  if (args.modelId) {
    const writeArgs: CliConfigDraftBuildArgs = {
      cliTool: args.cliTool,
      modelId: args.modelId,
      configBlob: args.configBlob,
      writePrimaryModel: args.writePrimaryModel,
      gateway: args.gateway,
      files: args.files
    }
    const context = await resolveContext(writeArgs)
    if (!context) return
    assertCliConfigCredentials(args.cliTool, context)
    // Gateway: always rebuild so the freshly-resolved gateway key/model is (re)injected — the preview
    // draft may carry a stale/empty key built before the gateway started. Passing `args.files` as the
    // merge base keeps the user's hand-edited unmanaged fields (managed credential/model are
    // overwritten). Real providers keep writing an explicitly-supplied hand-edited draft through verbatim.
    if (args.gateway || !files?.length) {
      files = await buildCliConfigDraftFiles(writeArgs, context)
    }
  } else if (!files?.length) {
    throw new Error('Cannot write CLI config without a model id')
  }
  validateCliConfigDraftForWrite(files)

  if (!isFileConfiguredCli(args.cliTool)) {
    throw new Error(`${args.cliTool} does not use config files`)
  }
  const result = await ipcApi.request('code_cli.write_config', {
    cliTool: args.cliTool,
    files: files.map(({ target, content }) => ({ target, content }))
  })
  if (!result.success) {
    throw new Error(result.message)
  }
  logger.info(`Applied ${args.cliTool} config`)
  return undefined
}

/**
 * Login-capable tools whose "own login" entry also exposes a config panel (tool
 * params only, no model/credentials) expose a `buildOwnLoginDraft` on their
 * adapter. Qoder / GitHub Copilot are fully provider-less and never reach here;
 * OpenCode has no own-login config panel.
 */
export function isOwnLoginConfigurable(cliTool: string): boolean {
  return Boolean(getAdapter(cliTool)?.buildOwnLoginDraft)
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
  const adapter = getAdapter(cliTool)
  if (!adapter?.buildOwnLoginDraft) {
    throw new Error(`Own-login config is not supported for ${cliTool}`)
  }
  return adapter.buildOwnLoginDraft(sanitizeCliConfigBlob(cliTool, configBlob))
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
 * files path (validate → code_cli.write_config), bypassing the
 * credential-requiring `resolveContext`.
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
