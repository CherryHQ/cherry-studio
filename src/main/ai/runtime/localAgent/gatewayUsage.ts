import { parse as parseDotenv } from 'dotenv'
import { parse, type ParseError } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { parse as parseYaml } from 'yaml'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { type CliConfigTarget, getCliConfigTargets, POOLSIDE_GATEWAY_SERVER } from '@shared/utils/cliConfig'

import { readNativeModelConfig } from './nativeModelConfig'

const paths: Record<string, string> = {
  '@ai-sdk/openai-compatible': '/v1/chat/completions',
  '@ai-sdk/openai': '/v1/responses',
  '@ai-sdk/anthropic': '/v1/messages'
}

type ConfigFile = { target?: CliConfigTarget; content: string | null }

type GatewayRouteInfo = {
  baseUrl?: unknown
  apiKey?: unknown
  model?: unknown
  path?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  const errors: ParseError[] = []
  const parsed = parse(content, errors, { allowTrailingComma: true })
  if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

function parseTomlObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    return asRecord(toml.parse(content))
  } catch {
    return undefined
  }
}

function parseYamlObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    return asRecord(parseYaml(content))
  } catch {
    return undefined
  }
}

function fileContent(files: readonly ConfigFile[], target: CliConfigTarget): string | null | undefined {
  return files.find((file) => file.target === target)?.content
}

function pathForOpenAiOrAnthropic(api: unknown): string {
  return api === 'anthropic' || api === 'anthropic_messages' || api === 'anthropic-messages'
    ? '/v1/messages'
    : api === 'responses' || api === 'openai-responses'
      ? '/v1/responses'
      : '/v1/chat/completions'
}

function extractGatewayRoute(
  presetId: string,
  nativeTarget: CliConfigTarget,
  nativeModel: string,
  primaryContent: string,
  files: readonly ConfigFile[],
  env: NodeJS.ProcessEnv
): GatewayRouteInfo | undefined {
  switch (presetId) {
    case 'poolside': {
      const doc = parseYamlObject(primaryContent)
      const pool = asRecord(doc?.pool)
      if (pool.default_agent_server !== POOLSIDE_GATEWAY_SERVER) return undefined
      const server = asRecord(asRecord(doc?.agent_servers)[POOLSIDE_GATEWAY_SERVER])
      const serverEnv = asRecord(server.env)
      return {
        baseUrl: env.POOLSIDE_STANDALONE_BASE_URL ?? serverEnv.POOLSIDE_STANDALONE_BASE_URL,
        apiKey: env.POOLSIDE_API_KEY ?? serverEnv.POOLSIDE_API_KEY,
        model: env.POOLSIDE_STANDALONE_MODEL ?? serverEnv.POOLSIDE_STANDALONE_MODEL,
        path: '/v1/chat/completions'
      }
    }
    case 'grok-build': {
      const doc = parseTomlObject(primaryContent)
      const entry = asRecord(asRecord(doc?.model)[nativeModel])
      return {
        baseUrl: entry.base_url,
        apiKey: entry.api_key,
        model: entry.model,
        path: entry.api_backend === 'responses' ? '/v1/responses' : '/v1/chat/completions'
      }
    }
    case 'pi-acp':
    case 'omp': {
      const slash = nativeModel.indexOf('/')
      if (slash < 1) return undefined
      const providerKey = nativeModel.slice(0, slash)
      const modelId = nativeModel.slice(slash + 1)
      const modelsContent = fileContent(files, presetId === 'pi-acp' ? 'pi-models' : 'omp-models')
      const modelsDoc = presetId === 'pi-acp' ? parseJsonObject(modelsContent) : parseYamlObject(modelsContent)
      const entry = asRecord(asRecord(modelsDoc?.providers)[providerKey])
      const models = Array.isArray(entry.models) ? entry.models : []
      if (!models.some((item) => asRecord(item).id === modelId)) return undefined
      return {
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        model: modelId,
        path: pathForOpenAiOrAnthropic(entry.api)
      }
    }
    case 'claude': {
      const doc = parseJsonObject(primaryContent)
      const envObj = asRecord(doc?.env)
      return {
        baseUrl: envObj.ANTHROPIC_BASE_URL,
        apiKey: envObj.ANTHROPIC_AUTH_TOKEN ?? envObj.ANTHROPIC_API_KEY,
        model: nativeModel,
        path: '/v1/messages'
      }
    }
    case 'codex': {
      const doc = parseTomlObject(primaryContent)
      const authDoc = parseJsonObject(fileContent(files, 'codex-auth'))
      const providerKey = typeof doc?.model_provider === 'string' ? doc.model_provider : ''
      const provider = asRecord(asRecord(doc?.model_providers)[providerKey])
      return {
        baseUrl: provider.base_url,
        apiKey: authDoc?.OPENAI_API_KEY,
        model: doc?.model,
        path: provider.wire_api === 'chat' ? '/v1/chat/completions' : '/v1/responses'
      }
    }
    case 'qwen': {
      const doc = parseJsonObject(primaryContent)
      const rawList = asRecord(doc?.modelProviders).openai
      const list = Array.isArray(rawList) ? rawList : []
      const entry = asRecord(list.find((item) => asRecord(item).id === nativeModel))
      const envKey = typeof entry.envKey === 'string' ? entry.envKey : ''
      return {
        baseUrl: entry.baseUrl,
        apiKey: envKey ? asRecord(doc?.env)[envKey] : undefined,
        model: entry.id,
        path: '/v1/chat/completions'
      }
    }
    case 'kimi': {
      const doc = parseTomlObject(primaryContent)
      const modelEntry = asRecord(asRecord(doc?.models)[nativeModel])
      const providerKey = typeof modelEntry.provider === 'string' ? modelEntry.provider : ''
      const provider = asRecord(asRecord(doc?.providers)[providerKey])
      return {
        baseUrl: provider.base_url,
        apiKey: provider.api_key,
        model: modelEntry.model,
        path: '/v1/chat/completions'
      }
    }
    case 'hermes': {
      const doc = parseYamlObject(primaryContent)
      const modelObj = asRecord(doc?.model)
      const envVars = parseDotenv(fileContent(files, 'hermes-env') ?? '')
      return {
        baseUrl: modelObj.base_url,
        apiKey: envVars.CHERRY_HERMES_API_KEY,
        model: modelObj.default,
        path: pathForOpenAiOrAnthropic(modelObj.api_mode)
      }
    }
    case 'minimax': {
      const doc = parseYamlObject(primaryContent)
      const match = /^custom_provider:([^/]+)\/(.+)$/.exec(nativeModel)
      if (!match) return undefined
      const provider = asRecord(asRecord(doc?.custom_provider)[match[1]])
      const options = asRecord(provider.options)
      return {
        baseUrl: options.baseURL,
        apiKey: options.apiKey,
        model: match[2],
        path: paths[String(provider.npm ?? '')] ?? '/v1/chat/completions'
      }
    }
    case 'codebuddy-code': {
      const modelsDoc = parseJsonObject(fileContent(files, 'codebuddy-models'))
      const list = Array.isArray(modelsDoc?.models) ? modelsDoc.models : []
      const entry = asRecord(list.find((item) => asRecord(item).id === nativeModel))
      return {
        baseUrl: typeof entry.url === 'string' ? entry.url.replace(/\/chat\/completions\/?$/, '') : undefined,
        apiKey: entry.apiKey,
        model: entry.id,
        path: entry.api === 'openai-responses' ? '/v1/responses' : '/v1/chat/completions'
      }
    }
    case 'copilot': {
      const slash = nativeModel.indexOf('/')
      if (slash < 1) return undefined
      const providerName = nativeModel.slice(0, slash)
      const modelId = nativeModel.slice(slash + 1)
      const providersDoc = parseJsonObject(fileContent(files, 'copilot-providers'))
      const list = Array.isArray(providersDoc?.providers) ? providersDoc.providers : []
      const provider = asRecord(list.find((item) => asRecord(item).name === providerName))
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: modelId,
        path:
          provider.type === 'anthropic'
            ? '/v1/messages'
            : provider.wireApi === 'responses'
              ? '/v1/responses'
              : '/v1/chat/completions'
      }
    }
    case 'factory-droid': {
      const doc = parseJsonObject(primaryContent)
      const modelId = nativeModel.startsWith('custom:') ? nativeModel.slice('custom:'.length) : nativeModel
      const list = Array.isArray(doc?.customModels) ? doc.customModels : []
      const entry = asRecord(list.find((item) => asRecord(item).model === modelId))
      return {
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        model: entry.model,
        path:
          entry.provider === 'anthropic'
            ? '/v1/messages'
            : entry.provider === 'openai'
              ? '/v1/responses'
              : '/v1/chat/completions'
      }
    }
    case 'mistral-vibe': {
      const doc = parseTomlObject(primaryContent)
      const providers = Array.isArray(doc?.providers) ? doc.providers : []
      const models = Array.isArray(doc?.models) ? doc.models : []
      const provider = asRecord(providers.find((item) => asRecord(item).name === nativeModel))
      const modelEntry = asRecord(
        models.find((item) => {
          const record = asRecord(item)
          return record.alias === nativeModel || record.provider === nativeModel
        })
      )
      const envVar = typeof provider.api_key_env_var === 'string' ? provider.api_key_env_var : 'CHERRY_VIBE_API_KEY'
      const envVars = parseDotenv(fileContent(files, 'vibe-env') ?? '')
      return {
        baseUrl: provider.api_base,
        apiKey: envVars[envVar],
        model: modelEntry.name,
        path: pathForOpenAiOrAnthropic(provider.api_style)
      }
    }
    case 'goose': {
      const doc = parseYamlObject(primaryContent)
      const isAnthropic = doc?.GOOSE_PROVIDER === 'anthropic'
      return {
        baseUrl: isAnthropic ? doc?.ANTHROPIC_HOST : doc?.OPENAI_HOST,
        apiKey: isAnthropic ? doc?.ANTHROPIC_API_KEY : doc?.OPENAI_API_KEY,
        model: doc?.GOOSE_MODEL,
        path: isAnthropic ? '/v1/messages' : '/v1/chat/completions'
      }
    }
    case 'cline':
    case 'zcode':
    case 'snow':
    case 'glm-acp-agent': {
      const primaryDoc = parseJsonObject(primaryContent)
      const providersTarget: CliConfigTarget =
        presetId === 'cline' ? 'cline-providers' : presetId === 'zcode' ? 'zcode-providers' : nativeTarget
      const providersDoc =
        providersTarget === nativeTarget ? primaryDoc : parseJsonObject(fileContent(files, providersTarget))
      const providerKey = typeof primaryDoc?.provider === 'string' ? primaryDoc.provider : ''
      const entry = asRecord(asRecord(providersDoc?.providers)[providerKey])
      return {
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        model: entry.model,
        path: pathForOpenAiOrAnthropic(entry.api)
      }
    }
    default:
      return undefined
  }
}

async function bindOpenCodeOrKilo(
  presetId: 'opencode' | 'kilo',
  nativeModel: string,
  wireModel: string,
  sessionId: string,
  env: NodeJS.ProcessEnv
): Promise<{ dispose: () => void } | undefined> {
  const key = presetId === 'opencode' ? 'OPENCODE_CONFIG_CONTENT' : 'KILO_CONFIG_CONTENT'
  const target = presetId === 'opencode' ? 'opencode-config' : 'kilo-config'
  const [file] = await application.get('CodeCliService').readConfigFiles([target])
  const errors: ParseError[] = []
  const saved = parse(file.content ?? '{}', errors)
  const overrides = parse(env[key] ?? '{}', errors)
  if (
    errors.length ||
    !saved ||
    typeof saved !== 'object' ||
    Array.isArray(saved) ||
    !overrides ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides)
  )
    return
  if (overrides.model && overrides.model !== nativeModel) return
  const separator = nativeModel.indexOf('/')
  if (separator < 1 || saved.model !== nativeModel) return
  const providerKey = nativeModel.slice(0, separator)
  const wireName = nativeModel.slice(separator + 1)
  if (wireName !== wireModel) return
  const provider = { ...saved.provider?.[providerKey], ...overrides.provider?.[providerKey] }
  const options = { ...saved.provider?.[providerKey]?.options, ...overrides.provider?.[providerKey]?.options }
  const modelOptions = provider.models?.[wireName]?.options
  if (modelOptions?.baseURL || modelOptions?.apiKey) return
  if (Object.keys(options.headers ?? {}).some((header) => /^(authorization|x-api-key)$/i.test(header))) return
  const gateway = application.get('ApiGatewayService')
  const current = gateway.getCurrentConfig()
  const baseUrl = typeof options.baseURL === 'string' ? URL.parse(options.baseURL) : null
  if (
    !baseUrl ||
    baseUrl.origin !== gatewayClientOrigin(current.host, current.port) ||
    options.apiKey !== current.apiKey
  )
    return
  const path = paths[provider.npm]
  if (!path) return
  const lease = await gateway.createScopedCredential({ path, model: wireModel, agentSessionId: sessionId })
  env[key] = JSON.stringify({
    ...overrides,
    provider: {
      ...overrides.provider,
      [providerKey]: {
        ...provider,
        options: { ...options, apiKey: lease.apiKey, baseURL: `${lease.baseUrl}/v1` }
      }
    }
  })
  return lease
}

/** Bind only the saved Cherry gateway route; unrelated native configuration stays CLI-owned. */
export async function bindLocalGatewayUsage(
  config: LocalAgentConfiguration,
  sessionId: string,
  env: NodeJS.ProcessEnv
): Promise<{ dispose: () => void } | undefined> {
  if (!config.sourceModelViaGateway || !config.sourceModelId || !config.nativeModel || !config.presetId) return
  const native = LOCAL_AGENT_MODEL_CONFIG[config.presetId]
  if (!native) return
  const source = parseUniqueModelId(config.sourceModelId)
  // The wire name can differ from Cherry's internal model id.
  const model = modelService.getByKey(source.providerId, source.modelId)
  const wireModel = formatGatewayModelId(source.providerId, model.apiModelId ?? source.modelId)

  if (config.presetId === 'opencode' || config.presetId === 'kilo') {
    return bindOpenCodeOrKilo(config.presetId, config.nativeModel, wireModel, sessionId, env)
  }

  const files = await application.get('CodeCliService').readConfigFiles(getCliConfigTargets(native.tool))
  const primary = files.find((file) => file.target === native.target) ?? files[0]
  if (!primary?.content) return

  let savedNativeModel: string | undefined
  try {
    savedNativeModel = readNativeModelConfig(native.target, primary.content)
  } catch {
    return
  }
  if (savedNativeModel !== config.nativeModel) return

  const route = extractGatewayRoute(config.presetId, native.target, config.nativeModel, primary.content, files, env)
  if (!route?.path || route.model !== wireModel || typeof route.baseUrl !== 'string') return

  const gateway = application.get('ApiGatewayService')
  const current = gateway.getCurrentConfig()
  const baseUrl = URL.parse(route.baseUrl)
  if (
    !baseUrl ||
    baseUrl.origin !== gatewayClientOrigin(current.host, current.port) ||
    !current.apiKey ||
    route.apiKey !== current.apiKey
  ) {
    return
  }

  const lease = await gateway.createScopedCredential({ path: route.path, model: wireModel, agentSessionId: sessionId })
  if (config.presetId === 'poolside') {
    env.POOLSIDE_API_KEY = lease.apiKey
    env.POOLSIDE_STANDALONE_BASE_URL = `${lease.baseUrl}/v1`
  }
  return lease
}
