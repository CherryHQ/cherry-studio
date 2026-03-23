/**
 * Gateway endpoint types that can be enabled/disabled
 */
export type GatewayEndpoint = '/v1/chat/completions' | '/v1/messages' | '/v1/responses'

/**
 * Model group - represents a unique endpoint with a specific provider/model combination
 * Each group gets a unique URL path like: http://localhost:23333/{groupId}/v1/...
 */
export type ModelGroup = {
  id: string // unique identifier, used as URL path segment (e.g. "abc123")
  name: string // display name
  providerId: string
  modelId: string
  mode?: 'model' | 'assistant'
  assistantId?: string
  createdAt: number
}

/**
 * API Gateway configuration
 */
export type ApiGatewayConfig = {
  // Basic settings
  enabled: boolean
  host: string
  port: number
  apiKey: string

  // Gateway settings
  modelGroups: ModelGroup[]
  enabledEndpoints: GatewayEndpoint[]
  exposeToNetwork: boolean // true = 0.0.0.0, false = 127.0.0.1
}

export type GetApiGatewayStatusResult = {
  running: boolean
  config: ApiGatewayConfig | null
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
