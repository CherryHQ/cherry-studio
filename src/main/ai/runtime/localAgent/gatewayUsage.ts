import { parse, type ParseError } from 'jsonc-parser'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'

const paths: Record<string, string> = {
  '@ai-sdk/openai-compatible': '/v1/chat/completions',
  '@ai-sdk/openai': '/v1/responses',
  '@ai-sdk/anthropic': '/v1/messages'
}

/** Bind only the saved Cherry gateway route; unrelated native configuration stays CLI-owned. */
export async function bindLocalGatewayUsage(
  config: LocalAgentConfiguration,
  sessionId: string,
  env: NodeJS.ProcessEnv
): Promise<{ dispose: () => void } | undefined> {
  if (!config.sourceModelViaGateway || !config.sourceModelId || !config.nativeModel) return
  if (config.presetId !== 'opencode' && config.presetId !== 'kilo') return
  const key = config.presetId === 'opencode' ? 'OPENCODE_CONFIG_CONTENT' : 'KILO_CONFIG_CONTENT'
  const target = config.presetId === 'opencode' ? 'opencode-config' : 'kilo-config'
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
  if (overrides.model && overrides.model !== config.nativeModel) return
  const separator = config.nativeModel.indexOf('/')
  if (separator < 1 || saved.model !== config.nativeModel) return
  const providerKey = config.nativeModel.slice(0, separator)
  const wireModel = config.nativeModel.slice(separator + 1)
  const provider = { ...saved.provider?.[providerKey], ...overrides.provider?.[providerKey] }
  const options = { ...saved.provider?.[providerKey]?.options, ...overrides.provider?.[providerKey]?.options }
  const modelOptions = provider.models?.[wireModel]?.options
  if (modelOptions?.baseURL || modelOptions?.apiKey) return
  if (Object.keys(options.headers ?? {}).some((key) => /^(authorization|x-api-key)$/i.test(key))) return
  const source = parseUniqueModelId(config.sourceModelId)
  // The wire name can differ from Cherry's internal model id.
  const model = modelService.getByKey(source.providerId, source.modelId)
  if (wireModel !== formatGatewayModelId(source.providerId, model.apiModelId ?? source.modelId)) return
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
