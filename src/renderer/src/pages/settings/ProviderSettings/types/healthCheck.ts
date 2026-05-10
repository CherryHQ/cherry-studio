import type { SerializedError } from '@renderer/types/error'
import { HealthStatus } from '@renderer/types/healthCheck'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export { HealthStatus }

export interface ApiKeyConnectivity {
  status: HealthStatus
  checking?: boolean
  error?: SerializedError
  model?: Model
  latency?: number
}

export interface ApiKeyWithStatus extends ApiKeyConnectivity {
  key: string
}

export interface ModelWithStatus {
  model: Model
  status: HealthStatus
  keyResults: ApiKeyWithStatus[]
  checking?: boolean
  latency?: number
  error?: string
}

export interface ModelCheckOptions {
  provider: Provider
  models: Model[]
  apiKeys: string[]
  isConcurrent: boolean
  timeout?: number
}
