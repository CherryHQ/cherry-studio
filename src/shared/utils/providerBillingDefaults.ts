import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ProviderBilling } from '@shared/data/types/providerBilling'

const deepseekModels = ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']

/** Only first-party catalog prices inherit the official schedule. */
export function getDefaultProviderBilling(
  provider: Provider,
  model: Model,
  baseUrl?: string
): ProviderBilling | undefined {
  if ((provider.presetProviderId ?? provider.id) !== 'deepseek' || model.hasCustomPricing) return undefined
  const modelId = model.apiModelId ?? model.id.slice(model.id.indexOf('::') + 2)
  if (!deepseekModels.includes(modelId)) return undefined
  const endpoints: Array<EndpointType | undefined> = [
    model.endpointTypes?.[0],
    provider.defaultChatEndpoint,
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    ENDPOINT_TYPE.OPENAI_RESPONSES,
    ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
    ENDPOINT_TYPE.OLLAMA_CHAT
  ]
  const url =
    baseUrl ??
    endpoints.map((endpoint) => (endpoint ? provider.endpointConfigs?.[endpoint]?.baseUrl : undefined)).find(Boolean) ??
    Object.values(provider.endpointConfigs ?? {}).find((config) => config?.baseUrl)?.baseUrl
  try {
    const parsed = new URL(url ?? '')
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.deepseek.com' || parsed.port) return undefined
  } catch {
    return undefined
  }
  return {
    defaultMultiplier: 0.5,
    scheduleEnabled: true,
    timeZone: '+08:00',
    calendar: 'cn-weekdays',
    source: 'deepseek',
    periods: [
      { id: 'morning', name: '09:00–12:00', start: '09:00', end: '12:00', mode: 'multiplier', multiplier: 1 },
      { id: 'afternoon', name: '14:00–18:00', start: '14:00', end: '18:00', mode: 'multiplier', multiplier: 1 }
    ]
  }
}
