import type { SerializedError } from '@renderer/types/error'
import { HealthStatus } from '@renderer/types/healthCheck'
import type { Model } from '@shared/data/types/model'

export { HealthStatus }

export type ApiKeyConnectivity =
  | {
      kind: 'idle'
      status: HealthStatus.NOT_CHECKED
      checking: false
      error?: never
      model?: Model
      latency?: never
    }
  | {
      kind: 'checking'
      status: HealthStatus.NOT_CHECKED
      checking: true
      error?: never
      model?: Model
      latency?: never
    }
  | {
      kind: 'failed'
      status: HealthStatus.FAILED
      checking: false
      error: SerializedError
      model?: Model
      latency?: never
    }
  | {
      kind: 'ok'
      status: HealthStatus.SUCCESS
      checking: false
      error?: never
      model?: Model
      latency?: number
    }

export type ApiKeyWithStatus = ApiKeyConnectivity & {
  key: string
}

export type ModelWithStatus =
  | {
      kind: 'checking'
      model: Model
      status: HealthStatus.NOT_CHECKED
      keyResults: []
      checking: true
      latency?: never
      error?: never
    }
  | {
      kind: 'idle'
      model: Model
      status: HealthStatus.NOT_CHECKED
      keyResults: []
      checking: false
      latency?: never
      error?: never
    }
  | {
      kind: 'ok'
      model: Model
      status: HealthStatus.SUCCESS
      keyResults: ApiKeyWithStatus[]
      checking: false
      latency?: number
      error?: never
    }
  | {
      kind: 'failed'
      model: Model
      status: HealthStatus.FAILED
      keyResults: ApiKeyWithStatus[]
      checking: false
      latency?: number
      error?: SerializedError
    }

export interface ModelCheckOptions {
  models: Model[]
  apiKeys: string[]
  isConcurrent: boolean
  timeout?: number
  signal?: AbortSignal
}
