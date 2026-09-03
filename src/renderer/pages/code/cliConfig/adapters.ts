import type { Provider } from '@shared/data/types/provider'
import { CodeCli, isApiGatewayProviderId, normalizeDeepSeekHarnessSettings } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'
import {
  formatGatewayModelId,
  formatGeminiGatewayModelId,
  parseGatewayModelId,
  parseGeminiGatewayModelId,
  parseLegacyGeminiGatewayModelId
} from '@shared/utils/apiGateway'
import { type CliConfigWriteFile, type FileConfiguredCli, getCliConfigTargets } from '@shared/utils/cliConfig'
import { stringify as stringifyToml } from 'smol-toml'
import { type Document, isMap, isScalar } from 'yaml'

import {
  buildClaudeConfig,
  buildCodexAuthConfig,
  buildCodexConfig,
  buildGeminiEnvConfig,
  buildGeminiSettingsConfig,
  buildHermesEnvConfig,
  buildKimiConfig,
  buildOpenCodeConfig,
  buildPiModelsConfig,
  buildPiSettingsConfig,
  buildQwenConfig,
  clearCodexApiKeyAuth
} from './builders'
import { CHERRY_PROVIDER_PREFIX, HERMES_ENDPOINTS, OPEN_CODE_ENDPOINTS, PI_ENDPOINTS } from './constants'
import { parseDotenv, renderDotenvFile } from './dotenv'
import {
  getDraftFile,
  makeDraftFile,
  parseDraftFileOrThrow,
  readAndParseDraftFile,
  readConfigFilesForDraft,
  readDraftFileText
} from './draftFiles'
import {
  parseJsonOrThrow,
  parseTomlOrThrow,
  parseYamlDocumentOrThrow,
  parseYamlOrThrow,
  readConfigFiles,
  readValidatedJsonOrNull,
  readValidatedTomlOrNull,
  renderJsonFile,
  requireReadFile
} from './file'
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
  buildCodexOwnLoginConfig,
  buildGeminiOwnLoginSettings,
  buildKimiOwnLoginConfig,
  buildQwenOwnLoginConfig
} from './ownLogin'
import {
  codexConfigToPermissionMode,
  isClaudePermissionMode,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  isOpenCodePermissionMode
} from './permissionModes'
import {
  HERMES_API_MODES,
  type HermesApiMode,
  modelSupportsReasoningEffort,
  openCodeNpmInfoFromNpmPackage,
  resolveClaudeBaseUrl,
  resolveCodexBaseUrl,
  resolveGeminiBaseUrl,
  resolveHermesProviderInfo,
  resolveOpenAIBaseUrl,
  resolveOpenCodeNpmInfo,
  resolvePiProviderInfo
} from './resolvers'
import {
  sanitizeClaudeConfigBlob,
  sanitizeCodexConfigBlob,
  sanitizeGeminiConfigBlob,
  sanitizeKimiConfigBlob,
  sanitizeOpenCodeConfigBlob,
  sanitizeQwenConfigBlob
} from './sanitize'
import type {
  CliConfigConnection,
  CliConfigDraftBuildArgs,
  CliConfigFileDraft,
  CliConfigTarget,
  ResolvedCliConfigContext
} from './types'
import {
  asRecord,
  cliProviderKeyName,
  dropFeatureGoalsIfEmpty,
  dropSecurityAuthSelectedTypeIfEmpty,
  findCherryProviderKey,
  isCherryManagedModel,
  normalizeUrl,
  numberValue,
  omitKeysByPrefix,
  stringValue
} from './values'

/**
 * A per-CLI config adapter: everything the config-generation layer needs to know
 * about one file-based CLI tool, gathered in one place. Adding a CLI is a single
 * new entry here (plus its file targets in `targets.ts`) rather than a new `case`
 * scattered across draft/clear/parser/sanitize/provider-matching.
 *
 * The dispatch functions in those modules are thin `getAdapter(cliTool).method()`
 * lookups; the behavior lives here.
 */
export interface CliConfigAdapter {
  /** The on-disk config files this tool owns (source of truth: `CLI_CONFIG_TARGETS`). */
  targets: readonly CliConfigTarget[]
  /** Candidate provider base URLs a stored connection may legitimately match. */
  providerBaseUrls(provider: Provider): string[]
  /** Strip a user-edited config blob down to the tool params this CLI persists. */
  sanitize(configBlob: Record<string, unknown> | undefined): Record<string, any>
  /** Build the managed config file draft(s) from resolved credentials + tool params. */
  buildDraft(args: CliConfigDraftBuildArgs, context: ResolvedCliConfigContext): Promise<CliConfigFileDraft[]>
  /** Throw if the resolved context is missing a credential this CLI requires to write. */
  assertCredentials(context: ResolvedCliConfigContext): void
  /**
   * Build the "own login" tool-param file draft (no credentials/model). Absent for
   * tools that expose no own-login config panel (OpenCode); the dispatcher throws.
   */
  buildOwnLoginDraft?(configBlob: Record<string, any>): Promise<CliConfigFileDraft[]>
  /** Re-render the draft files for an edited tool-param blob, keeping the existing connection. */
  updateDraftConfig(
    files: CliConfigFileDraft[],
    connection: CliConfigConnection,
    configBlob: Record<string, any>
  ): CliConfigFileDraft[]
  /**
   * Build the rewrites that strip every Cherry-managed key from the on-disk
   * config file(s), leaving user keys intact. Files with nothing to rewrite are
   * omitted; the caller persists the entries via `code_cli.write_config`.
   */
  buildClearFiles(): Promise<CliConfigWriteFile[]>
  /** Read the connection (baseUrl/apiKey/model) back out of the draft files. */
  extractConnection(files: CliConfigFileDraft[]): CliConfigConnection | null
  /** Read the persisted tool params back out of the draft files. */
  extractConfig(files: CliConfigFileDraft[]): Record<string, unknown> | null
}

const CODEX_MANAGED_TOP_LEVEL_KEY_SET = new Set<string>(CODEX_MANAGED_TOP_LEVEL_KEYS)
const HERMES_API_KEY_ENV = 'CHERRY_HERMES_API_KEY'
const HERMES_API_KEY_ENV_REFERENCE = '${CHERRY_HERMES_API_KEY}'

function replaceDraftContent(
  files: CliConfigFileDraft[],
  target: CliConfigTarget,
  content: string
): CliConfigFileDraft[] {
  return files.map((file) => (file.target === target ? { ...file, content } : file))
}

function requireDraftValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Cannot update CLI config draft: missing ${label}`)
  }
  return value
}

function providerNameFromKey(providerKey: string | undefined, label: string): string {
  const key = requireDraftValue(providerKey, label)
  if (!key.startsWith(CHERRY_PROVIDER_PREFIX)) {
    throw new Error(`Cannot update CLI config draft: ${label} is not managed by Cherry Studio`)
  }
  return key.slice(CHERRY_PROVIDER_PREFIX.length)
}

function cherryProviderKeyFrom(providers: Record<string, any>): string {
  return requireDraftValue(findCherryProviderKey(providers), 'OpenCode provider')
}

function isHermesApiMode(value: unknown): value is HermesApiMode {
  return HERMES_API_MODES.some((apiMode) => apiMode === value)
}

const HERMES_MANAGED_MODEL_KEYS = ['provider', 'default', 'base_url', 'api_key', 'api_mode'] as const

function writeHermesConfig(
  document: Document,
  resolved: { apiKeyEnv: string; apiMode: HermesApiMode; baseUrl: string; model: string }
): string {
  const existingModel = document.get('model', true)
  // A bare `model:` parses to a null scalar node, not a missing key — an empty
  // section is a valid starting point, not a malformed mapping.
  if (existingModel == null || (isScalar(existingModel) && existingModel.value == null)) {
    document.set('model', document.createNode({}))
  } else if (!isMap(existingModel)) {
    throw new Error('invalid Hermes model config: expected an object')
  }
  document.setIn(['model', 'provider'], 'custom')
  document.setIn(['model', 'default'], resolved.model)
  document.setIn(['model', 'base_url'], normalizeUrl(resolved.baseUrl))
  document.setIn(['model', 'api_key'], resolved.apiKeyEnv)
  document.setIn(['model', 'api_mode'], resolved.apiMode)
  return document.toString()
}

function clearHermesConfig(content: string): string | null {
  const document = parseYamlDocumentOrThrow(content)
  if (document.getIn(['model', 'api_key']) !== HERMES_API_KEY_ENV_REFERENCE) return null
  for (const key of HERMES_MANAGED_MODEL_KEYS) document.deleteIn(['model', key])
  const model = document.get('model', true)
  if (isMap(model) && model.items.length === 0) document.delete('model')
  return document.toString()
}

const claudeAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.CLAUDE_CODE),
  providerBaseUrls: (provider) => [normalizeUrl(resolveClaudeBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeClaudeConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, configBlob } = context
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const existing = readAndParseDraftFile('claude-settings', parseJsonOrThrow, args.files, read)
    const baseUrl = resolveClaudeBaseUrl(provider)
    return [
      makeDraftFile(
        'claude-settings',
        renderJsonFile(
          buildClaudeConfig(existing, configBlob, {
            apiKey,
            baseUrl,
            model,
            writePrimaryModel: args.writePrimaryModel
          })
        ),
        read
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Claude Code config is missing the API key')
  },
  async buildOwnLoginDraft(configBlob) {
    const read = await readConfigFiles(['claude-settings'])
    const existing = readAndParseDraftFile('claude-settings', parseJsonOrThrow, undefined, read)
    return [
      makeDraftFile(
        'claude-settings',
        renderJsonFile(
          buildClaudeConfig(existing, configBlob, { apiKey: '', baseUrl: '', model: '', writePrimaryModel: false })
        ),
        read
      )
    ]
  },
  updateDraftConfig(files, connection, configBlob) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'claude-settings')?.content ?? '')
    return replaceDraftContent(
      files,
      'claude-settings',
      renderJsonFile(
        buildClaudeConfig(settings, configBlob, {
          apiKey: connection.apiKey ?? '',
          baseUrl: connection.baseUrl ?? '',
          model: connection.model ?? ''
        })
      )
    )
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const existing = readValidatedJsonOrNull('claude-settings', read, 'Claude Code settings')
    if (!existing) return []
    const next: Record<string, any> = { ...existing }
    for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
    if (next.permissions && typeof next.permissions === 'object') {
      const permissions = { ...(next.permissions as Record<string, any>) }
      for (const key of CLAUDE_MANAGED_PERMISSION_KEYS) delete permissions[key]
      if (Object.keys(permissions).length > 0) next.permissions = permissions
      else delete next.permissions
    }
    if (next.env && typeof next.env === 'object') {
      const env = { ...(next.env as Record<string, any>) }
      for (const key of CLAUDE_MANAGED_ENV_KEYS) delete env[key]
      next.env = env
    }
    return [{ target: 'claude-settings', content: renderJsonFile(next) }]
  },
  extractConnection(files) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'claude-settings')?.content ?? '')
    const env = asRecord(settings.env)
    return {
      baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
      apiKey: stringValue(env.ANTHROPIC_AUTH_TOKEN) ?? stringValue(env.ANTHROPIC_API_KEY),
      model: stringValue(env.ANTHROPIC_MODEL)
    }
  },
  extractConfig(files) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'claude-settings')?.content ?? '')
    const out: Record<string, any> = {}
    for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) {
      if (key === 'effortLevel') {
        if (isClaudeReasoningEffort(settings[key])) out[key] = settings[key]
      } else if (settings[key] !== undefined) out[key] = settings[key]
    }
    const permissions = asRecord(settings.permissions)
    for (const key of CLAUDE_MANAGED_PERMISSION_KEYS) {
      if (key === 'defaultMode' && isClaudePermissionMode(permissions[key])) {
        out.permissions = { ...asRecord(out.permissions), [key]: permissions[key] }
      }
    }
    const env = { ...asRecord(settings.env) }
    for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']) {
      delete env[key]
    }
    for (const key of CLAUDE_MANAGED_ENV_KEYS) {
      if (env[key] !== undefined) out.env = { ...asRecord(out.env), [key]: env[key] }
    }
    return out
  }
}

const codexAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.OPENAI_CODEX),
  providerBaseUrls: (provider) => [normalizeUrl(resolveCodexBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeCodexConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, configBlob } = context
    const responsesUrl = resolveCodexBaseUrl(provider)
    if (!responsesUrl) {
      throw new Error('Codex requires an OpenAI Responses API endpoint, which this provider does not expose')
    }
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const config = readAndParseDraftFile('codex-config', parseTomlOrThrow, args.files, read)
    const auth = readAndParseDraftFile('codex-auth', parseJsonOrThrow, args.files, read)
    const providerName = cliProviderKeyName(provider)
    return [
      makeDraftFile(
        'codex-config',
        stringifyToml(buildCodexConfig(config, { baseUrl: responsesUrl, providerName, model }, configBlob)),
        read
      ),
      makeDraftFile('codex-auth', renderJsonFile(buildCodexAuthConfig(auth, apiKey)), read)
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Codex config is missing the API key')
  },
  async buildOwnLoginDraft(configBlob) {
    const read = await readConfigFiles(['codex-config'])
    const config = readAndParseDraftFile('codex-config', parseTomlOrThrow, undefined, read)
    return [makeDraftFile('codex-config', stringifyToml(buildCodexOwnLoginConfig(config, configBlob)), read)]
  },
  updateDraftConfig(files, connection, configBlob) {
    const config = parseTomlOrThrow(getDraftFile(files, 'codex-config')?.content ?? '')
    const auth = parseJsonOrThrow(getDraftFile(files, 'codex-auth')?.content ?? '')
    const providerKey = stringValue(config.model_provider)
    const providerName = providerNameFromKey(providerKey, 'Codex model_provider')
    const nextConfig = buildCodexConfig(
      config,
      {
        baseUrl: requireDraftValue(connection.baseUrl, 'Codex base URL'),
        providerName,
        model: requireDraftValue(connection.model, 'Codex model')
      },
      configBlob
    )
    return replaceDraftContent(
      replaceDraftContent(files, 'codex-config', stringifyToml(nextConfig)),
      'codex-auth',
      connection.apiKey ? renderJsonFile(buildCodexAuthConfig(auth, connection.apiKey)) : renderJsonFile(auth)
    )
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const existing = readValidatedTomlOrNull('codex-config', read, 'Codex config')
    const existingAuth = readValidatedJsonOrNull('codex-auth', read, 'Codex auth')
    const files: CliConfigWriteFile[] = []
    if (existing) {
      const next: Record<string, any> = {}
      for (const [key, value] of Object.entries(existing)) {
        if (!CODEX_MANAGED_TOP_LEVEL_KEY_SET.has(key) && key !== 'model' && key !== 'model_provider') {
          next[key] = value
        }
      }
      if (next.model_providers && typeof next.model_providers === 'object') {
        next.model_providers = omitKeysByPrefix(next.model_providers as Record<string, any>, CHERRY_PROVIDER_PREFIX)
      }
      dropFeatureGoalsIfEmpty(next)
      files.push({ target: 'codex-config', content: stringifyToml(next) })
    }
    if (existingAuth && (existingAuth.OPENAI_API_KEY !== undefined || existingAuth.auth_mode === 'apikey')) {
      const nextAuth = clearCodexApiKeyAuth(existingAuth)
      files.push(
        nextAuth ? { target: 'codex-auth', content: renderJsonFile(nextAuth) } : { target: 'codex-auth', delete: true }
      )
    }
    return files
  },
  extractConnection(files) {
    const config = parseTomlOrThrow(getDraftFile(files, 'codex-config')?.content ?? '')
    const auth = parseJsonOrThrow(getDraftFile(files, 'codex-auth')?.content ?? '')
    const providerKey = stringValue(config.model_provider)
    const provider = providerKey ? asRecord(asRecord(config.model_providers)[providerKey]) : {}
    return {
      baseUrl: stringValue(provider.base_url),
      apiKey: stringValue(auth.OPENAI_API_KEY),
      model: stringValue(config.model)
    }
  },
  extractConfig(files) {
    const config = parseTomlOrThrow(getDraftFile(files, 'codex-config')?.content ?? '')
    const out: Record<string, any> = {}
    if (asRecord(config.features).goals === true) out.goalMode = true
    if (config.disable_response_storage === true) out.disableResponseStorage = true
    const permissionMode = codexConfigToPermissionMode(config)
    if (permissionMode) out.permissionMode = permissionMode
    if (isCodexReasoningEffort(config.model_reasoning_effort)) out.reasoningEffort = config.model_reasoning_effort
    const providerKey = stringValue(config.model_provider)
    const provider = providerKey ? asRecord(asRecord(config.model_providers)[providerKey]) : {}
    if (provider.name === 'OpenAI') out.remoteCompaction = true
    return out
  }
}

const openCodeAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.OPEN_CODE),
  providerBaseUrls: (provider) =>
    OPEN_CODE_ENDPOINTS.flatMap((endpoint) => {
      const baseUrl = normalizeUrl(formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl))
      return baseUrl ? [baseUrl] : []
    }),
  sanitize: sanitizeOpenCodeConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, modelLabel, modelRecord, configBlob } = context
    const npmInfo = resolveOpenCodeNpmInfo(provider, modelRecord?.endpointTypes)
    // formatApiHost appends /v1 even for anthropic-messages — unlike Claude Code's
    // bare ANTHROPIC_BASE_URL (the Claude binary adds /v1/messages itself), the
    // @ai-sdk/anthropic package OpenCode loads expects the /v1 in baseURL and only
    // appends /messages.
    const baseUrl = formatApiHost(provider.endpointConfigs?.[npmInfo.endpointType]?.baseUrl ?? '')
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const existing = readAndParseDraftFile('opencode-config', parseJsonOrThrow, args.files, read)
    const env = asRecord(configBlob.env)
    return [
      makeDraftFile(
        'opencode-config',
        renderJsonFile(
          buildOpenCodeConfig(
            existing,
            provider,
            npmInfo,
            { apiKey, baseUrl, model, modelLabel },
            {
              reasoning: env.OPENCODE_REASONING === 'true',
              supportsReasoningEffort: modelSupportsReasoningEffort(modelRecord),
              autoCompact: configBlob.autoCompact === true,
              permissionMode: configBlob.permissionMode,
              providerHeaders: provider.settings?.extraHeaders,
              contextWindow: modelRecord?.contextWindow,
              maxOutputTokens: modelRecord?.maxOutputTokens
            }
          )
        ),
        read
      )
    ]
  },
  assertCredentials(context) {
    const npmInfo = resolveOpenCodeNpmInfo(context.provider, context.modelRecord?.endpointTypes)
    const baseUrl = formatApiHost(context.provider.endpointConfigs?.[npmInfo.endpointType]?.baseUrl ?? '')
    if (!context.apiKey || !baseUrl) throw new Error('OpenCode config is missing required fields (apiKey/baseUrl)')
  },
  updateDraftConfig(files, connection, configBlob) {
    const existing = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
    const providers = asRecord(existing.provider)
    const providerKey = cherryProviderKeyFrom(providers)
    const provider = asRecord(providers[providerKey])
    const providerOptions = asRecord(provider.options)
    const existingModel = asRecord(asRecord(provider.models)[connection.model ?? ''])
    const existingLimit = asRecord(existingModel.limit)
    const providerName = providerNameFromKey(providerKey, 'OpenCode provider')
    const env = asRecord(configBlob.env)
    const model = requireDraftValue(connection.model, 'OpenCode model')
    const nextConfig = buildOpenCodeConfig(
      existing,
      { id: providerName, name: providerName },
      openCodeNpmInfoFromNpmPackage(requireDraftValue(stringValue(provider.npm), 'OpenCode provider npm package')),
      {
        apiKey: requireDraftValue(connection.apiKey, 'OpenCode API key'),
        baseUrl: requireDraftValue(connection.baseUrl, 'OpenCode base URL'),
        model,
        // A config-only edit has no model record to re-derive the display name from; keep
        // the one already written for this model key.
        modelLabel: stringValue(asRecord(asRecord(provider.models)[model]).name)
      },
      {
        reasoning: env.OPENCODE_REASONING === 'true',
        supportsReasoningEffort: true,
        autoCompact: configBlob.autoCompact === true,
        permissionMode: configBlob.permissionMode,
        providerHeaders: providerOptions.headers,
        contextWindow: existingLimit.context,
        maxOutputTokens: existingLimit.output
      }
    )
    return replaceDraftContent(files, 'opencode-config', renderJsonFile(nextConfig))
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const existing = readValidatedJsonOrNull('opencode-config', read, 'OpenCode config')
    if (!existing) return []
    const next: Record<string, any> = { ...existing }
    for (const key of OPEN_CODE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
    const compaction = { ...asRecord(next.compaction) }
    delete compaction.auto
    if (Object.keys(compaction).length > 0) next.compaction = compaction
    else delete next.compaction
    // Only drop the top-level model when it points at a cherry-* provider (about to be
    // removed below — keeping it would leave a dangling reference); a user's own value
    // referencing their own provider stays.
    if (typeof next.model === 'string' && next.model.startsWith(CHERRY_PROVIDER_PREFIX)) {
      delete next.model
    }
    if (next.provider && typeof next.provider === 'object') {
      next.provider = omitKeysByPrefix(next.provider as Record<string, any>, CHERRY_PROVIDER_PREFIX)
    }
    return [{ target: 'opencode-config', content: renderJsonFile(next) }]
  },
  extractConnection(files) {
    const config = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
    const providers = asRecord(config.provider)
    const providerKey = findCherryProviderKey(providers)
    const provider = asRecord(providerKey ? providers[providerKey] : undefined)
    const models = asRecord(provider.models)
    // The models map KEY is the addressing id (what gateway matching compares against);
    // `name` is only the display label and may differ from it.
    const model = Object.keys(models)[0]
    return {
      baseUrl: stringValue(asRecord(provider.options).baseURL),
      apiKey: stringValue(asRecord(provider.options).apiKey),
      model
    }
  },
  extractConfig(files) {
    const config = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
    const out: Record<string, any> = {}
    if (asRecord(config.compaction).auto === true) out.autoCompact = true
    if (isOpenCodePermissionMode(config.permission)) out.permissionMode = config.permission
    const providers = asRecord(config.provider)
    const providerKey = findCherryProviderKey(providers)
    const provider = asRecord(providerKey ? providers[providerKey] : undefined)
    const model = asRecord(Object.entries(asRecord(provider.models))[0]?.[1])
    if (model.reasoning === true) out.env = { OPENCODE_REASONING: 'true' }
    return out
  }
}

function parseGeminiConfigModel(model: string, allowLegacy = false): { isGateway: boolean; model: string } {
  try {
    const tagged = parseGeminiGatewayModelId(model)
    if (tagged) {
      return { isGateway: true, model: formatGatewayModelId(tagged.providerId, tagged.apiModelId) }
    }
  } catch {
    return { isGateway: false, model }
  }

  const legacy = allowLegacy ? parseLegacyGeminiGatewayModelId(model) : undefined
  if (legacy) {
    return { isGateway: true, model: formatGatewayModelId(legacy.providerId, legacy.apiModelId) }
  }
  return { isGateway: false, model }
}

function isLegacyGeminiGatewayConfig(env: Map<string, string>): boolean {
  return env.get('GOOGLE_GENAI_API_VERSION') === 'v1beta' && (env.get('GEMINI_API_KEY') ?? '').startsWith('cs-sk-')
}

const geminiAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.GEMINI_CLI),
  providerBaseUrls: (provider) => [normalizeUrl(resolveGeminiBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeGeminiConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, configBlob } = context
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const envText = readDraftFileText('gemini-env', args.files, read)
    const settings = readAndParseDraftFile('gemini-settings', parseJsonOrThrow, args.files, read)
    const baseUrl = resolveGeminiBaseUrl(provider)
    const isGateway = isApiGatewayProviderId(provider.id)
    const address = isGateway ? parseGatewayModelId(model) : undefined
    const settingsModel = address ? formatGeminiGatewayModelId(address.providerId, address.apiModelId) : model
    return [
      makeDraftFile(
        'gemini-env',
        renderDotenvFile(buildGeminiEnvConfig(parseDotenv(envText), { apiKey, baseUrl, gateway: isGateway }), envText),
        read
      ),
      makeDraftFile(
        'gemini-settings',
        renderJsonFile(buildGeminiSettingsConfig(settings, { model: settingsModel }, configBlob)),
        read
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Gemini CLI config is missing the API key')
  },
  async buildOwnLoginDraft(configBlob) {
    const read = await readConfigFiles(['gemini-settings'])
    const settings = readAndParseDraftFile('gemini-settings', parseJsonOrThrow, undefined, read)
    return [makeDraftFile('gemini-settings', renderJsonFile(buildGeminiOwnLoginSettings(settings, configBlob)), read)]
  },
  updateDraftConfig(files, connection, configBlob) {
    const envText = getDraftFile(files, 'gemini-env')?.content ?? ''
    const env = parseDotenv(envText)
    const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
    const model = requireDraftValue(connection.model, 'Gemini model')
    const currentModel = stringValue(asRecord(settings.model).name)
    const isGateway = currentModel
      ? parseGeminiConfigModel(currentModel, isLegacyGeminiGatewayConfig(env)).isGateway
      : false
    const address = isGateway ? parseGatewayModelId(model) : undefined
    const settingsModel = address ? formatGeminiGatewayModelId(address.providerId, address.apiModelId) : model
    return replaceDraftContent(
      replaceDraftContent(
        files,
        'gemini-env',
        renderDotenvFile(
          buildGeminiEnvConfig(env, {
            apiKey: connection.apiKey ?? '',
            baseUrl: connection.baseUrl ?? '',
            gateway: isGateway
          }),
          envText
        )
      ),
      'gemini-settings',
      renderJsonFile(buildGeminiSettingsConfig(settings, { model: settingsModel }, configBlob))
    )
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const files: CliConfigWriteFile[] = []
    const envText = requireReadFile('gemini-env', read).content
    if (envText !== null) {
      const envMap = parseDotenv(envText)
      for (const key of GEMINI_MANAGED_ENV_KEYS) envMap.delete(key)
      files.push({ target: 'gemini-env', content: renderDotenvFile(envMap, envText) })
    }

    const settings = readValidatedJsonOrNull('gemini-settings', read, 'Gemini CLI settings')
    if (!settings) return files
    applyManagedJsonSettings(settings, {}, GEMINI_MANAGED_SETTINGS_KEYS)
    dropSecurityAuthSelectedTypeIfEmpty(settings)
    if (settings.model && typeof settings.model === 'object') {
      delete settings.model.name
      if (Object.keys(settings.model as Record<string, any>).length === 0) delete settings.model
    }
    files.push({ target: 'gemini-settings', content: renderJsonFile(settings) })
    return files
  },
  extractConnection(files) {
    const env = parseDotenv(getDraftFile(files, 'gemini-env')?.content ?? '')
    const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
    const model = stringValue(asRecord(settings.model).name)
    return {
      baseUrl: stringValue(env.get('GOOGLE_GEMINI_BASE_URL')),
      apiKey: stringValue(env.get('GEMINI_API_KEY')),
      model: model === undefined ? model : parseGeminiConfigModel(model, isLegacyGeminiGatewayConfig(env)).model
    }
  },
  extractConfig(files) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
    return sanitizeGeminiConfigBlob(settings)
  }
}

const qwenAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.QWEN_CODE),
  providerBaseUrls: (provider) => [normalizeUrl(resolveOpenAIBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeQwenConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, modelRecord, configBlob } = context
    const baseUrl = resolveOpenAIBaseUrl(provider)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const existing = readAndParseDraftFile('qwen-settings', parseJsonOrThrow, args.files, read)
    return [
      makeDraftFile(
        'qwen-settings',
        renderJsonFile(
          buildQwenConfig(existing, { apiKey, baseUrl, model, modelLabel: modelRecord?.name ?? model }, configBlob)
        ),
        read
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Qwen Code config is missing the API key')
    if (!resolveOpenAIBaseUrl(context.provider)) {
      throw new Error('Qwen Code config is missing the OpenAI endpoint base URL')
    }
  },
  async buildOwnLoginDraft(configBlob) {
    const read = await readConfigFiles(['qwen-settings'])
    const existing = readAndParseDraftFile('qwen-settings', parseJsonOrThrow, undefined, read)
    return [makeDraftFile('qwen-settings', renderJsonFile(buildQwenOwnLoginConfig(existing, configBlob)), read)]
  },
  updateDraftConfig(files, connection, configBlob) {
    const existing = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
    const model = requireDraftValue(connection.model, 'Qwen model')
    return replaceDraftContent(
      files,
      'qwen-settings',
      renderJsonFile(
        buildQwenConfig(
          existing,
          {
            apiKey: requireDraftValue(connection.apiKey, 'Qwen API key'),
            baseUrl: requireDraftValue(connection.baseUrl, 'Qwen base URL'),
            model,
            modelLabel: model
          },
          configBlob
        )
      )
    )
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const existing = readValidatedJsonOrNull('qwen-settings', read, 'Qwen Code config')
    if (!existing) return []
    const next: Record<string, any> = { ...existing }
    if (next.env && typeof next.env === 'object') {
      next.env = omitKeysByPrefix(next.env as Record<string, any>, 'CHERRY_')
    }
    if (Array.isArray(next.modelProviders?.openai)) {
      const filtered = next.modelProviders.openai.filter((model: any) => !isCherryManagedModel(model))
      next.modelProviders = { ...next.modelProviders, openai: filtered }
    }
    applyManagedJsonSettings(next, {}, QWEN_MANAGED_SETTINGS_KEYS)
    dropSecurityAuthSelectedTypeIfEmpty(next)
    delete next.model
    return [{ target: 'qwen-settings', content: renderJsonFile(next) }]
  },
  extractConnection(files) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
    const models = Array.isArray(settings.modelProviders?.openai) ? settings.modelProviders.openai : []
    const modelEntry = models.find((item: any) => isCherryManagedModel(item))
    const envKey = stringValue(modelEntry?.envKey)
    return {
      baseUrl: stringValue(modelEntry?.baseUrl),
      apiKey: envKey ? stringValue(asRecord(settings.env)[envKey]) : undefined,
      model: stringValue(asRecord(settings.model).name) ?? stringValue(modelEntry?.id)
    }
  },
  extractConfig(files) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
    return sanitizeQwenConfigBlob(settings)
  }
}

const kimiAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.KIMI_CODE),
  providerBaseUrls: (provider) => [normalizeUrl(resolveOpenAIBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeKimiConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, modelRecord, configBlob } = context
    const baseUrl = resolveOpenAIBaseUrl(provider)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const existing = readAndParseDraftFile('kimi-config', parseTomlOrThrow, args.files, read)
    const providerName = cliProviderKeyName(provider)
    return [
      makeDraftFile(
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
        ),
        read
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Kimi CLI config is missing the API key')
    if (!resolveOpenAIBaseUrl(context.provider)) {
      throw new Error('Kimi CLI config is missing the OpenAI endpoint base URL')
    }
  },
  async buildOwnLoginDraft(configBlob) {
    const read = await readConfigFiles(['kimi-config'])
    const existing = readAndParseDraftFile('kimi-config', parseTomlOrThrow, undefined, read)
    return [makeDraftFile('kimi-config', stringifyToml(buildKimiOwnLoginConfig(existing, configBlob)), read)]
  },
  updateDraftConfig(files, connection, configBlob) {
    const existing = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
    const modelKey = requireDraftValue(stringValue(existing.default_model), 'Kimi default model')
    const maxContextSize = numberValue(asRecord(asRecord(existing.models)[modelKey]).max_context_size)
    return replaceDraftContent(
      files,
      'kimi-config',
      stringifyToml(
        buildKimiConfig(
          existing,
          {
            apiKey: requireDraftValue(connection.apiKey, 'Kimi API key'),
            baseUrl: requireDraftValue(connection.baseUrl, 'Kimi base URL'),
            model: requireDraftValue(connection.model, 'Kimi model'),
            modelKey,
            maxContextSize
          },
          configBlob
        )
      )
    )
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const existing = readValidatedTomlOrNull('kimi-config', read, 'Kimi Code config')
    if (!existing) return []
    const next: Record<string, any> = { ...existing }
    for (const table of ['providers', 'models'] as const) {
      if (next[table] && typeof next[table] === 'object') {
        next[table] = omitKeysByPrefix(next[table] as Record<string, any>, CHERRY_PROVIDER_PREFIX)
      }
    }
    applyManagedTomlSettings(next, {})
    delete next.default_model
    return [{ target: 'kimi-config', content: stringifyToml(next) }]
  },
  extractConnection(files) {
    const config = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
    const modelKey = stringValue(config.default_model)
    const model = modelKey ? asRecord(asRecord(config.models)[modelKey]) : {}
    const providerKey = stringValue(model.provider) ?? modelKey
    const provider = providerKey ? asRecord(asRecord(config.providers)[providerKey]) : {}
    return {
      baseUrl: stringValue(provider.base_url),
      apiKey: stringValue(provider.api_key),
      model: stringValue(model.model) ?? modelKey
    }
  },
  extractConfig(files) {
    const config = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
    return sanitizeKimiConfigBlob(config)
  }
}

const hermesAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.HERMES),
  providerBaseUrls: (provider) =>
    HERMES_ENDPOINTS.flatMap((endpoint) => {
      if (!provider.endpointConfigs?.[endpoint]?.baseUrl) return []
      const baseUrl = normalizeUrl(resolveHermesProviderInfo(provider, [endpoint]).baseUrl)
      return baseUrl ? [baseUrl] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, context) {
    const { apiKey, model, modelRecord, provider } = context
    const providerInfo = resolveHermesProviderInfo(provider, modelRecord?.endpointTypes)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const document = readAndParseDraftFile('hermes-config', parseYamlDocumentOrThrow, args.files, read)
    const envText = readDraftFileText('hermes-env', args.files, read)
    return [
      makeDraftFile(
        'hermes-config',
        writeHermesConfig(document, {
          apiKeyEnv: HERMES_API_KEY_ENV_REFERENCE,
          apiMode: providerInfo.apiMode,
          baseUrl: providerInfo.baseUrl,
          model
        }),
        read
      ),
      makeDraftFile('hermes-env', renderDotenvFile(buildHermesEnvConfig(parseDotenv(envText), apiKey), envText), read)
    ]
  },
  assertCredentials(context) {
    const { baseUrl } = resolveHermesProviderInfo(context.provider, context.modelRecord?.endpointTypes)
    if (!context.apiKey || !baseUrl) throw new Error('Hermes config is missing required fields (apiKey/baseUrl)')
  },
  updateDraftConfig(files, connection) {
    const document = parseDraftFileOrThrow('hermes-config', files, parseYamlDocumentOrThrow)
    const envText = getDraftFile(files, 'hermes-env')?.content ?? ''
    const existingApiMode = document.getIn(['model', 'api_mode'])
    const apiMode = isHermesApiMode(existingApiMode) ? existingApiMode : 'chat_completions'
    return replaceDraftContent(
      replaceDraftContent(
        files,
        'hermes-config',
        writeHermesConfig(document, {
          apiKeyEnv: HERMES_API_KEY_ENV_REFERENCE,
          apiMode,
          baseUrl: requireDraftValue(connection.baseUrl, 'Hermes base URL'),
          model: requireDraftValue(connection.model, 'Hermes model')
        })
      ),
      'hermes-env',
      connection.apiKey
        ? renderDotenvFile(buildHermesEnvConfig(parseDotenv(envText), connection.apiKey), envText)
        : envText
    )
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const files: CliConfigWriteFile[] = []
    const config = requireReadFile('hermes-config', read)
    if (config.content !== null) {
      try {
        const content = clearHermesConfig(config.content)
        if (content !== null) files.push({ target: 'hermes-config', content })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to parse Hermes config at ${config.path}: ${message}`)
      }
    }

    const env = requireReadFile('hermes-env', read)
    if (env.content !== null) {
      const envMap = parseDotenv(env.content)
      envMap.delete(HERMES_API_KEY_ENV)
      files.push({ target: 'hermes-env', content: renderDotenvFile(envMap, env.content) })
    }
    return files
  },
  extractConnection(files) {
    const config = parseYamlOrThrow(getDraftFile(files, 'hermes-config')?.content ?? '')
    const model = asRecord(config.model)
    if (model.api_key !== HERMES_API_KEY_ENV_REFERENCE) return null
    const env = parseDotenv(getDraftFile(files, 'hermes-env')?.content ?? '')
    return {
      baseUrl: stringValue(model.base_url),
      apiKey: stringValue(env.get(HERMES_API_KEY_ENV)),
      model: stringValue(model.default)
    }
  },
  extractConfig() {
    return {}
  }
}

const piAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.PI),
  providerBaseUrls: (provider) =>
    PI_ENDPOINTS.flatMap((endpoint) => {
      if (!provider.endpointConfigs?.[endpoint]?.baseUrl) return []
      const baseUrl = normalizeUrl(resolvePiProviderInfo(provider, [endpoint]).baseUrl)
      return baseUrl ? [baseUrl] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, context) {
    const { provider, apiKey, model, modelLabel, modelRecord } = context
    const providerInfo = resolvePiProviderInfo(provider, modelRecord?.endpointTypes)
    const providerKey = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const models = readAndParseDraftFile('pi-models', parseJsonOrThrow, args.files, read)
    const settings = readAndParseDraftFile('pi-settings', parseJsonOrThrow, args.files, read)
    const input: Array<'image' | 'text'> = modelRecord?.inputModalities?.includes('image')
      ? ['text', 'image']
      : ['text']
    return [
      makeDraftFile(
        'pi-models',
        renderJsonFile(
          buildPiModelsConfig(models, {
            api: providerInfo.api,
            apiKey,
            baseUrl: providerInfo.baseUrl,
            contextWindow: modelRecord?.contextWindow,
            headers: provider.settings?.extraHeaders,
            input,
            maxTokens: modelRecord?.maxOutputTokens,
            model,
            modelLabel: modelLabel ?? model,
            providerKey,
            reasoning: Boolean(modelRecord?.reasoning)
          })
        ),
        read
      ),
      makeDraftFile('pi-settings', renderJsonFile(buildPiSettingsConfig(settings, { model, providerKey })), read)
    ]
  },
  assertCredentials(context) {
    const { baseUrl } = resolvePiProviderInfo(context.provider, context.modelRecord?.endpointTypes)
    if (!context.apiKey || !baseUrl) throw new Error('Pi config is missing required fields (apiKey/baseUrl)')
  },
  updateDraftConfig(files) {
    return files
  },
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const files: CliConfigWriteFile[] = []
    const models = readValidatedJsonOrNull('pi-models', read, 'Pi models config')
    if (models) {
      files.push({
        target: 'pi-models',
        content: renderJsonFile({
          ...models,
          providers: omitKeysByPrefix(asRecord(models.providers), CHERRY_PROVIDER_PREFIX)
        })
      })
    }

    const settings = readValidatedJsonOrNull('pi-settings', read, 'Pi settings config')
    if (settings) {
      const next = { ...settings }
      if (stringValue(next.defaultProvider)?.startsWith(CHERRY_PROVIDER_PREFIX)) {
        delete next.defaultProvider
        delete next.defaultModel
      }
      files.push({ target: 'pi-settings', content: renderJsonFile(next) })
    }
    return files
  },
  extractConnection(files) {
    const models = parseJsonOrThrow(getDraftFile(files, 'pi-models')?.content ?? '')
    const settings = parseJsonOrThrow(getDraftFile(files, 'pi-settings')?.content ?? '')
    const providers = asRecord(models.providers)
    const providerKey = findCherryProviderKey(providers)
    if (!providerKey) return null
    const provider = asRecord(providers[providerKey])
    const configuredModels = Array.isArray(provider.models) ? provider.models : []
    const defaultModel =
      settings.defaultProvider === providerKey
        ? stringValue(settings.defaultModel)
        : stringValue(configuredModels[0]?.id)
    return {
      baseUrl: stringValue(provider.baseUrl),
      apiKey: stringValue(provider.apiKey),
      model: defaultModel
    }
  },
  extractConfig() {
    return {}
  }
}

/**
 * The file-based CLI tools, one adapter each. Typed as a **total** record over
 * `FileConfiguredCli` (the key set of `CLI_CONFIG_TARGETS`), so omitting an adapter
 * — or adding a new file-based CLI to `targets.ts` without one — is a compile error.
 */
export const CLI_CONFIG_ADAPTERS: Record<FileConfiguredCli, CliConfigAdapter> = {
  [CodeCli.CLAUDE_CODE]: claudeAdapter,
  [CodeCli.OPENAI_CODEX]: codexAdapter,
  [CodeCli.OPEN_CODE]: openCodeAdapter,
  [CodeCli.GEMINI_CLI]: geminiAdapter,
  [CodeCli.QWEN_CODE]: qwenAdapter,
  [CodeCli.KIMI_CODE]: kimiAdapter,
  [CodeCli.PI]: piAdapter,
  [CodeCli.HERMES]: hermesAdapter
}

export function getAdapter(cliTool: string): CliConfigAdapter | undefined {
  // The registry is total over `FileConfiguredCli`, but callers hold a raw string
  // cliTool that may name a provider-less/non-file tool — hence the runtime-safe lookup.
  return (CLI_CONFIG_ADAPTERS as Record<string, CliConfigAdapter | undefined>)[cliTool]
}

/** Strip a user-edited config blob to the tool params `cliTool` persists (no-op passthrough for unknown tools). */
export function sanitizeCliConfigBlob(
  cliTool: string,
  configBlob: Record<string, unknown> | undefined
): Record<string, any> {
  if (cliTool === CodeCli.DEEPSEEK_HARNESS) return normalizeDeepSeekHarnessSettings(configBlob)
  return getAdapter(cliTool)?.sanitize(configBlob) ?? asRecord(configBlob)
}
