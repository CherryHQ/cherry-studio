import type { Provider } from '@shared/data/types/provider'
import { CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'
import { GEMINI_GATEWAY_MODEL_SUFFIX, stripGeminiGatewayModelSuffix } from '@shared/utils/apiGateway'
import {
  CLAUDE_SETTINGS_PATH,
  type CliConfigWriteFile,
  CODEX_AUTH_PATH,
  CODEX_CONFIG_PATH,
  type FileConfiguredCli,
  GEMINI_ENV_PATH,
  GEMINI_SETTINGS_PATH,
  getCliConfigTargets,
  KIMI_CONFIG_PATH,
  OPENCODE_CONFIG_PATH,
  PI_MODELS_PATH,
  PI_SETTINGS_PATH,
  QWEN_CONFIG_PATH
} from '@shared/utils/cliConfig'
import { stringify as stringifyToml } from 'smol-toml'

import {
  buildClaudeConfig,
  buildCodexAuthConfig,
  buildCodexConfig,
  buildGeminiEnvConfig,
  buildGeminiSettingsConfig,
  buildKimiConfig,
  buildOpenCodeConfig,
  buildPiModelsConfig,
  buildPiSettingsConfig,
  buildQwenConfig
} from './builders'
import { CHERRY_PROVIDER_PREFIX, OPEN_CODE_ENDPOINTS, PI_ENDPOINTS } from './constants'
import { parseDotenv, renderDotenvFile } from './dotenv'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readDraftFileText } from './draftFiles'
import {
  parseJsonOrThrow,
  parseTomlOrThrow,
  readExternalOrNull,
  readValidatedJsonOrNull,
  readValidatedTomlOrNull,
  renderJsonFile,
  resolveAbs
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
  modelSupportsReasoningEffort,
  openCodeNpmInfoFromNpmPackage,
  resolveClaudeBaseUrl,
  resolveCodexBaseUrl,
  resolveGeminiBaseUrl,
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

const claudeAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.CLAUDE_CODE),
  providerBaseUrls: (provider) => [normalizeUrl(resolveClaudeBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeClaudeConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, configBlob } = context
    const existing = await readAndParseDraftFile('claude-settings', parseJsonOrThrow, args.files)
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
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Claude Code config is missing the API key')
  },
  async buildOwnLoginDraft(configBlob) {
    const existing = await readAndParseDraftFile('claude-settings', parseJsonOrThrow)
    return [
      await makeDraftFile(
        'claude-settings',
        renderJsonFile(
          buildClaudeConfig(existing, configBlob, { apiKey: '', baseUrl: '', model: '', writePrimaryModel: false })
        )
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
    const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)
    const existing = await readValidatedJsonOrNull(absPath, 'Claude Code settings')
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
    const config = await readAndParseDraftFile('codex-config', parseTomlOrThrow, args.files)
    const auth = await readAndParseDraftFile('codex-auth', parseJsonOrThrow, args.files)
    const providerName = cliProviderKeyName(provider)
    return [
      await makeDraftFile(
        'codex-config',
        stringifyToml(buildCodexConfig(config, { baseUrl: responsesUrl, providerName, model }, configBlob))
      ),
      await makeDraftFile('codex-auth', renderJsonFile(buildCodexAuthConfig(auth, apiKey)))
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Codex config is missing the API key')
  },
  async buildOwnLoginDraft(configBlob) {
    const config = await readAndParseDraftFile('codex-config', parseTomlOrThrow)
    return [await makeDraftFile('codex-config', stringifyToml(buildCodexOwnLoginConfig(config, configBlob)))]
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
    const absPath = await resolveAbs(CODEX_CONFIG_PATH)
    const authAbsPath = await resolveAbs(CODEX_AUTH_PATH)
    const existing = await readValidatedTomlOrNull(absPath, 'Codex config')
    const existingAuth = await readValidatedJsonOrNull(authAbsPath, 'Codex auth')
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
    if (existingAuth?.OPENAI_API_KEY !== undefined) {
      const nextAuth = { ...existingAuth }
      delete nextAuth.OPENAI_API_KEY
      files.push({ target: 'codex-auth', content: renderJsonFile(nextAuth) })
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
    const existing = await readAndParseDraftFile('opencode-config', parseJsonOrThrow, args.files)
    const env = asRecord(configBlob.env)
    return [
      await makeDraftFile(
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
        )
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
    const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
    const existing = await readValidatedJsonOrNull(absPath, 'OpenCode config')
    if (!existing) return []
    const next: Record<string, any> = { ...existing }
    for (const key of OPEN_CODE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
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
    if (config.autoCompact === true) out.autoCompact = true
    if (isOpenCodePermissionMode(config.permission)) out.permissionMode = config.permission
    const providers = asRecord(config.provider)
    const providerKey = findCherryProviderKey(providers)
    const provider = asRecord(providerKey ? providers[providerKey] : undefined)
    const model = asRecord(Object.entries(asRecord(provider.models))[0]?.[1])
    if (model.reasoning === true) out.env = { OPENCODE_REASONING: 'true' }
    return out
  }
}

const geminiAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.GEMINI_CLI),
  providerBaseUrls: (provider) => [normalizeUrl(resolveGeminiBaseUrl(provider))].filter(Boolean),
  sanitize: sanitizeGeminiConfigBlob,
  async buildDraft(args, context) {
    const { provider, apiKey, model, configBlob } = context
    const envText = await readDraftFileText('gemini-env', args.files)
    const settings = await readAndParseDraftFile('gemini-settings', parseJsonOrThrow, args.files)
    const baseUrl = resolveGeminiBaseUrl(provider)
    const isGateway = isApiGatewayProviderId(provider.id)
    // Gateway addresses carry the sentinel suffix so gemini-cli's model
    // normalization can't rewrite them (see GEMINI_GATEWAY_MODEL_SUFFIX);
    // extractConnection strips it back off for connection matching.
    const settingsModel = isGateway ? `${model}${GEMINI_GATEWAY_MODEL_SUFFIX}` : model
    return [
      await makeDraftFile(
        'gemini-env',
        renderDotenvFile(buildGeminiEnvConfig(parseDotenv(envText), { apiKey, baseUrl, gateway: isGateway }), envText)
      ),
      await makeDraftFile(
        'gemini-settings',
        renderJsonFile(buildGeminiSettingsConfig(settings, { model: settingsModel }, configBlob))
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Gemini CLI config is missing the API key')
  },
  async buildOwnLoginDraft(configBlob) {
    const settings = await readAndParseDraftFile('gemini-settings', parseJsonOrThrow)
    return [await makeDraftFile('gemini-settings', renderJsonFile(buildGeminiOwnLoginSettings(settings, configBlob)))]
  },
  updateDraftConfig(files, connection, configBlob) {
    const envText = getDraftFile(files, 'gemini-env')?.content ?? ''
    const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
    const model = requireDraftValue(connection.model, 'Gemini model')
    // A gateway draft carries the sentinel in settings.model.name; extractConnection
    // strips it for connection matching, so re-append it here (and re-force the API
    // version) to preserve the gateway identity through a foreign-edit round trip —
    // gemini-cli reads settings.model.name, so a bare `flash`-ending address written
    // back would be re-normalized on a direct terminal launch.
    const isGateway = (stringValue(asRecord(settings.model).name) ?? '').endsWith(GEMINI_GATEWAY_MODEL_SUFFIX)
    const settingsModel = isGateway ? `${model}${GEMINI_GATEWAY_MODEL_SUFFIX}` : model
    return replaceDraftContent(
      replaceDraftContent(
        files,
        'gemini-env',
        renderDotenvFile(
          buildGeminiEnvConfig(parseDotenv(envText), {
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
    const files: CliConfigWriteFile[] = []
    const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
    const envText = await readExternalOrNull(envAbsPath)
    if (envText !== null) {
      const envMap = parseDotenv(envText)
      for (const key of GEMINI_MANAGED_ENV_KEYS) envMap.delete(key)
      files.push({ target: 'gemini-env', content: renderDotenvFile(envMap, envText) })
    }

    const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
    const settings = await readValidatedJsonOrNull(settingsAbsPath, 'Gemini CLI settings')
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
      model: model === undefined ? model : stripGeminiGatewayModelSuffix(model)
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
    const existing = await readAndParseDraftFile('qwen-settings', parseJsonOrThrow, args.files)
    return [
      await makeDraftFile(
        'qwen-settings',
        renderJsonFile(
          buildQwenConfig(existing, { apiKey, baseUrl, model, modelLabel: modelRecord?.name ?? model }, configBlob)
        )
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
    const existing = await readAndParseDraftFile('qwen-settings', parseJsonOrThrow)
    return [await makeDraftFile('qwen-settings', renderJsonFile(buildQwenOwnLoginConfig(existing, configBlob)))]
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
    const absPath = await resolveAbs(QWEN_CONFIG_PATH)
    const existing = await readValidatedJsonOrNull(absPath, 'Qwen Code config')
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
    const existing = await readAndParseDraftFile('kimi-config', parseTomlOrThrow, args.files)
    const providerName = cliProviderKeyName(provider)
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
  },
  assertCredentials(context) {
    if (!context.apiKey) throw new Error('Kimi CLI config is missing the API key')
    if (!resolveOpenAIBaseUrl(context.provider)) {
      throw new Error('Kimi CLI config is missing the OpenAI endpoint base URL')
    }
  },
  async buildOwnLoginDraft(configBlob) {
    const existing = await readAndParseDraftFile('kimi-config', parseTomlOrThrow)
    return [await makeDraftFile('kimi-config', stringifyToml(buildKimiOwnLoginConfig(existing, configBlob)))]
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
    const absPath = await resolveAbs(KIMI_CONFIG_PATH)
    const existing = await readValidatedTomlOrNull(absPath, 'Kimi Code config')
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
    const models = await readAndParseDraftFile('pi-models', parseJsonOrThrow, args.files)
    const settings = await readAndParseDraftFile('pi-settings', parseJsonOrThrow, args.files)
    const input: Array<'image' | 'text'> = modelRecord?.inputModalities?.includes('image')
      ? ['text', 'image']
      : ['text']
    return [
      await makeDraftFile(
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
        )
      ),
      await makeDraftFile('pi-settings', renderJsonFile(buildPiSettingsConfig(settings, { model, providerKey })))
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
    const files: CliConfigWriteFile[] = []
    const models = await readValidatedJsonOrNull(await resolveAbs(PI_MODELS_PATH), 'Pi models config')
    if (models) {
      files.push({
        target: 'pi-models',
        content: renderJsonFile({
          ...models,
          providers: omitKeysByPrefix(asRecord(models.providers), CHERRY_PROVIDER_PREFIX)
        })
      })
    }

    const settings = await readValidatedJsonOrNull(await resolveAbs(PI_SETTINGS_PATH), 'Pi settings config')
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
  [CodeCli.PI]: piAdapter
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
  return getAdapter(cliTool)?.sanitize(configBlob) ?? asRecord(configBlob)
}
