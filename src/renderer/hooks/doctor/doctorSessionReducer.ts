import type { DoctorAction, DoctorCheckId, DoctorFixRequest, DoctorPanel, DoctorRunTier } from '@shared/types/doctor'

export type DoctorInteraction =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm-evidence'; readonly checkId: DoctorCheckId }
  | { readonly kind: 'fixing'; readonly request: DoctorFixRequest }
  | {
      readonly kind: 'action'
      readonly checkId?: DoctorCheckId
      readonly actionKind: Exclude<DoctorAction['kind'], 'fix' | 'navigate' | 'report'> | 'toggle_dev_tools'
    }
  | { readonly kind: 'run'; readonly tier: DoctorRunTier }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'bundle-operation' }
  | { readonly kind: 'report-operation' }

export interface DoctorSessionState {
  readonly activePanel: DoctorPanel
  readonly descriptionDraft: string
  readonly revealedEvidence: readonly DoctorCheckId[]
  readonly relaunchRequired: boolean
  readonly interaction: DoctorInteraction
}

export type DoctorSessionAction =
  | { readonly type: 'set-panel'; readonly panel: DoctorPanel }
  | { readonly type: 'set-description'; readonly description: string }
  | { readonly type: 'reveal-evidence'; readonly checkId: DoctorCheckId }
  | { readonly type: 'mark-relaunch-required' }
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
    case 'reveal-evidence':
      return state.revealedEvidence.includes(action.checkId)
        ? state
        : { ...state, revealedEvidence: [...state.revealedEvidence, action.checkId] }
    case 'mark-relaunch-required':
      return { ...state, relaunchRequired: true }
    case 'confirm-evidence':
      return { ...state, interaction: { kind: 'confirm-evidence', checkId: action.checkId } }
    case 'cancel-confirmation':
      return state.interaction.kind === 'confirm-evidence' ? { ...state, interaction: { kind: 'idle' } } : state
    case 'start-interaction':
      return { ...state, interaction: action.interaction }
    case 'finish-interaction':
      return state.interaction.kind === action.kind ? { ...state, interaction: { kind: 'idle' } } : state
  }
}
