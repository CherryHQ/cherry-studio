export type ApiGatewayConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}

export type StartApiGatewayStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type RestartApiGatewayStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type StopApiGatewayStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }
