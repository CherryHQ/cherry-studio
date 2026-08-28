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
  ensureRunning: () => Promise<void>
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
  const { apiGatewayConfig, apiGatewayRunning, startApiGateway } = useApiGateway()
  const host = apiGatewayConfig.host || DEFAULT_GATEWAY_HOST
  const port = apiGatewayConfig.port || DEFAULT_GATEWAY_PORT
  const apiKey = apiGatewayConfig.apiKey

  const ensureRunning = useCallback(async (): Promise<void> => {
    if (!apiGatewayRunning) {
      // Main persists the key in `onActivate` BEFORE the server binds, and it survives a stop — so a
      // key can exist while nothing is listening. Only proceed when the start actually confirmed the
      // server is running; otherwise the caller must not write the CLI config or mark the gateway
      // current against a dead port. `startApiGateway` returns false on failure (it never rejects).
      const started = await startApiGateway()
      if (!started) {
        throw new Error('API gateway failed to start')
      }
    }
  }, [apiGatewayRunning, startApiGateway])

  const getApiKey = useCallback(async (): Promise<string> => {
    const key = await preferenceService.get('feature.api_gateway.api_key')
    if (!key) {
      throw new Error('API gateway did not provide a key')
    }
    return key
  }, [])

  return useMemo(() => {
    const baseUrl = gatewayClientOrigin(host, port)
    const provider: Provider = {
      id: CLI_API_GATEWAY_PROVIDER_ID,
      // Display-only; the CLI provider key is decoupled from this title (see cliProviderKeyName).
      name: t('code.api_gateway.title'),
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
    return { provider, apiKey, ensureRunning, getApiKey }
  }, [host, port, apiKey, t, ensureRunning, getApiKey])
}
