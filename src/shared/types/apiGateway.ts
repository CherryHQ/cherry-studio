import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'

export type ApiGatewayConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string | null
}

/** Result of an API-gateway start/stop/restart IPC call. */
export type ApiGatewayStatusResult = { success: true } | { success: false; error: string }

/**
 * Build the gateway-addressable model id the gateway routes expect: `providerId:apiModelId`
 * (single colon, `apiModelId` — NOT the `::`-separated internal `UniqueModelId`). The gateway
 * splits on the first `:` (see `apiGateway/proxyStream.ts`) and advertises the same shape from
 * `/v1/models` (see `apiGateway/utils/models.ts`), so both the CLI-config writer and the in-app
 * Claude Code runtime must format ids identically. CherryAI managed default models are not
 * routable through the gateway and throw, mirroring the gateway's own guard.
 */
export function formatGatewayModelId(providerId: string, apiModelId: string): string {
  // The single-colon format cannot round-trip a provider id that itself contains ':' —
  // the gateway would split "corp:west:model" at the first ':' and route to "corp".
  // Fail loudly rather than emit an address that silently targets the wrong provider.
  if (providerId.includes(':')) {
    throw new Error(`Provider id "${providerId}" contains ":" and cannot be addressed through the API gateway`)
  }
  if (isManagedCherryAiDefaultModel(providerId, apiModelId)) {
    throw new Error('CherryAI managed default model is not available through the API gateway')
  }
  return `${providerId}:${apiModelId}`
}
