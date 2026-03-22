export interface OpenAICodexConfigParams {
  providerId: string
  providerName?: string
  baseUrl?: string
  model: string
}

const OPENAI_CODEX_BUILT_IN_PROVIDER_CONFIG_KEYS: Record<string, string> = {
  openai: 'openai_base_url'
}

const quoteCliValue = (value: string) => JSON.stringify(value)

export const buildOpenAICodexConfigParams = ({
  providerId,
  providerName,
  baseUrl,
  model
}: OpenAICodexConfigParams): string => {
  const normalizedBaseUrl = baseUrl?.replace(/\/$/, '') ?? ''
  const configParams = [`--config model_provider=${quoteCliValue(providerId)}`]
  const builtInBaseUrlConfigKey = OPENAI_CODEX_BUILT_IN_PROVIDER_CONFIG_KEYS[providerId]

  if (builtInBaseUrlConfigKey) {
    configParams.push(`--config ${builtInBaseUrlConfigKey}=${quoteCliValue(normalizedBaseUrl)}`)
  } else {
    configParams.push(`--config model_providers.${providerId}.name=${quoteCliValue(providerName || providerId)}`)
    configParams.push(`--config model_providers.${providerId}.base_url=${quoteCliValue(normalizedBaseUrl)}`)
    configParams.push('--config model_providers.' + providerId + '.env_key="OPENAI_API_KEY"')
    configParams.push('--config model_providers.' + providerId + '.wire_api="responses"')
  }

  configParams.push(`--config model=${quoteCliValue(model)}`)

  return configParams.join(' ')
}
