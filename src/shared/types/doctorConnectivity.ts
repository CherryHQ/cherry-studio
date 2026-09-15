import type { UniqueModelId } from '../data/types/model'
import type { DoctorCheckId, DoctorExecutionSnapshot, DoctorScopeKey, DoctorSubjectRef } from './doctor'

export type DoctorConnectivitySubject = Exclude<DoctorSubjectRef, { kind: 'global' }>

export const DOCTOR_CONNECTIVITY_CHECK_IDS = [
  'network-model-endpoint',
  'provider-model-list',
  'provider-model-conversation'
] as const satisfies readonly DoctorCheckId[]

export interface ModelConnectivityReport extends DoctorExecutionSnapshot {
  readonly uniqueModelId: UniqueModelId
  readonly expiresAt: string
}

export type DoctorConnectivityResult =
  | { readonly status: 'busy' | 'canceled'; readonly runId: string }
  | {
      readonly status: 'completed'
      readonly runId: string
      readonly scope: DoctorScopeKey
      readonly report: ModelConnectivityReport
    }
