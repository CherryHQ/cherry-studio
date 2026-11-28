import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { DEFAULT_PROVIDER_SETTINGS, type Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID } from '@shared/types/codeCli'

/** The synthetic provider a CLI config addresses to reach Cherry's gateway at `baseUrl`. */
export function createCliGatewayProvider(baseUrl: string, name: string): Provider {
  return {
    id: CLI_API_GATEWAY_PROVIDER_ID,
    // Display-only; the CLI provider key is decoupled from this title (see cliProviderKeyName).
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
