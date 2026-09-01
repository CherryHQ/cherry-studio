import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'

export interface ProviderAgentGatewayPolicy {
  authorizeRequest(context: { isInternalAgentRequest: boolean }): boolean
}

const cherryCloudPolicy: ProviderAgentGatewayPolicy = {
  authorizeRequest: ({ isInternalAgentRequest }) => isInternalAgentRequest
}

/** Provider-owned policy for routes that must pass through Cherry's local Agent Gateway. */
export function getProviderAgentGatewayPolicy(providerId: string): ProviderAgentGatewayPolicy | undefined {
  return providerId === CHERRY_CLOUD_PROVIDER_ID ? cherryCloudPolicy : undefined
}
