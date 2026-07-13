export type ApiGatewayConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string | null
}

/** Result of an API-gateway start/stop/restart IPC call. */
export type ApiGatewayStatusResult = { success: true } | { success: false; error: string }
