import type { SerializedError } from '@renderer/types/error'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'

export enum HealthStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  NOT_CHECKED = 'not_checked'
}

export type ModelCheckKeySelection = { mode: 'all' } | { mode: 'single'; keyId: string }

export interface ModelCheckCredentialPolicy {
  canSelectApiKey: boolean
  requiresApiKey: boolean
}

export type ModelCheckCredential =
  | { kind: 'api-key'; entry: ApiKeyEntry }
  | { kind: 'provider-auth'; id: 'provider-auth'; key: '' }

export type ApiKeyConnectivity =
  | {
      kind: 'failed'
      status: HealthStatus.FAILED
      checking: false
      error: SerializedError
      latency?: never
    }
  | {
      kind: 'ok'
      status: HealthStatus.SUCCESS
      checking: false
      error?: never
      latency?: number
    }

export type ApiKeyWithStatus = ApiKeyConnectivity & {
  credential: ModelCheckCredential
}

export type ModelHealthCheckGenerationOutput = 'image' | 'video' | 'audio'

export type ModelHealthCheckSkipReason =
  | {
      kind: 'generation_cost'
      output: ModelHealthCheckGenerationOutput
    }
  | {
      kind: 'unsupported_probe'
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
  | {
      kind: 'skipped'
      model: Model
      status: HealthStatus.NOT_CHECKED
      keyResults: []
      checking: false
      latency?: never
      error?: never
      skipReason: ModelHealthCheckSkipReason
    }

export interface ModelCheckOptions {
  models: readonly Model[]
  credentials: ModelCheckCredential[]
  isConcurrent: boolean
  timeout?: number
  signal?: AbortSignal
}
