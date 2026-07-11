import { preferenceService } from '@data/PreferenceService'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS, type Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID } from '@shared/types/codeCli'
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
  /** Start the gateway if needed (generating the key on first start) and resolve the freshest key. */
  ensureReady: () => Promise<string>
}

/**
 * Build the synthetic Cherry Gateway provider from the API-gateway preference
 * config. Returns `null` only when host/port are unavailable (never, given the
 * shipped defaults) so the gateway card is always offered for gateway-capable
 * tools. The provider is rebuilt whenever host/port/key change.
 */
export function useApiGatewayProvider(): ApiGatewayProviderBundle | null {
  const { t } = useTranslation()
  const { apiGatewayConfig, apiGatewayRunning, startApiGateway, setApiGatewayEnabled } = useApiGateway()
  const host = apiGatewayConfig.host || DEFAULT_GATEWAY_HOST
  const port = apiGatewayConfig.port || DEFAULT_GATEWAY_PORT
  const apiKey = apiGatewayConfig.apiKey

  const ensureReady = useCallback(async (): Promise<string> => {
    // Starting the gateway makes main generate + persist the key on first activation;
    // read it back imperatively so the caller gets the fresh value (React state in this
    // async closure is still the pre-start key).
    if (!apiGatewayRunning) {
      await startApiGateway()
    } else if (!apiGatewayConfig.enabled) {
      setApiGatewayEnabled(true)
    }
    const key = await preferenceService.get('feature.api_gateway.api_key')
    if (!key) {
      throw new Error('API gateway did not provide a key')
    }
    return key
  }, [apiGatewayRunning, apiGatewayConfig.enabled, startApiGateway, setApiGatewayEnabled])

  return useMemo(() => {
    const baseUrl = `http://${host}:${port}`
    const provider: Provider = {
      id: CLI_API_GATEWAY_PROVIDER_ID,
      // Keep the brand token ASCII so codex/kimi provider-key sanitization stays valid across locales.
      name: t('code.api_gateway.title'),
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl }
      },
      apiKeys: [{ id: 'gateway', isEnabled: true }],
      authType: 'api-key',
      apiFeatures: DEFAULT_API_FEATURES,
      settings: DEFAULT_PROVIDER_SETTINGS,
      isEnabled: true
    }
    return { provider, apiKey, ensureReady }
  }, [host, port, apiKey, t, ensureReady])
}
