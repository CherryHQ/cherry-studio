import { t } from 'i18next'
import { stringify as stringifyToml } from 'smol-toml'
import { type Document, stringify as stringifyYaml } from 'yaml'

import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingSlash } from '@shared/utils/api'
import { type CliConfigTarget, type CliConfigWriteFile, getCliConfigTargets } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { CHERRY_PROVIDER_PREFIX, PI_ENDPOINTS } from './constants'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
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
import { asRecord, cliProviderKeyName, findCherryProviderKey, omitKeysByPrefix, stringValue } from './values'

const GROK_ENDPOINTS: readonly EndpointType[] = ['openai-responses', 'openai-chat-completions']
const ANTHROPIC_OR_OPENAI_ENDPOINTS: readonly EndpointType[] = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]

function resolveAnthropicOrOpenAiBaseUrl(provider: Provider, endpoint: EndpointType): string {
  return endpoint === 'anthropic-messages'
    ? resolveClaudeBaseUrl(provider)
    : formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
}

function anthropicOrOpenAiBaseUrls(provider: Provider): string[] {
  return ANTHROPIC_OR_OPENAI_ENDPOINTS.flatMap((type) => {
    const url = provider.endpointConfigs?.[type]?.baseUrl
    return url ? [resolveAnthropicOrOpenAiBaseUrl(provider, type)] : []
  })
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
  providerBaseUrls: anthropicOrOpenAiBaseUrls,
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(
      provider,
      modelRecord?.endpointTypes,
      ANTHROPIC_OR_OPENAI_ENDPOINTS,
      'anthropic-messages'
    )
    const baseUrl = resolveAnthropicOrOpenAiBaseUrl(provider, endpoint)
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

interface JsonProviderAdapterSpec {
  tool: 'cline' | 'zcode' | 'snow' | 'glm-acp-agent'
  toolLabel: string
  primaryTarget: CliConfigTarget
  providersTarget: CliConfigTarget
}

function createJsonProviderAdapter(spec: JsonProviderAdapterSpec): CliConfigAdapter {
  const singleFile = spec.primaryTarget === spec.providersTarget

  return {
    targets: getCliConfigTargets(spec.tool),
    providerBaseUrls: anthropicOrOpenAiBaseUrls,
    sanitize: () => ({}),
    async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
      const endpoint = resolveSupportedEndpointType(
        provider,
        modelRecord?.endpointTypes,
        ANTHROPIC_OR_OPENAI_ENDPOINTS,
        'anthropic-messages'
      )
      const baseUrl = resolveAnthropicOrOpenAiBaseUrl(provider, endpoint)
      const providerKey = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
      const entry = {
        name: providerKey,
        baseUrl,
        apiKey,
        api:
          endpoint === 'anthropic-messages'
            ? 'anthropic'
            : endpoint === 'openai-responses'
              ? 'openai-responses'
              : 'openai',
        model,
        modelName: modelLabel ?? model
      }
      const read = await readConfigFilesForDraft(this.targets, args.files)
      const primary = readAndParseDraftFile(spec.primaryTarget, parseJsonOrThrow, args.files, read)
      if (singleFile) {
        const providers = omitKeysByPrefix(asRecord(primary.providers), CHERRY_PROVIDER_PREFIX)
        providers[providerKey] = entry
        return [
          makeDraftFile(
            spec.primaryTarget,
            renderJsonFile({ ...primary, model, provider: providerKey, providers }),
            read
          )
        ]
      }
      const registry = readAndParseDraftFile(spec.providersTarget, parseJsonOrThrow, args.files, read)
      const providers = omitKeysByPrefix(asRecord(registry.providers), CHERRY_PROVIDER_PREFIX)
      providers[providerKey] = entry
      return [
        makeDraftFile(spec.providersTarget, renderJsonFile({ ...registry, providers }), read),
        makeDraftFile(spec.primaryTarget, renderJsonFile({ ...primary, model, provider: providerKey }), read)
      ]
    },
    assertCredentials(context) {
      if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
        throw new Error(t('code.cli_config.missing_credentials', { tool: spec.toolLabel }))
      }
    },
    updateDraftConfig: (files) => files,
    async buildClearFiles() {
      const read = await readConfigFiles(this.targets)
      if (singleFile) {
        const config = readValidatedJsonOrNull(spec.primaryTarget, read, spec.toolLabel)
        if (!config) return []
        const next = { ...config }
        const providers = omitKeysByPrefix(asRecord(config.providers), CHERRY_PROVIDER_PREFIX)
        if (Object.keys(providers).length > 0) next.providers = providers
        else delete next.providers
        if (typeof next.provider === 'string' && next.provider.startsWith(CHERRY_PROVIDER_PREFIX)) {
          delete next.provider
          delete next.model
        }
        return [{ target: spec.primaryTarget, content: renderJsonFile(next) }]
      }
      const files: CliConfigWriteFile[] = []
      const registry = readValidatedJsonOrNull(spec.providersTarget, read, `${spec.toolLabel} providers`)
      if (registry) {
        const providers = omitKeysByPrefix(asRecord(registry.providers), CHERRY_PROVIDER_PREFIX)
        const nextRegistry = { ...registry }
        if (Object.keys(providers).length > 0) nextRegistry.providers = providers
        else delete nextRegistry.providers
        files.push({ target: spec.providersTarget, content: renderJsonFile(nextRegistry) })
      }
      const primary = readValidatedJsonOrNull(spec.primaryTarget, read, `${spec.toolLabel} settings`)
      if (primary && typeof primary.provider === 'string' && primary.provider.startsWith(CHERRY_PROVIDER_PREFIX)) {
        const nextPrimary = { ...primary }
        delete nextPrimary.provider
        delete nextPrimary.model
        files.push({ target: spec.primaryTarget, content: renderJsonFile(nextPrimary) })
      }
      return files
    },
    extractConnection(files) {
      const content = getDraftFile(files, spec.providersTarget)?.content
      if (!content) return null
      const registry = parseJsonOrThrow(content)
      const providers = asRecord(registry.providers)
      const cherryKey = findCherryProviderKey(providers)
      if (!cherryKey) return null
      const entry = asRecord(providers[cherryKey])
      return {
        baseUrl: stringValue(entry.baseUrl),
        apiKey: stringValue(entry.apiKey),
        model: stringValue(entry.model)
      }
    },
    extractConfig: () => ({})
  }
}

export const clineAdapter = createJsonProviderAdapter({
  tool: 'cline',
  toolLabel: 'Cline',
  primaryTarget: 'cline-settings',
  providersTarget: 'cline-providers'
})

export const zcodeAdapter = createJsonProviderAdapter({
  tool: 'zcode',
  toolLabel: 'ZCode',
  primaryTarget: 'zcode-config',
  providersTarget: 'zcode-providers'
})

export const snowAdapter = createJsonProviderAdapter({
  tool: 'snow',
  toolLabel: 'Snow',
  primaryTarget: 'snow-config',
  providersTarget: 'snow-config'
})

export const glmAcpAgentAdapter = createJsonProviderAdapter({
  tool: 'glm-acp-agent',
  toolLabel: 'GLM ACP Agent',
  primaryTarget: 'glm-credentials',
  providersTarget: 'glm-credentials'
})
