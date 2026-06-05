// Redux config type — stays `apiServer` (redux/v2 layer being deprecated)
export type ApiServerConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}

// IPC result types — renamed to `apiGateway` (non-redux, survives v2 deprecation)
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
