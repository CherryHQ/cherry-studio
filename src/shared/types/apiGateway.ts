export type ApiGatewayConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string | null
}

export type ApiGatewayRuntimeAddress = {
  host: string
  port: number
}

/** Result of an API-gateway start/restart IPC call. */
export type ApiGatewayStatusResult =
  | { success: true; address: ApiGatewayRuntimeAddress }
  | { success: false; error: string }

export type ApiGatewayStopOutcome = 'stopped' | 'deferred'
export type ApiGatewayStopResult = { success: true; outcome: ApiGatewayStopOutcome } | { success: false; error: string }

/**
 * `i18nKey` stamped on the error raised when a route needs the gateway the user disabled. Shared
 * so the renderer can recognize the failure on a persisted message, not just render it.
 */
export const API_GATEWAY_REQUIRED_I18N_KEY = 'api_gateway_required'
