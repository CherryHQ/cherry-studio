export type ApiGatewayConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string | null
}

/** Result of an API-gateway start/restart IPC call. */
export type ApiGatewayStatusResult = { success: true } | { success: false; error: string }

export type ApiGatewayStopOutcome = 'stopped'
export type ApiGatewayStopResult = { success: true; outcome: ApiGatewayStopOutcome } | { success: false; error: string }
