import { acpConfigRecord, jsonModelField, type AcpGatewayOverlay } from '@cherrystudio/agent-runtime-acp/profile'

export const openCodeModelProfile = jsonModelField('opencode-config', 'model')
export const kiloModelProfile = jsonModelField('kilo-config', 'model')

const paths: Readonly<Record<string, string>> = {
  '@ai-sdk/openai-compatible': '/v1/chat/completions',
  '@ai-sdk/openai': '/v1/responses',
  '@ai-sdk/anthropic': '/v1/messages'
}

function readGatewayOverlay(saved: Record<string, unknown>, overrides: Record<string, unknown>, model: string) {
  if ((overrides.model && overrides.model !== model) || saved.model !== model) return undefined
  const slash = model.indexOf('/')
  if (slash < 1) return undefined
  const providerKey = model.slice(0, slash)
  const modelId = model.slice(slash + 1)
  const savedProvider = acpConfigRecord(acpConfigRecord(saved.provider)?.[providerKey])
  const overrideProviders = acpConfigRecord(overrides.provider)
  const overrideProvider = acpConfigRecord(overrideProviders?.[providerKey])
  const provider = { ...savedProvider, ...overrideProvider }
  const options = { ...acpConfigRecord(savedProvider?.options), ...acpConfigRecord(overrideProvider?.options) }
  const modelConfig = acpConfigRecord(acpConfigRecord(provider.models)?.[modelId])
  const modelOptions = acpConfigRecord(modelConfig?.options)
  if (modelOptions?.baseURL || modelOptions?.apiKey) return undefined
  if (Object.keys(acpConfigRecord(options.headers) ?? {}).some((key) => /^(authorization|x-api-key)$/i.test(key)))
    return undefined
  const path = typeof provider.npm === 'string' && Object.hasOwn(paths, provider.npm) ? paths[provider.npm] : undefined
  if (!path) return undefined
  return {
    baseUrl: options.baseURL,
    apiKey: options.apiKey,
    model: modelId,
    path,
    bind({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
      return JSON.stringify({
        ...overrides,
        provider: {
          ...overrideProviders,
          [providerKey]: { ...provider, options: { ...options, apiKey, baseURL: `${baseUrl}/v1` } }
        }
      })
    }
  }
}

export const openCodeGatewayOverlay = {
  target: openCodeModelProfile.target,
  envKey: 'OPENCODE_CONFIG_CONTENT',
  read: readGatewayOverlay
} satisfies AcpGatewayOverlay<'opencode-config'>

export const kiloGatewayOverlay = {
  target: kiloModelProfile.target,
  envKey: 'KILO_CONFIG_CONTENT',
  read: readGatewayOverlay
} satisfies AcpGatewayOverlay<'kilo-config'>
