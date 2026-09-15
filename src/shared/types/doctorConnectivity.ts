import type { UniqueModelId } from '../data/types/model'
import type { ErrorCategory } from '../utils/errorCategory'
import type { DoctorScopeKey, DoctorSubjectRef } from './doctor'

export type DoctorConnectivitySubject = Exclude<DoctorSubjectRef, { kind: 'global' }>

export type ConnectivityProbeOutcome =
  | { readonly status: 'pass'; readonly httpStatus?: number }
  | { readonly status: 'warn'; readonly reason: 'model_not_listed' }
  | {
      readonly status: 'skip'
      readonly reason: 'no_base_url' | 'model_list_unsupported' | 'model_list_endpoint_unavailable' | 'not_chat_model'
    }
  | {
      readonly status: 'fail'
      readonly reason: ErrorCategory
      readonly httpStatus?: number
    }

export type ConnectivityProbeResult = (
  | ConnectivityProbeOutcome
  | { readonly status: 'error'; readonly message: string }
) & {
  readonly durationMs: number
}

export interface ModelConnectivityReport {
  readonly uniqueModelId: UniqueModelId
  readonly baseUrl: ConnectivityProbeResult
  readonly modelList: ConnectivityProbeResult
  readonly conversation: ConnectivityProbeResult
}

export type DoctorConnectivityResult =
  | { readonly status: 'busy' | 'canceled'; readonly runId: string }
  | {
      readonly status: 'completed'
      readonly runId: string
      readonly scope: DoctorScopeKey
      readonly report: ModelConnectivityReport
    }
