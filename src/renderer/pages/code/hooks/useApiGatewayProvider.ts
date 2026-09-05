import { preferenceService } from '@data/PreferenceService'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { DEFAULT_PROVIDER_SETTINGS, type Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID } from '@shared/types/codeCli'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_GATEWAY_HOST = '127.0.0.1'
const DEFAULT_GATEWAY_PORT = 23333

/**
 * The synthetic "Cherry Gateway" entry for the code-CLI provider list, plus the
 * live gateway credential and a lifecycle action. The `provider` flows through the
 * normal provider pipeline (card / model picker / config write), so its
 * `endpointConfigs` point at the local gateway and its `apiKeys` carry a runtime
 * placeholder (the secret lives on `apiKey`, since `Provider.apiKeys` omits key
 * values by schema).
 */
export interface ApiGatewayProviderBundle {
  provider: Provider
  /** Current persisted gateway key; `null` before the gateway has ever started (main generates it lazily). */
  apiKey: string | null
  /** Start the gateway if needed and confirm it is running. */
  ensureRunning: () => Promise<Provider>
  /** Read the persisted key for a CLI config-file write. */
  getApiKey: () => Promise<string>
}

/**
 * Build the synthetic Cherry Gateway provider from the API-gateway preference
 * config. Returns `null` only when host/port are unavailable (never, given the
 * shipped defaults) so the gateway card is always offered for gateway-capable
 * tools. The provider is rebuilt whenever host/port/key change.
 */
export function useApiGatewayProvider(): ApiGatewayProviderBundle | null {
  const { t } = useTranslation()
  const { apiGatewayConfig, apiGatewayRunning, getApiGatewayRuntimeAddress, startApiGateway } = useApiGateway()
  const host = apiGatewayConfig.host || DEFAULT_GATEWAY_HOST
  const port = apiGatewayConfig.port || DEFAULT_GATEWAY_PORT
  const apiKey = apiGatewayConfig.apiKey

  const provider = useMemo(() => createApiGatewayProvider(t('code.api_gateway.title'), host, port), [host, port, t])

  const ensureRunning = useCallback(async (): Promise<Provider> => {
    // Main owns the actual listener address. Renderer preferences are desired config and may lag a
    // fallback bind; querying an already-running gateway also preserves a temporary lease's intent.
    const address = apiGatewayRunning ? await getApiGatewayRuntimeAddress() : await startApiGateway()
    if (!address) throw new Error('API gateway failed to start')
    return createApiGatewayProvider(t('code.api_gateway.title'), address.host, address.port)
  }, [apiGatewayRunning, getApiGatewayRuntimeAddress, startApiGateway, t])

  const getApiKey = useCallback(async (): Promise<string> => {
    const key = await preferenceService.get('feature.api_gateway.api_key')
    if (!key) {
      throw new Error('API gateway did not provide a key')
    }
    return key
  }, [])

  return useMemo(() => ({ provider, apiKey, ensureRunning, getApiKey }), [provider, apiKey, ensureRunning, getApiKey])
}

function createApiGatewayProvider(name: string, host: string, port: number): Provider {
  const baseUrl = gatewayClientOrigin(host, port)
  return {
    id: CLI_API_GATEWAY_PROVIDER_ID,
    name,
    endpointConfigs: {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl },
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl }
    },
    apiKeys: [{ id: 'gateway', isEnabled: true }],
    authType: 'api-key',
    reportsActualCost: false,
    settings: DEFAULT_PROVIDER_SETTINGS,
    isEnabled: true
  }
}
