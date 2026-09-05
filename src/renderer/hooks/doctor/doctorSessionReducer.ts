import type { DisplayedDoctorDomain } from '@renderer/utils/doctor'
import type { DoctorAction, DoctorCheckId, DoctorFixRequest, DoctorRunTier } from '@shared/types/doctor'

export type DoctorPanel = 'checks' | 'export' | 'report'

export type DoctorInteraction =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm-fix'; readonly request: DoctorFixRequest }
  | { readonly kind: 'confirm-evidence'; readonly checkId: DoctorCheckId }
  | { readonly kind: 'fixing'; readonly request: DoctorFixRequest }
  | {
      readonly kind: 'action'
      readonly checkId?: DoctorCheckId
      readonly actionKind:
        | Exclude<DoctorAction['kind'], 'fix' | 'navigate' | 'install_update' | 'report'>
        | 'toggle_dev_tools'
    }
  | { readonly kind: 'run'; readonly tier: DoctorRunTier; readonly pendingUntil: number }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'bundle-operation' }
  | { readonly kind: 'report-operation' }

export interface DoctorSessionState {
  readonly activePanel: DoctorPanel
  readonly descriptionDraft: string
  readonly expandedDomains: readonly DisplayedDoctorDomain[]
  readonly revealedEvidence: readonly DoctorCheckId[]
  readonly relaunchRequired: boolean
  readonly interaction: DoctorInteraction
}

export type DoctorSessionAction =
  | { readonly type: 'set-panel'; readonly panel: DoctorPanel }
  | { readonly type: 'set-description'; readonly description: string }
  | { readonly type: 'set-expanded-domains'; readonly domains: readonly DisplayedDoctorDomain[] }
  | { readonly type: 'reveal-evidence'; readonly checkId: DoctorCheckId }
  | { readonly type: 'mark-relaunch-required' }
  | { readonly type: 'confirm-fix'; readonly request: DoctorFixRequest }
  | { readonly type: 'confirm-evidence'; readonly checkId: DoctorCheckId }
  | { readonly type: 'cancel-confirmation' }
  | { readonly type: 'start-interaction'; readonly interaction: Exclude<DoctorInteraction, { kind: 'idle' }> }
  | { readonly type: 'finish-interaction'; readonly kind: DoctorInteraction['kind'] }

export function createDoctorSession({
  initialPanel,
  initialDescription
}: {
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
}): DoctorSessionState {
  return {
    activePanel: initialPanel,
    descriptionDraft: initialDescription ?? '',
    expandedDomains: [],
    revealedEvidence: [],
    relaunchRequired: false,
    interaction: { kind: 'idle' }
  }
}

export function doctorSessionReducer(state: DoctorSessionState, action: DoctorSessionAction): DoctorSessionState {
  switch (action.type) {
    case 'set-panel':
      return { ...state, activePanel: action.panel }
    case 'set-description':
      return { ...state, descriptionDraft: action.description }
    case 'set-expanded-domains':
      return { ...state, expandedDomains: action.domains }
    case 'reveal-evidence':
      return state.revealedEvidence.includes(action.checkId)
        ? state
        : { ...state, revealedEvidence: [...state.revealedEvidence, action.checkId] }
    case 'mark-relaunch-required':
      return { ...state, relaunchRequired: true }
    case 'confirm-fix':
      return { ...state, interaction: { kind: 'confirm-fix', request: action.request } }
    case 'confirm-evidence':
      return { ...state, interaction: { kind: 'confirm-evidence', checkId: action.checkId } }
    case 'cancel-confirmation':
      return state.interaction.kind === 'confirm-fix' || state.interaction.kind === 'confirm-evidence'
        ? { ...state, interaction: { kind: 'idle' } }
        : state
    case 'start-interaction':
      return { ...state, interaction: action.interaction }
    case 'finish-interaction':
      return state.interaction.kind === action.kind ? { ...state, interaction: { kind: 'idle' } } : state
  }
}
