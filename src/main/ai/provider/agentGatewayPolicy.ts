import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'

/** Whether Agent traffic for this provider must pass through Cherry's local API Gateway. */
export function requiresAgentGateway(providerId: string): boolean {
  return providerId === CHERRY_CLOUD_PROVIDER_ID
}
