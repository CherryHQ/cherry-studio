import path from 'node:path'

import { parse as parseJsonc } from 'jsonc-parser'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { t } from '@main/i18n'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import {
  getLocalAgentLaunchBinding,
  type LocalAgentLaunchBinding,
  LOCAL_AGENT_MODEL_CONFIG
} from '@shared/ai/localAgentModel'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId, GROK_SESSION_SUMMARY_PATH } from '@shared/utils/apiGateway'
import {
  CliConfigError,
  createCliConfigDraftFiles,
  type CliConfigFileDraft,
  type CliConfigFileReader,
  type CliConfigTarget,
  createCliGatewayProvider,
  getAdapter,
  validateCliConfigDraftForWrite
} from '@shared/utils/cliConfig'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { isAgentOnlyProvider } from '@shared/utils/provider'

const GATEWAY_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages']
const GROK_SUMMARY_PATH = `/v1${GROK_SESSION_SUMMARY_PATH}/chat/completions`
const CODEX_PROVIDER = 'cherry-studio'
const CODEX_KEY_VARIABLE = 'CHERRY_STUDIO_API_KEY'
// Blanked so the user's own settings cannot route a bound launch to another provider or add its headers.
const CLAUDE_PROVIDER_RESETS = [
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY'
]
const CLAUDE_MODEL_ROLES = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
  'CLAUDE_CODE_AUTO_MODE_MODEL'
]

/** A Cherry model bound to one launch: what to add to the process, and how to release it. */
export interface LaunchModelBinding {
  model: string
  contextWindow?: number
  env: Record<string, string>
  args: string[]
  /** Generated config documents, so preset launch hooks read the bound connection, not the user's files. */
  files: Partial<Record<CliConfigTarget, string>>
  /** Claude Code flag settings; they outrank the user's settings files. */
  settingsEnv?: Record<string, string>
  dispose(): Promise<void>
}

type LaunchHook = (files: Partial<Record<CliConfigTarget, string>>, env: Record<string, string>) => void

/** Resolves a Cherry model to its gateway address, failing when it can no longer be served. */
export function resolveGatewayModel(sourceModelId: UniqueModelId) {
  const { providerId, modelId } = parseUniqueModelId(sourceModelId)
  const model = modelService.getByKey(providerId, modelId)
  const provider = providerService.getByProviderId(providerId)
  if (!model.isEnabled || !provider.isEnabled || isAgentOnlyProvider(provider) || !isGatewayRoutableModel(model))
    throw new Error(t('code_cli.model.model_config_missing'))
  return { model, address: formatGatewayModelId(providerId, model.apiModelId ?? modelId) }
}

function localized(error: unknown): unknown {
  if (!(error instanceof CliConfigError)) return error
  switch (error.key) {
    case 'code.cli_config.invalid_model_list':
      return new Error(t('code.cli_config.invalid_model_list', error.params))
    case 'code.cli_config.missing_credentials':
      return new Error(t('code.cli_config.missing_credentials', error.params))
    case 'code.cli_config.model_conflict':
      return new Error(t('code.cli_config.model_conflict', error.params))
    default:
      return error
  }
}

function tomlLiteral(value: string) {
  if (/['\r\n]/.test(value)) throw new Error(t('code_cli.model.cherry_model_unsupported'))
  return `'${value}'`
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key]
    merged[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
        ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value
  }
  return merged
}

async function readFiles(targets: readonly CliConfigTarget[], env: Record<string, string>) {
  return application.get('CodeCliService').readConfigFiles(targets, env)
}

const readerFor =
  (env: Record<string, string>): CliConfigFileReader =>
  async (targets) =>
    new Map((await readFiles(targets, env)).map((file) => [file.target, file]))

const emptyReader: CliConfigFileReader = async (targets) =>
  new Map(targets.map((target) => [target, { path: '', content: null }]))

async function renderDrafts(
  config: LocalAgentConfiguration,
  sourceModelId: UniqueModelId,
  credential: { baseUrl: string; apiKey: string },
  address: string,
  model: ReturnType<typeof resolveGatewayModel>['model'],
  reader: CliConfigFileReader
): Promise<CliConfigFileDraft[]> {
  const tool = LOCAL_AGENT_MODEL_CONFIG[config.presetId ?? '']?.tool
  const adapter = tool && getAdapter(tool)
  if (!tool || !adapter) throw new Error(t('code_cli.model.cherry_model_unsupported'))
  const user = await reader(adapter.targets)
  const userDrafts = createCliConfigDraftFiles([...user].map(([target, file]) => ({ target, ...file })))
  let configBlob: Record<string, unknown> = {}
  try {
    configBlob = adapter.extractConfig(userDrafts) ?? {}
  } catch {
    // An unreadable user file contributes no preferences; the draft build reports it precisely.
  }
  const context = {
    provider: createCliGatewayProvider(credential.baseUrl, 'Cherry Studio'),
    apiKey: credential.apiKey,
    model: address,
    modelLabel: model.name ?? address,
    modelRecord: model,
    configBlob: adapter.sanitize(configBlob)
  }
  try {
    adapter.assertCredentials(context)
    const drafts = await adapter.buildDraft(
      { cliTool: tool, modelId: sourceModelId, writePrimaryModel: true },
      context,
      reader
    )
    validateCliConfigDraftForWrite(drafts)
    return drafts
  } catch (error) {
    throw localized(error)
  }
}

/**
 * Places generated files in a per-launch home behind the CLI's home variable. Every generated file
 * must resolve inside that home, or the launch fails before anything is written.
 */
async function bindOverlayHome(
  variable: string,
  drafts: CliConfigFileDraft[],
  env: Record<string, string>
): Promise<{ env: Record<string, string>; dispose(): Promise<void> }> {
  const targets = drafts.map((draft) => draft.target)
  const probe = path.join(application.getPath('feature.agents.launch_overlays'), 'probe', 'home')
  const [real, redirected] = await Promise.all([
    readFiles(targets, env),
    readFiles(targets, { ...env, [variable]: probe })
  ])
  let realHome: string | undefined
  const files = drafts.map((draft) => {
    const overlayPath = redirected.find((file) => file.target === draft.target)!.path
    const realPath = real.find((file) => file.target === draft.target)!.path
    const relativePath = path.relative(probe, overlayPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath))
      throw new Error(t('code_cli.model.launch_home_unredirected'))
    // The real home sits as many levels above the real file as the overlay home above the generated one.
    const home = path.resolve(realPath, ...relativePath.split(path.sep).map(() => '..'))
    if (realHome !== undefined && realHome !== home) throw new Error(t('code_cli.model.launch_home_unredirected'))
    realHome = home
    return { relativePath, content: draft.content }
  })
  const overlay = await application.get('LocalAgentOverlayService').create(realHome, files)
  return { env: { [variable]: overlay.home }, dispose: overlay.dispose }
}

async function applyBinding(
  binding: LocalAgentLaunchBinding,
  input: {
    config: LocalAgentConfiguration
    sourceModelId: UniqueModelId
    credential: { baseUrl: string; apiKey: string }
    address: string
    model: ReturnType<typeof resolveGatewayModel>['model']
    env: Record<string, string>
    terminal: boolean
    launchHook?: LaunchHook
  }
): Promise<Omit<LaunchModelBinding, 'model' | 'contextWindow'>> {
  const { config, sourceModelId, credential, address, model, env } = input
  const noop = async () => {}
  if (binding.kind === 'claude-settings') {
    const settingsEnv: Record<string, string> = {
      ANTHROPIC_BASE_URL: credential.baseUrl,
      ANTHROPIC_AUTH_TOKEN: credential.apiKey,
      ANTHROPIC_API_KEY: '',
      ...Object.fromEntries(CLAUDE_PROVIDER_RESETS.map((key) => [key, ''])),
      ...Object.fromEntries(CLAUDE_MODEL_ROLES.map((key) => [key, address]))
    }
    if (!input.terminal) return { env: {}, args: [], files: {}, settingsEnv, dispose: noop }
    const settings = await application
      .get('LocalAgentOverlayService')
      .create(undefined, [{ relativePath: 'settings.json', content: JSON.stringify({ env: settingsEnv }) }])
    return {
      env: {},
      args: ['--settings', path.join(settings.home, 'settings.json')],
      files: {},
      dispose: settings.dispose
    }
  }
  if (binding.kind === 'codex-overrides') {
    const provider = `model_providers.${CODEX_PROVIDER}`
    const overrides = [
      `model_provider=${tomlLiteral(CODEX_PROVIDER)}`,
      `${provider}.name=${tomlLiteral('Cherry Studio')}`,
      `${provider}.base_url=${tomlLiteral(`${credential.baseUrl}/v1`)}`,
      `${provider}.wire_api=${tomlLiteral('responses')}`,
      `${provider}.env_key=${tomlLiteral(CODEX_KEY_VARIABLE)}`,
      `model=${tomlLiteral(address)}`,
      ...(model.contextWindow ? [`model_context_window=${model.contextWindow}`] : [])
    ]
    return {
      env: { [CODEX_KEY_VARIABLE]: credential.apiKey },
      args: overrides.flatMap((override) => ['-c', override]),
      files: {},
      dispose: noop
    }
  }
  if (binding.kind === 'config-content') {
    const [draft] = await renderDrafts(config, sourceModelId, credential, address, model, emptyReader)
    const existing = env[binding.variable] ? parseJsonc(env[binding.variable]) : {}
    const merged = deepMerge(existing && typeof existing === 'object' ? existing : {}, parseJsonc(draft.content))
    return { env: { [binding.variable]: JSON.stringify(merged) }, args: [], files: {}, dispose: noop }
  }
  const drafts = await renderDrafts(config, sourceModelId, credential, address, model, readerFor(env))
  const files = Object.fromEntries(drafts.map((draft) => [draft.target, draft.content]))
  if (binding.kind === 'environment') {
    if (!input.launchHook) throw new Error(t('code_cli.model.cherry_model_unsupported'))
    const hookEnv: Record<string, string> = {}
    input.launchHook(files, hookEnv)
    return { env: hookEnv, args: [], files, dispose: noop }
  }
  const overlay = await bindOverlayHome(binding.variable, drafts, env)
  return { env: overlay.env, args: [], files, dispose: overlay.dispose }
}

/**
 * Binds the Agent's Cherry model to one launch: a credential scoped to this launch and model, applied
 * through the preset's binding without touching the user's CLI files. Undefined when the Agent uses
 * the CLI's own model.
 */
export async function bindLaunchModel(
  config: LocalAgentConfiguration,
  env: Record<string, string>,
  options: { sessionId?: string; terminal: boolean; launchHook?: LaunchHook }
): Promise<LaunchModelBinding | undefined> {
  const { sourceModelId } = config
  if (!config.sourceModelViaGateway || !sourceModelId) return undefined
  const binding = getLocalAgentLaunchBinding(config.presetId)
  if (!binding || config.executableOverride) throw new Error(t('code_cli.model.cherry_model_unsupported'))
  const { model, address } = resolveGatewayModel(sourceModelId)
  const lease = await application.get('ApiGatewayService').createScopedCredential({
    paths: config.presetId === 'grok-build' ? [...GATEWAY_PATHS, GROK_SUMMARY_PATH] : GATEWAY_PATHS,
    model: address,
    agentSessionId: options.sessionId
  })
  try {
    const applied = await applyBinding(binding, {
      config,
      sourceModelId,
      credential: lease,
      address,
      model,
      env,
      terminal: options.terminal,
      launchHook: options.launchHook
    })
    return {
      ...applied,
      model: address,
      ...(model.contextWindow && { contextWindow: model.contextWindow }),
      async dispose() {
        lease.dispose()
        await applied.dispose()
      }
    }
  } catch (error) {
    lease.dispose()
    throw error
  }
}
