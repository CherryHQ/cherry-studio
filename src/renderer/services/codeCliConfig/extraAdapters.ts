import { t } from 'i18next'
import { stringify as stringifyToml } from 'smol-toml'
import { type Document, stringify as stringifyYaml } from 'yaml'

import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion, withoutTrailingSlash } from '@shared/utils/api'
import { type CliConfigTarget, type CliConfigWriteFile, getCliConfigTargets } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { CHERRY_PROVIDER_PREFIX, PI_ENDPOINTS } from './constants'
import {
  getDraftFile,
  makeDraftFile,
  readAndParseDraftFile,
  readConfigFilesForDraft,
  readDraftFileText
} from './draftFiles'
import {
  type CliConfigReadFiles,
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
import { resolveClaudeBaseUrl, resolvePiProviderInfo, resolveSupportedEndpointType } from './resolvers'
import type { CliConfigFileDraft } from './types'
import { asRecord, cliProviderKeyName, findCherryProviderKey, omitKeysByPrefix, stringValue } from './values'

const GROK_ENDPOINTS: readonly EndpointType[] = ['openai-responses', 'openai-chat-completions']
const ANTHROPIC_OR_OPENAI_ENDPOINTS: readonly EndpointType[] = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]
const ZCODE_ENDPOINTS: readonly EndpointType[] = ['anthropic-messages', 'openai-chat-completions']
const OPENAI_CHAT_ENDPOINTS: readonly EndpointType[] = ['openai-chat-completions']

function resolveAnthropicOrOpenAiBaseUrl(provider: Provider, endpoint: EndpointType): string {
  return endpoint === 'anthropic-messages'
    ? resolveClaudeBaseUrl(provider)
    : formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
}

function resolveSnowBaseUrl(provider: Provider, endpoint: EndpointType): string {
  return formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
}

function resolveGooseBaseUrl(provider: Provider, endpoint: EndpointType): string {
  const url = provider.endpointConfigs?.[endpoint]?.baseUrl
  return url ? withoutTrailingApiVersion(formatApiHost(url, false)) : ''
}

function readYamlDocumentOrNull(target: CliConfigTarget, read: CliConfigReadFiles): Document | null {
  const { content } = requireReadFile(target, read)
  return content === null ? null : parseYamlDocumentOrThrow(content)
}

function readYamlMappingOrNull(target: CliConfigTarget, read: CliConfigReadFiles): Record<string, any> | null {
  const { content } = requireReadFile(target, read)
  return content === null ? null : parseYamlOrThrow(content)
}

export const grokBuildAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('grok-build'),
  providerBaseUrls: (provider) =>
    GROK_ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [formatApiHost(url)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(
      provider,
      modelRecord?.endpointTypes,
      GROK_ENDPOINTS,
      'openai-chat-completions'
    )
    const baseUrl = formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const providerKey = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const existing = readAndParseDraftFile('grok-config', parseTomlOrThrow, args.files, read)
    const models = { ...asRecord(existing.models), default: providerKey }
    const modelTable = omitKeysByPrefix(asRecord(existing.model), CHERRY_PROVIDER_PREFIX)
    modelTable[providerKey] = {
      model,
      base_url: baseUrl,
      name: modelLabel ?? model,
      api_key: apiKey,
      ...(endpoint === 'openai-responses' ? { api_backend: 'responses' } : {}),
      ...(modelRecord?.contextWindow ? { context_window: modelRecord.contextWindow } : {}),
      ...(modelRecord?.maxOutputTokens ? { max_completion_tokens: modelRecord.maxOutputTokens } : {})
    }
    return [makeDraftFile('grok-config', stringifyToml({ ...existing, models, model: modelTable }), read)]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Grok Build' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const existing = readValidatedTomlOrNull('grok-config', read, 'Grok config')
    if (!existing) return []
    const next = { ...existing }
    const modelTable = omitKeysByPrefix(asRecord(existing.model), CHERRY_PROVIDER_PREFIX)
    if (Object.keys(modelTable).length > 0) next.model = modelTable
    else delete next.model
    const models = { ...asRecord(existing.models) }
    if (typeof models.default === 'string' && models.default.startsWith(CHERRY_PROVIDER_PREFIX)) {
      delete models.default
    }
    if (Object.keys(models).length > 0) next.models = models
    else delete next.models
    return [{ target: 'grok-config', content: stringifyToml(next) }]
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'grok-config')?.content
    if (!content) return null
    const parsed = parseTomlOrThrow(content)
    const modelTable = asRecord(parsed.model)
    const defaultKey = stringValue(parsed.models?.default)
    const cherryKey =
      defaultKey?.startsWith(CHERRY_PROVIDER_PREFIX) && modelTable[defaultKey]
        ? defaultKey
        : findCherryProviderKey(modelTable)
    if (!cherryKey) return null
    const entry = asRecord(modelTable[cherryKey])
    return {
      baseUrl: stringValue(entry.base_url),
      apiKey: stringValue(entry.api_key),
      model: stringValue(entry.model)
    }
  },
  extractConfig: () => ({})
}

export const ompAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('omp'),
  providerBaseUrls: (provider) =>
    PI_ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      if (!url) return []
      return [
        type === 'google-generate-content'
          ? formatApiHost(url, true, 'v1beta')
          : type === 'anthropic-messages'
            ? withoutTrailingSlash(url)
            : formatApiHost(url)
      ]
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const providerKey = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
    const piInfo = resolvePiProviderInfo(provider, modelRecord?.endpointTypes)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const settingsDoc = readAndParseDraftFile('omp-settings', parseYamlDocumentOrThrow, args.files, read)
    settingsDoc.setIn(['defaultProvider'], providerKey)
    settingsDoc.setIn(['defaultModel'], model)
    const modelsYaml = readAndParseDraftFile('omp-models', parseYamlOrThrow, args.files, read)
    const providers = omitKeysByPrefix(asRecord(modelsYaml.providers), CHERRY_PROVIDER_PREFIX)
    providers[providerKey] = {
      baseUrl: piInfo.baseUrl,
      api: piInfo.api,
      apiKey,
      models: [
        {
          id: model,
          name: modelLabel ?? model,
          ...(modelRecord?.reasoning ? { reasoning: true } : {}),
          input: modelRecord?.inputModalities?.includes('image') ? ['text', 'image'] : ['text'],
          ...(modelRecord?.contextWindow ? { contextWindow: modelRecord.contextWindow } : {}),
          ...(modelRecord?.maxOutputTokens ? { maxTokens: modelRecord.maxOutputTokens } : {})
        }
      ]
    }
    return [
      makeDraftFile('omp-models', stringifyYaml({ ...modelsYaml, providers }), read),
      makeDraftFile('omp-settings', settingsDoc.toString(), read)
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Oh My Pi' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const files: CliConfigWriteFile[] = []
    const models = readYamlMappingOrNull('omp-models', read)
    if (models) {
      const providers = omitKeysByPrefix(asRecord(models.providers), CHERRY_PROVIDER_PREFIX)
      const next = { ...models }
      if (Object.keys(providers).length > 0) next.providers = providers
      else delete next.providers
      files.push({ target: 'omp-models', content: stringifyYaml(next) })
    }
    const settingsDoc = readYamlDocumentOrNull('omp-settings', read)
    if (settingsDoc) {
      const defaultProvider = settingsDoc.getIn(['defaultProvider'])
      if (typeof defaultProvider === 'string' && defaultProvider.startsWith(CHERRY_PROVIDER_PREFIX)) {
        settingsDoc.deleteIn(['defaultProvider'])
        settingsDoc.deleteIn(['defaultModel'])
      }
      files.push({ target: 'omp-settings', content: settingsDoc.toString() })
    }
    return files
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'omp-models')?.content
    if (!content) return null
    const models = parseYamlOrThrow(content)
    const providers = asRecord(models.providers)
    const cherryKey = findCherryProviderKey(providers)
    if (!cherryKey) return null
    const entry = asRecord(providers[cherryKey])
    const firstModel = Array.isArray(entry.models) ? asRecord(entry.models[0]) : undefined
    return {
      baseUrl: stringValue(entry.baseUrl),
      apiKey: stringValue(entry.apiKey),
      model: stringValue(firstModel?.id)
    }
  },
  extractConfig: () => ({})
}

export const gooseAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('goose'),
  providerBaseUrls: (provider) =>
    ANTHROPIC_OR_OPENAI_ENDPOINTS.flatMap((type) =>
      provider.endpointConfigs?.[type]?.baseUrl ? [resolveGooseBaseUrl(provider, type)] : []
    ),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(
      provider,
      modelRecord?.endpointTypes,
      ANTHROPIC_OR_OPENAI_ENDPOINTS,
      'anthropic-messages'
    )
    const baseUrl = resolveGooseBaseUrl(provider, endpoint)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const doc = readAndParseDraftFile('goose-config', parseYamlDocumentOrThrow, args.files, read)
    doc.setIn(['CHERRY_MANAGED'], true)
    doc.setIn(['GOOSE_MODEL'], model)
    if (endpoint === 'anthropic-messages') {
      doc.setIn(['GOOSE_PROVIDER'], 'anthropic')
      doc.setIn(['ANTHROPIC_HOST'], baseUrl)
      doc.setIn(['ANTHROPIC_API_KEY'], apiKey)
      doc.deleteIn(['OPENAI_HOST'])
      doc.deleteIn(['OPENAI_API_KEY'])
    } else {
      doc.setIn(['GOOSE_PROVIDER'], 'openai')
      doc.setIn(['OPENAI_HOST'], baseUrl)
      doc.setIn(['OPENAI_API_KEY'], apiKey)
      doc.deleteIn(['ANTHROPIC_HOST'])
      doc.deleteIn(['ANTHROPIC_API_KEY'])
    }
    return [makeDraftFile('goose-config', doc.toString(), read)]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'goose' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const doc = readYamlDocumentOrNull('goose-config', read)
    if (!doc || doc.get('CHERRY_MANAGED') !== true) return []
    for (const key of [
      'CHERRY_MANAGED',
      'GOOSE_MODEL',
      'GOOSE_PROVIDER',
      'ANTHROPIC_HOST',
      'ANTHROPIC_API_KEY',
      'OPENAI_HOST',
      'OPENAI_API_KEY'
    ]) {
      doc.deleteIn([key])
    }
    return [{ target: 'goose-config', content: doc.toString() }]
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'goose-config')?.content
    if (!content) return null
    const config = parseYamlOrThrow(content)
    // Only surface Cherry-managed goose configs so unmanaged drafts keep CLI fields hidden.
    if (config.CHERRY_MANAGED !== true) return null
    if (config.GOOSE_PROVIDER === 'anthropic') {
      return {
        baseUrl: stringValue(config.ANTHROPIC_HOST),
        apiKey: stringValue(config.ANTHROPIC_API_KEY),
        model: stringValue(config.GOOSE_MODEL)
      }
    }
    return {
      baseUrl: stringValue(config.OPENAI_HOST),
      apiKey: stringValue(config.OPENAI_API_KEY),
      model: stringValue(config.GOOSE_MODEL)
    }
  },
  extractConfig: () => ({})
}

function stripLegacyCherryJsonFields(config: Record<string, any>): Record<string, any> {
  const next = { ...config }
  if (next.providers && typeof next.providers === 'object' && !Array.isArray(next.providers)) {
    const cleanedProviders = omitKeysByPrefix(asRecord(next.providers), CHERRY_PROVIDER_PREFIX)
    if (Object.keys(cleanedProviders).length > 0) next.providers = cleanedProviders
    else delete next.providers
  }
  if (typeof next.provider === 'string' && next.provider.startsWith(CHERRY_PROVIDER_PREFIX)) {
    delete next.provider
    delete next.model
  }
  return next
}

function extractLegacyCherryJsonConnection(
  registry: Record<string, any>
): { baseUrl?: string; apiKey?: string; model?: string } | null {
  const providers = asRecord(registry.providers)
  const cherryKey = findCherryProviderKey(providers)
  if (!cherryKey) return null
  const entry = asRecord(providers[cherryKey])
  return {
    baseUrl: stringValue(entry.baseUrl),
    apiKey: stringValue(entry.apiKey),
    model: stringValue(entry.model)
  }
}

export const clineAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('cline'),
  providerBaseUrls: (provider) => {
    const url = provider.endpointConfigs?.['openai-chat-completions']?.baseUrl
    return url ? [formatApiHost(url)] : []
  },
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model }) {
    const endpoint = resolveSupportedEndpointType(provider, undefined, OPENAI_CHAT_ENDPOINTS, 'openai-chat-completions')
    const baseUrl = formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const registry = stripLegacyCherryJsonFields(
      readAndParseDraftFile('cline-providers', parseJsonOrThrow, args.files, read)
    )
    const providers = omitKeysByPrefix(asRecord(registry.providers), CHERRY_PROVIDER_PREFIX)
    providers['openai-compatible'] = {
      settings: {
        provider: 'openai-compatible',
        apiKey,
        model,
        baseUrl
      },
      updatedAt: new Date().toISOString(),
      tokenSource: 'manual',
      cherryManaged: true
    }
    const drafts: CliConfigFileDraft[] = [
      makeDraftFile(
        'cline-providers',
        renderJsonFile({
          ...registry,
          version: typeof registry.version === 'number' ? registry.version : 1,
          lastUsedProvider: 'openai-compatible',
          modes: asRecord(registry.modes),
          providers
        }),
        read
      )
    ]
    const settingsText = readDraftFileText('cline-settings', args.files, read)
    if (settingsText) {
      const settings = parseJsonOrThrow(settingsText)
      if (typeof settings.provider === 'string' && settings.provider.startsWith(CHERRY_PROVIDER_PREFIX)) {
        const cleaned = stripLegacyCherryJsonFields(settings)
        drafts.push(makeDraftFile('cline-settings', renderJsonFile(cleaned), read))
      }
    }
    return drafts
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Cline' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const files: CliConfigWriteFile[] = []
    const registry = readValidatedJsonOrNull('cline-providers', read, 'Cline providers')
    if (registry) {
      const providers = omitKeysByPrefix(asRecord(registry.providers), CHERRY_PROVIDER_PREFIX)
      if (asRecord(providers['openai-compatible']).cherryManaged === true) {
        delete providers['openai-compatible']
      }
      const next = { ...registry }
      if (Object.keys(providers).length > 0) next.providers = providers
      else delete next.providers
      if (
        next.lastUsedProvider === 'openai-compatible' ||
        (typeof next.lastUsedProvider === 'string' && next.lastUsedProvider.startsWith(CHERRY_PROVIDER_PREFIX))
      ) {
        const fallback = Object.keys(providers)[0]
        if (fallback) next.lastUsedProvider = fallback
        else delete next.lastUsedProvider
      }
      files.push({ target: 'cline-providers', content: renderJsonFile(next) })
    }
    const settings = readValidatedJsonOrNull('cline-settings', read, 'Cline settings')
    if (settings && typeof settings.provider === 'string' && settings.provider.startsWith(CHERRY_PROVIDER_PREFIX)) {
      files.push({ target: 'cline-settings', content: renderJsonFile(stripLegacyCherryJsonFields(settings)) })
    }
    return files
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'cline-providers')?.content
    if (!content) return null
    const registry = parseJsonOrThrow(content)
    const providers = asRecord(registry.providers)
    const compat = asRecord(providers['openai-compatible'])
    if (compat.cherryManaged === true) {
      const settings = asRecord(compat.settings)
      return {
        baseUrl: stringValue(settings.baseUrl),
        apiKey: stringValue(settings.apiKey),
        model: stringValue(settings.model)
      }
    }
    return extractLegacyCherryJsonConnection(registry)
  },
  extractConfig: () => ({})
}

export const zcodeAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('zcode'),
  providerBaseUrls: (provider) =>
    ZCODE_ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [resolveAnthropicOrOpenAiBaseUrl(provider, type)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(
      provider,
      modelRecord?.endpointTypes,
      ZCODE_ENDPOINTS,
      'openai-chat-completions'
    )
    const baseURL = resolveAnthropicOrOpenAiBaseUrl(provider, endpoint)
    const providerKey = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const primary = stripLegacyCherryJsonFields(
      readAndParseDraftFile('zcode-config', parseJsonOrThrow, args.files, read)
    )
    const providerMap = omitKeysByPrefix(asRecord(primary.provider), CHERRY_PROVIDER_PREFIX)
    const limit: Record<string, number> = {}
    if (modelRecord?.contextWindow) limit.context = modelRecord.contextWindow
    if (modelRecord?.maxOutputTokens) limit.output = modelRecord.maxOutputTokens
    providerMap[providerKey] = {
      name: providerKey,
      kind: endpoint === 'anthropic-messages' ? 'anthropic' : 'openai-compatible',
      source: 'custom',
      enabled: true,
      options: { baseURL, apiKey },
      models: {
        [model]: {
          name: modelLabel ?? model,
          ...(Object.keys(limit).length > 0 ? { limit } : {})
        }
      }
    }
    const drafts: CliConfigFileDraft[] = [
      makeDraftFile('zcode-config', renderJsonFile({ ...primary, provider: providerMap }), read)
    ]
    const providersText = readDraftFileText('zcode-providers', args.files, read)
    if (providersText) {
      const registry = parseJsonOrThrow(providersText)
      if (findCherryProviderKey(asRecord(registry.providers))) {
        drafts.push(makeDraftFile('zcode-providers', renderJsonFile(stripLegacyCherryJsonFields(registry)), read))
      }
    }
    return drafts
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'ZCode' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const files: CliConfigWriteFile[] = []
    const config = readValidatedJsonOrNull('zcode-config', read, 'ZCode config')
    if (config) {
      const next = stripLegacyCherryJsonFields(config)
      if (next.provider && typeof next.provider === 'object' && !Array.isArray(next.provider)) {
        const cleaned = omitKeysByPrefix(asRecord(next.provider), CHERRY_PROVIDER_PREFIX)
        if (Object.keys(cleaned).length > 0) next.provider = cleaned
        else delete next.provider
      }
      files.push({ target: 'zcode-config', content: renderJsonFile(next) })
    }
    const registry = readValidatedJsonOrNull('zcode-providers', read, 'ZCode providers')
    if (registry && findCherryProviderKey(asRecord(registry.providers))) {
      files.push({ target: 'zcode-providers', content: renderJsonFile(stripLegacyCherryJsonFields(registry)) })
    }
    return files
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'zcode-config')?.content
    if (content) {
      const config = parseJsonOrThrow(content)
      if (config.provider && typeof config.provider === 'object' && !Array.isArray(config.provider)) {
        const cherryKey = findCherryProviderKey(asRecord(config.provider))
        if (cherryKey) {
          const entry = asRecord(config.provider[cherryKey])
          const options = asRecord(entry.options)
          const firstModel = Object.keys(asRecord(entry.models))[0]
          return {
            baseUrl: stringValue(options.baseURL),
            apiKey: stringValue(options.apiKey),
            model: stringValue(firstModel)
          }
        }
      }
    }
    const legacyContent = getDraftFile(files, 'zcode-providers')?.content
    return legacyContent ? extractLegacyCherryJsonConnection(parseJsonOrThrow(legacyContent)) : null
  },
  extractConfig: () => ({})
}

export const snowAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('snow'),
  providerBaseUrls: (provider) =>
    ANTHROPIC_OR_OPENAI_ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [resolveSnowBaseUrl(provider, type)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(
      provider,
      modelRecord?.endpointTypes,
      ANTHROPIC_OR_OPENAI_ENDPOINTS,
      'anthropic-messages'
    )
    const baseUrl = resolveSnowBaseUrl(provider, endpoint)
    const requestMethod =
      endpoint === 'anthropic-messages' ? 'anthropic' : endpoint === 'openai-responses' ? 'responses' : 'chat'
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const primary = stripLegacyCherryJsonFields(
      readAndParseDraftFile('snow-config', parseJsonOrThrow, args.files, read)
    )
    const snowcfg = {
      ...asRecord(primary.snowcfg),
      baseUrl,
      baseUrlMode: 'auto',
      apiKey,
      requestMethod,
      advancedModel: model,
      basicModel: model
    }
    return [makeDraftFile('snow-config', renderJsonFile({ ...primary, snowcfg, cherryManaged: true }), read)]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Snow' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const config = readValidatedJsonOrNull('snow-config', read, 'Snow')
    if (!config) return []
    const next = stripLegacyCherryJsonFields(config)
    if (next.cherryManaged === true) {
      const snowcfg = { ...asRecord(next.snowcfg) }
      delete snowcfg.apiKey
      delete snowcfg.baseUrl
      delete snowcfg.baseUrlMode
      delete snowcfg.requestMethod
      delete snowcfg.advancedModel
      delete snowcfg.basicModel
      if (Object.keys(snowcfg).length > 0) next.snowcfg = snowcfg
      else delete next.snowcfg
      delete next.cherryManaged
    }
    return [{ target: 'snow-config', content: renderJsonFile(next) }]
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'snow-config')?.content
    if (!content) return null
    const config = parseJsonOrThrow(content)
    if (config.cherryManaged === true) {
      const snowcfg = asRecord(config.snowcfg)
      return {
        baseUrl: stringValue(snowcfg.baseUrl),
        apiKey: stringValue(snowcfg.apiKey),
        model: stringValue(snowcfg.advancedModel)
      }
    }
    return extractLegacyCherryJsonConnection(config)
  },
  extractConfig: () => ({})
}

export const glmAcpAgentAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('glm-acp-agent'),
  providerBaseUrls: (provider) => {
    const url = provider.endpointConfigs?.['openai-chat-completions']?.baseUrl
    return url ? [formatApiHost(url)] : []
  },
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel }) {
    const endpoint = resolveSupportedEndpointType(provider, undefined, OPENAI_CHAT_ENDPOINTS, 'openai-chat-completions')
    const baseUrl = formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const primary = stripLegacyCherryJsonFields(
      readAndParseDraftFile('glm-credentials', parseJsonOrThrow, args.files, read)
    )
    return [
      makeDraftFile(
        'glm-credentials',
        renderJsonFile({
          ...primary,
          z_ai_api_key: apiKey,
          base_url: baseUrl,
          model,
          model_name: modelLabel ?? model,
          cherry_managed: true
        }),
        read
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'GLM ACP Agent' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const config = readValidatedJsonOrNull('glm-credentials', read, 'GLM ACP Agent')
    if (!config) return []
    const next = stripLegacyCherryJsonFields(config)
    if (next.cherry_managed === true) {
      delete next.z_ai_api_key
      delete next.base_url
      delete next.model
      delete next.model_name
      delete next.cherry_managed
    }
    return [{ target: 'glm-credentials', content: renderJsonFile(next) }]
  },
  extractConnection(files) {
    const content = getDraftFile(files, 'glm-credentials')?.content
    if (!content) return null
    const config = parseJsonOrThrow(content)
    if (config.cherry_managed === true) {
      return {
        baseUrl: stringValue(config.base_url),
        apiKey: stringValue(config.z_ai_api_key),
        model: stringValue(config.model)
      }
    }
    return extractLegacyCherryJsonConnection(config)
  },
  extractConfig: () => ({})
}
