import { type ConversationInteractionKind, ConversationTurnKind } from '@shared/ai/conversation'
import {
  type ConversationActivityId,
  ConversationActivityKind,
  type ConversationEffectId,
  type ConversationExecutionId,
  ConversationExecutionPhase,
  type ConversationInputId,
  type ConversationInteractionId,
  ConversationInteractionPhase,
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOutcomeKind,
  ConversationPhase,
  type ConversationRef,
  ConversationTerminalDurability,
  type ConversationTurnId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { SerializedError } from '@shared/types/error'

import type { AgentRuntimeRedirectId, AgentRuntimeSegmentId } from '../runtime/types'
import { toAgentRuntimeRedirectId } from '../runtime/types'

export enum ConversationResponderKind {
  Interactive = 'interactive',
  Headless = 'headless'
}

export enum AgentInteractionTurnKind {
  None = 'none',
  Interactive = 'interactive',
  Headless = 'headless'
}

export enum AgentUserResponseMode {
  Unavailable = 'unavailable',
  Stream = 'stream',
  Message = 'message'
}

export enum ConversationInputProvenance {
  Renderer = 'renderer',
  Channel = 'channel',
  Schedule = 'schedule',
  SessionDelivery = 'session-delivery',
  Runtime = 'runtime'
}

export enum ConversationExecutionDriverKind {
  Chat = 'chat',
  Agent = 'agent'
}

export enum ConversationRunMode {
  Foreground = 'foreground',
  Preempting = 'preempting',
  RuntimePreempted = 'runtime-preempted'
}

export enum ConversationPreemptionPhase {
  Suspending = 'suspending',
  AwaitingRuntimeCommit = 'awaiting-runtime-commit'
}

export enum ConversationRuntimeOwnership {
  Active = 'active',
  Released = 'released'
}

export enum ConversationCommandType {
  TurnCommitted = 'turn-committed',
  InputCommitted = 'input-committed',
  InputDropped = 'input-dropped',
  InputRemoved = 'input-removed',
  InboxReordered = 'inbox-reordered',
  StepCommitted = 'step-committed',
  StepFailed = 'step-failed',
  ExecutionsAdded = 'executions-added',
  ExecutionRestarted = 'execution-restarted',
  ExecutionFirstChunk = 'execution-first-chunk',
  ExecutionStartFailed = 'execution-start-failed',
  RedirectQueued = 'redirect-queued',
  RedirectDelivered = 'redirect-delivered',
  RedirectUndelivered = 'redirect-undelivered',
  RedirectRejected = 'redirect-rejected',
  InteractionOpened = 'interaction-opened',
  InteractionCompleted = 'interaction-completed',
  InteractionResolved = 'interaction-resolved',
  InteractionResumeSucceeded = 'interaction-resume-succeeded',
  InteractionResumeFailed = 'interaction-resume-failed',
  ExecutionTerminal = 'execution-terminal',
  PersistenceSucceeded = 'persistence-succeeded',
  PersistenceFailed = 'persistence-failed',
  PersistenceAbandoned = 'persistence-abandoned',
  ActivityOpened = 'activity-opened',
  ActivityClosed = 'activity-closed',
  RuntimePreemptionRequested = 'runtime-preemption-requested',
  RuntimeSuspensionSucceeded = 'runtime-suspension-succeeded',
  RuntimeSuspensionFailed = 'runtime-suspension-failed',
  RuntimeTurnCommitted = 'runtime-turn-committed',
  RuntimeTurnCommitFailed = 'runtime-turn-commit-failed',
  RuntimeOwnershipReleased = 'runtime-ownership-released',
  KickInbox = 'kick-inbox',
  Stop = 'stop'
}

export enum ConversationEffectType {
  StartExecution = 'start-execution',
  RequestYield = 'request-yield',
  RedirectInput = 'redirect-input',
  ResumeExecution = 'resume-execution',
  AbortExecution = 'abort-execution',
  PersistTerminal = 'persist-terminal',
  FinalizeTerminalPersistence = 'finalize-terminal-persistence',
  SuspendExecution = 'suspend-execution',
  ResumeSuspendedExecution = 'resume-suspended-execution',
  DiscardRuntimeBuffer = 'discard-runtime-buffer',
  ScheduleRuntimeTurn = 'schedule-runtime-turn',
  ScheduleNextTurn = 'schedule-next-turn',
  ScheduleNextStep = 'schedule-next-step',
  DropInputs = 'drop-inputs',
  PublishStatus = 'publish-status',
  PublishExecutionTerminal = 'publish-execution-terminal',
  PublishTurnTerminal = 'publish-turn-terminal',
  PublishQuiescence = 'publish-quiescence'
}

export enum ConversationEventType {
  InputEnqueued = 'input-enqueued',
  InputDropped = 'input-dropped',
  TurnOpened = 'turn-opened',
  ExecutionChanged = 'execution-changed',
  InteractionChanged = 'interaction-changed',
  ActivityChanged = 'activity-changed',
  TurnSettled = 'turn-settled',
  ConversationQuiesced = 'conversation-quiesced'
}

export enum ConversationCommandRejection {
  Busy = 'busy',
  Stale = 'stale',
  Invalid = 'invalid'
}

export enum ConversationPersistenceContinuation {
  Settle = 'settle',
  WaitInteraction = 'wait-interaction'
}

export enum ConversationTerminalAudience {
  All = 'all',
  InternalOnly = 'internal-only'
}

export interface ConversationProfile {
  readonly kind: ConversationKind
}

interface ConversationInputBase {
  readonly id: ConversationInputId
  readonly historyNodeId: string
  readonly provenance: ConversationInputProvenance
  readonly responder: ConversationResponderKind
  readonly batchKey?: string | null
}

export enum ConversationRedirectPhase {
  Queued = 'queued',
  Delivered = 'delivered'
}

export type ConversationDirectInput = ConversationInputBase & { readonly redirect?: never }
export type ConversationRedirectInput = ConversationInputBase & {
  readonly redirect:
    | {
        readonly id: AgentRuntimeRedirectId
        readonly phase: ConversationRedirectPhase.Queued
      }
    | {
        readonly id: AgentRuntimeRedirectId
        readonly phase: ConversationRedirectPhase.Delivered
        readonly segmentId: AgentRuntimeSegmentId
      }
}
export type ConversationInput = ConversationDirectInput | ConversationRedirectInput

export interface ConversationInbox {
  readonly nextTurn: readonly ConversationInput[]
  readonly nextStep: readonly ConversationInput[]
}

export type ConversationOutcome =
  | { readonly kind: ConversationOutcomeKind.Success }
  | { readonly kind: ConversationOutcomeKind.Paused; readonly reason: string }
  | { readonly kind: ConversationOutcomeKind.Error; readonly error: SerializedError }

export interface ConversationExecutionPlan {
  readonly id: ConversationExecutionId
  readonly outputNodeId: string
  readonly driver: ConversationExecutionDriverKind
  readonly modelId: string
  readonly startEffectId: ConversationEffectId
}

export type ConversationExecution =
  | {
      readonly id: ConversationExecutionId
      readonly outputNodeId: string
      readonly driver: ConversationExecutionDriverKind
      readonly modelId: string
      readonly phase: ConversationExecutionPhase.Starting
      readonly runEffectId: ConversationEffectId
    }
  | {
      readonly id: ConversationExecutionId
      readonly outputNodeId: string
      readonly driver: ConversationExecutionDriverKind
      readonly modelId: string
      readonly phase: ConversationExecutionPhase.Active
      readonly runEffectId: ConversationEffectId
    }
  | {
      readonly id: ConversationExecutionId
      readonly outputNodeId: string
      readonly driver: ConversationExecutionDriverKind
      readonly modelId: string
      readonly phase: ConversationExecutionPhase.WaitingInteraction
      readonly runEffectId: ConversationEffectId
      readonly interactionIds: readonly ConversationInteractionId[]
    }
  | {
      readonly id: ConversationExecutionId
      readonly outputNodeId: string
      readonly driver: ConversationExecutionDriverKind
      readonly modelId: string
      readonly phase: ConversationExecutionPhase.Persisting
      readonly runEffectId: ConversationEffectId
      readonly outcome: ConversationOutcome
      readonly persistenceEffectId: ConversationEffectId
      readonly continuation: ConversationPersistenceContinuation.Settle
    }
  | {
      readonly id: ConversationExecutionId
      readonly outputNodeId: string
      readonly driver: ConversationExecutionDriverKind
      readonly modelId: string
      readonly phase: ConversationExecutionPhase.Persisting
      readonly runEffectId: ConversationEffectId
      readonly outcome: ConversationOutcome
      readonly persistenceEffectId: ConversationEffectId
      readonly continuation: ConversationPersistenceContinuation.WaitInteraction
      readonly interactionIds: readonly ConversationInteractionId[]
    }
  | {
      readonly id: ConversationExecutionId
      readonly outputNodeId: string
      readonly driver: ConversationExecutionDriverKind
      readonly modelId: string
      readonly phase: ConversationExecutionPhase.Settled
      readonly outcome: ConversationOutcome
      readonly durability: ConversationTerminalDurability
    }

interface ConversationInteractionBase {
  readonly id: ConversationInteractionId
  readonly executionId: ConversationExecutionId
  readonly kind: ConversationInteractionKind
  readonly resumeMode: ConversationInteractionResumeMode
}

export type ConversationInteraction = ConversationInteractionBase &
  (
    | { readonly phase: ConversationInteractionPhase.Observed | ConversationInteractionPhase.Available }
    | { readonly phase: ConversationInteractionPhase.Resolving; readonly resumeEffectId: ConversationEffectId }
    | { readonly phase: ConversationInteractionPhase.Resolved }
  )

export type ConversationInteractionFact = Omit<ConversationInteraction, 'phase'>

export interface ConversationActivity {
  readonly id: ConversationActivityId
  readonly kind: ConversationActivityKind
  readonly responder?: ConversationResponderKind
}

export interface ConversationTurn {
  readonly id: ConversationTurnId
  readonly kind: ConversationTurnKind
  readonly anchorNodeId: string | null
  readonly responder: ConversationResponderKind
  readonly executions: ReadonlyMap<ConversationExecutionId, ConversationExecution>
  readonly interactions: ReadonlyMap<ConversationInteractionId, ConversationInteraction>
  readonly terminalOverride?: ConversationOutcome
}

interface ConversationStateBase {
  readonly ref: ConversationRef
  readonly profile: ConversationProfile
  readonly inbox: ConversationInbox
  readonly activities: ReadonlyMap<ConversationActivityId, ConversationActivity>
  readonly lastTurnId?: ConversationTurnId
}

type ConversationRunState =
  | {
      readonly runMode: ConversationRunMode.Foreground
      readonly turn: ConversationTurn
    }
  | {
      readonly runMode: ConversationRunMode.Preempting
      readonly turn: ConversationTurn
      readonly runtimeInput: ConversationInput
      readonly runtimeSegmentId: AgentRuntimeSegmentId
      readonly preemptionPhase: ConversationPreemptionPhase
      readonly suspendEffectId: ConversationEffectId
      readonly runtimeOwnership: ConversationRuntimeOwnership
    }
  | {
      readonly runMode: ConversationRunMode.RuntimePreempted
      readonly turn: ConversationTurn
      readonly suspendedTurn: ConversationTurn
      readonly suspendEffectId: ConversationEffectId
      readonly runtimeOwnership: ConversationRuntimeOwnership
      readonly runtimeTerminalDurable: boolean
    }

export type ConversationState =
  | (ConversationStateBase & { readonly phase: ConversationPhase.Idle })
  | (ConversationStateBase & ConversationRunState & { readonly phase: ConversationPhase.Running })
  | (ConversationStateBase & ConversationRunState & { readonly phase: ConversationPhase.Stopping })

interface ConversationEffectIdentity {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly effectId: ConversationEffectId
}

export type ConversationEffect =
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.StartExecution
      readonly executionId: ConversationExecutionId
      readonly interactionId?: ConversationInteractionId
    })
  | (ConversationEffectIdentity & { readonly type: ConversationEffectType.RequestYield })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.RedirectInput
      readonly executionId: ConversationExecutionId
      readonly input: ConversationRedirectInput
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.ResumeExecution
      readonly executionId: ConversationExecutionId
      readonly interactionId: ConversationInteractionId
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.AbortExecution
      readonly executionId: ConversationExecutionId
      readonly reason: string
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.PersistTerminal
      readonly executionId: ConversationExecutionId
      readonly outcome: ConversationOutcome
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.FinalizeTerminalPersistence
      readonly executionId: ConversationExecutionId
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.SuspendExecution
      readonly executionId: ConversationExecutionId
      readonly runtimeSegmentId: AgentRuntimeSegmentId
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.ResumeSuspendedExecution
      readonly executionId: ConversationExecutionId
      readonly runEffectId: ConversationEffectId
      readonly suspendEffectId: ConversationEffectId
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.DiscardRuntimeBuffer
      readonly preemptionId: ConversationEffectId
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.ScheduleRuntimeTurn
      readonly input: ConversationInput
      readonly suspendEffectId: ConversationEffectId
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.ScheduleNextTurn
      readonly inputs: readonly ConversationInput[]
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.ScheduleNextStep
      readonly inputs: readonly ConversationInput[]
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.DropInputs
      readonly inputs: readonly ConversationInput[]
    })
  | (ConversationEffectIdentity & { readonly type: ConversationEffectType.PublishStatus })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.PublishExecutionTerminal
      readonly executionId: ConversationExecutionId
      readonly outcome: ConversationOutcome
      readonly durability: ConversationTerminalDurability
      readonly audience: ConversationTerminalAudience
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.PublishTurnTerminal
      readonly outcome: ConversationOutcome
      readonly durability: ConversationTerminalDurability
      readonly quiescent: boolean
    })
  | (ConversationEffectIdentity & { readonly type: ConversationEffectType.PublishQuiescence })

export type ConversationEvent =
  | { readonly type: ConversationEventType.InputEnqueued; readonly input: ConversationInput }
  | { readonly type: ConversationEventType.InputDropped; readonly input: ConversationInput }
  | { readonly type: ConversationEventType.TurnOpened; readonly turnId: ConversationTurnId }
  | {
      readonly type: ConversationEventType.ExecutionChanged
      readonly executionId: ConversationExecutionId
      readonly phase: ConversationExecutionPhase
    }
  | {
      readonly type: ConversationEventType.InteractionChanged
      readonly interactionId: ConversationInteractionId
    }
  | { readonly type: ConversationEventType.ActivityChanged; readonly activityId: ConversationActivityId }
  | { readonly type: ConversationEventType.TurnSettled; readonly turnId: ConversationTurnId }
  | { readonly type: ConversationEventType.ConversationQuiesced }

export type ConversationCommand =
  | {
      readonly type: ConversationCommandType.TurnCommitted
      readonly inputId: ConversationInputId
      readonly inputIds: readonly ConversationInputId[]
      readonly turnId: ConversationTurnId
      readonly turnKind: ConversationTurnKind
      readonly anchorNodeId: string | null
      readonly responder: ConversationResponderKind
      readonly executions: readonly ConversationExecutionPlan[]
    }
  | {
      readonly type: ConversationCommandType.InputCommitted
      readonly input: ConversationInput
      readonly yieldEffectId?: ConversationEffectId
      readonly redirectEffectId?: ConversationEffectId
      readonly runtimeCanRedirect?: boolean
    }
  | {
      readonly type: ConversationCommandType.InputDropped
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
      readonly dropEffectId: ConversationEffectId
      readonly scheduleEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InputRemoved
      readonly inputId: ConversationInputId
      readonly dropEffectId: ConversationEffectId
      readonly scheduleEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InboxReordered
      readonly inputIds: readonly ConversationInputId[]
    }
  | {
      readonly type: ConversationCommandType.StepCommitted
      readonly turnId: ConversationTurnId
      readonly inputIds: readonly ConversationInputId[]
      readonly executions: readonly ConversationExecutionPlan[]
    }
  | {
      readonly type: ConversationCommandType.StepFailed
      readonly turnId: ConversationTurnId
      readonly inputIds: readonly ConversationInputId[]
      readonly error: SerializedError
      readonly turnTerminalEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
      readonly scheduleEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.ExecutionsAdded
      readonly turnId: ConversationTurnId
      readonly executions: readonly ConversationExecutionPlan[]
    }
  | {
      readonly type: ConversationCommandType.ExecutionRestarted
      readonly turnId: ConversationTurnId
      readonly execution: ConversationExecutionPlan
    }
  | {
      readonly type: ConversationCommandType.ExecutionFirstChunk
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly runEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.ExecutionStartFailed
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly runEffectId: ConversationEffectId
      readonly error: SerializedError
      readonly persistenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.RedirectQueued
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
    }
  | {
      readonly type: ConversationCommandType.RedirectDelivered
      readonly turnId: ConversationTurnId
      readonly redirectIds: readonly AgentRuntimeRedirectId[]
      readonly segmentId: AgentRuntimeSegmentId
    }
  | {
      readonly type: ConversationCommandType.RedirectUndelivered
      readonly turnId: ConversationTurnId
      readonly redirectIds: readonly AgentRuntimeRedirectId[]
    }
  | {
      readonly type: ConversationCommandType.RedirectRejected
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
    }
  | {
      readonly type: ConversationCommandType.InteractionOpened
      readonly turnId: ConversationTurnId
      readonly interaction: ConversationInteractionFact
      readonly statusEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InteractionCompleted
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly interactionId: ConversationInteractionId
      readonly runEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InteractionResolved
      readonly turnId: ConversationTurnId
      readonly interactionId: ConversationInteractionId
      readonly resumeEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InteractionResumeSucceeded
      readonly turnId: ConversationTurnId
      readonly interactionId: ConversationInteractionId
      readonly resumeEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InteractionResumeFailed
      readonly turnId: ConversationTurnId
      readonly interactionId: ConversationInteractionId
      readonly resumeEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.ExecutionTerminal
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly runEffectId: ConversationEffectId
      readonly outcome: ConversationOutcome
      readonly persistenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.PersistenceSucceeded
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly persistenceEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
      readonly executionTerminalEffectId: ConversationEffectId
      readonly turnTerminalEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
      readonly scheduleEffectId?: ConversationEffectId
      readonly scheduleStepEffectId?: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.PersistenceFailed
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly persistenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.PersistenceAbandoned
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly persistenceEffectId: ConversationEffectId
      readonly executionTerminalEffectId: ConversationEffectId
      readonly turnTerminalEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
      readonly scheduleEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.RuntimePreemptionRequested
      readonly input: ConversationInput
      readonly runtimeSegmentId: AgentRuntimeSegmentId
      readonly suspendEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.RuntimeSuspensionSucceeded
      readonly suspendEffectId: ConversationEffectId
      readonly scheduleEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.RuntimeSuspensionFailed
      readonly suspendEffectId: ConversationEffectId
      readonly discardEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.RuntimeTurnCommitted
      readonly inputId: ConversationInputId
      readonly suspendEffectId: ConversationEffectId
      readonly turnId: ConversationTurnId
      readonly anchorNodeId: string | null
      readonly responder: ConversationResponderKind
      readonly executions: readonly ConversationExecutionPlan[]
    }
  | {
      readonly type: ConversationCommandType.RuntimeTurnCommitFailed
      readonly suspendEffectId: ConversationEffectId
      readonly resumeEffectId: ConversationEffectId
      readonly discardEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.RuntimeOwnershipReleased
      readonly suspendEffectId: ConversationEffectId
      readonly resumeEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
    }
  | { readonly type: ConversationCommandType.ActivityOpened; readonly activity: ConversationActivity }
  | {
      readonly type: ConversationCommandType.ActivityClosed
      readonly activityId: ConversationActivityId
      readonly quiescenceEffectId: ConversationEffectId
    }
  | { readonly type: ConversationCommandType.KickInbox; readonly scheduleEffectId: ConversationEffectId }
  | {
      readonly type: ConversationCommandType.Stop
      readonly reason: string
      readonly abortEffectIds: ReadonlyMap<ConversationExecutionId, ConversationEffectId>
      readonly persistenceEffectIds: ReadonlyMap<ConversationExecutionId, ConversationEffectId>
      readonly turnTerminalEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
      readonly discardEffectId: ConversationEffectId
      readonly dropEffectId: ConversationEffectId
    }

export interface ConversationTransition {
  readonly state: ConversationState
  readonly events: readonly ConversationEvent[]
  readonly effects: readonly ConversationEffect[]
  readonly rejection?: ConversationCommandRejection
}

export const createConversationState = (ref: ConversationRef): ConversationState => ({
  ref,
  profile: { kind: ref.kind },
  phase: ConversationPhase.Idle,
  inbox: { nextTurn: [], nextStep: [] },
  activities: new Map()
})

const assertNever = (value: never): never => {
  throw new Error(`Unhandled Conversation command: ${JSON.stringify(value)}`)
}

const unchanged = (state: ConversationState, rejection?: ConversationCommandRejection): ConversationTransition => ({
  state,
  events: [],
  effects: [],
  rejection
})

const firstRunningExecution = (turn: ConversationTurn): ConversationExecution | undefined =>
  [...turn.executions.values()].find(
    (execution) =>
      execution.phase === ConversationExecutionPhase.Starting || execution.phase === ConversationExecutionPhase.Active
  )

const stateHasTurn = (
  state: ConversationState
): state is Extract<ConversationState, { phase: ConversationPhase.Running | ConversationPhase.Stopping }> =>
  state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping

const foregroundStartingExecution = (
  turn: ConversationTurn
): Extract<ConversationExecution, { phase: ConversationExecutionPhase.Starting }> | undefined =>
  [...turn.executions.values()].find(
    (execution): execution is Extract<ConversationExecution, { phase: ConversationExecutionPhase.Starting }> =>
      execution.phase === ConversationExecutionPhase.Starting
  )

const runtimeTurn = (
  command: Extract<ConversationCommand, { type: ConversationCommandType.RuntimeTurnCommitted }>
): ConversationTurn | undefined => {
  if (command.executions.length === 0) return undefined
  const executions = new Map<ConversationExecutionId, ConversationExecution>()
  for (const plan of command.executions) {
    if (executions.has(plan.id)) return undefined
    executions.set(plan.id, {
      id: plan.id,
      outputNodeId: plan.outputNodeId,
      driver: plan.driver,
      modelId: plan.modelId,
      phase: ConversationExecutionPhase.Starting,
      runEffectId: plan.startEffectId
    })
  }
  return {
    id: command.turnId,
    kind: ConversationTurnKind.RuntimeInitiated,
    anchorNodeId: command.anchorNodeId,
    responder: command.responder,
    executions,
    interactions: new Map()
  }
}

const resumeForeground = (
  state: Extract<ConversationState, { runMode: ConversationRunMode.RuntimePreempted }>,
  resumeEffectId: ConversationEffectId
): ConversationTransition => {
  const execution = foregroundStartingExecution(state.suspendedTurn)
  if (!execution) return unchanged(state, ConversationCommandRejection.Invalid)
  return {
    state: {
      ref: state.ref,
      profile: state.profile,
      phase: state.phase,
      runMode: ConversationRunMode.Foreground,
      inbox: state.inbox,
      activities: state.activities,
      lastTurnId: state.turn.id,
      turn: state.suspendedTurn
    },
    events: [{ type: ConversationEventType.TurnSettled, turnId: state.turn.id }],
    effects: [
      {
        type: ConversationEffectType.ResumeSuspendedExecution,
        conversation: state.ref,
        turnId: state.suspendedTurn.id,
        executionId: execution.id,
        effectId: resumeEffectId,
        runEffectId: execution.runEffectId,
        suspendEffectId: state.suspendEffectId
      }
    ]
  }
}

const settleStoppedPreemption = (
  state: Extract<
    ConversationState,
    { phase: ConversationPhase.Stopping; runMode: ConversationRunMode.RuntimePreempted }
  >,
  settledTurn: ConversationTurn,
  execution: Extract<ConversationExecution, { phase: ConversationExecutionPhase.Persisting }>,
  durability: ConversationTerminalDurability,
  command: Extract<
    ConversationCommand,
    { type: ConversationCommandType.PersistenceSucceeded | ConversationCommandType.PersistenceAbandoned }
  >
): ConversationTransition => {
  const targetIsRuntime = state.turn.id === settledTurn.id
  const next = {
    ...state,
    ...(targetIsRuntime ? { turn: settledTurn, runtimeTerminalDurable: true } : { suspendedTurn: settledTurn })
  }
  const bothSettled =
    allExecutionsSettled(next.turn) &&
    allExecutionsSettled(next.suspendedTurn) &&
    next.runtimeOwnership === ConversationRuntimeOwnership.Released
  const quiescent = bothSettled && !hasQuiescenceBlockingActivity(next)
  const effects: ConversationEffect[] = [
    {
      type: ConversationEffectType.PublishExecutionTerminal,
      conversation: state.ref,
      turnId: settledTurn.id,
      executionId: execution.id,
      effectId: command.executionTerminalEffectId,
      outcome: execution.outcome,
      durability,
      audience:
        durability === ConversationTerminalDurability.Durable
          ? ConversationTerminalAudience.All
          : ConversationTerminalAudience.InternalOnly
    },
    {
      type: ConversationEffectType.PublishTurnTerminal,
      conversation: state.ref,
      turnId: settledTurn.id,
      effectId: command.turnTerminalEffectId,
      outcome: settledTurnOutcome(settledTurn),
      durability: settledTurnDurability(settledTurn),
      quiescent
    }
  ]
  if (!bothSettled) {
    return {
      state: next,
      events: [
        {
          type: ConversationEventType.ExecutionChanged,
          executionId: execution.id,
          phase: ConversationExecutionPhase.Settled
        },
        { type: ConversationEventType.TurnSettled, turnId: settledTurn.id }
      ],
      effects
    }
  }
  const idle: ConversationState = {
    ref: state.ref,
    profile: state.profile,
    phase: ConversationPhase.Idle,
    inbox: { nextTurn: [], nextStep: [] },
    activities: state.activities,
    lastTurnId: settledTurn.id
  }
  if (quiescent) {
    effects.push({
      type: ConversationEffectType.PublishQuiescence,
      conversation: state.ref,
      turnId: settledTurn.id,
      effectId: command.quiescenceEffectId
    })
  }
  return {
    state: idle,
    events: [
      {
        type: ConversationEventType.ExecutionChanged,
        executionId: execution.id,
        phase: ConversationExecutionPhase.Settled
      },
      { type: ConversationEventType.TurnSettled, turnId: settledTurn.id },
      ...(quiescent ? ([{ type: ConversationEventType.ConversationQuiesced }] as const) : [])
    ],
    effects
  }
}

const stopTurn = (
  state: ConversationStateBase,
  turn: ConversationTurn,
  reason: string,
  abortEffectIds: ReadonlyMap<ConversationExecutionId, ConversationEffectId>,
  persistenceEffectIds: ReadonlyMap<ConversationExecutionId, ConversationEffectId>
): { turn: ConversationTurn; effects: ConversationEffect[] } | undefined => {
  const effects: ConversationEffect[] = []
  const executions = new Map(turn.executions)
  const interactions = new Map(turn.interactions)
  for (const execution of turn.executions.values()) {
    const waitingOnNewRun =
      execution.phase === ConversationExecutionPhase.WaitingInteraction &&
      execution.interactionIds.every(
        (interactionId) => interactions.get(interactionId)?.resumeMode === ConversationInteractionResumeMode.NewRun
      )
    if (waitingOnNewRun) {
      const persistenceEffectId = persistenceEffectIds.get(execution.id)
      if (!persistenceEffectId) return undefined
      for (const interactionId of execution.interactionIds) interactions.delete(interactionId)
      const outcome: ConversationOutcome = { kind: ConversationOutcomeKind.Paused, reason }
      executions.set(execution.id, {
        id: execution.id,
        outputNodeId: execution.outputNodeId,
        driver: execution.driver,
        modelId: execution.modelId,
        phase: ConversationExecutionPhase.Persisting,
        runEffectId: execution.runEffectId,
        outcome,
        persistenceEffectId,
        continuation: ConversationPersistenceContinuation.Settle
      })
      effects.push({
        type: ConversationEffectType.PersistTerminal,
        conversation: state.ref,
        turnId: turn.id,
        executionId: execution.id,
        effectId: persistenceEffectId,
        outcome
      })
      continue
    }
    if (
      execution.phase === ConversationExecutionPhase.Starting ||
      execution.phase === ConversationExecutionPhase.Active ||
      execution.phase === ConversationExecutionPhase.WaitingInteraction
    ) {
      const effectId = abortEffectIds.get(execution.id)
      if (!effectId) return undefined
      effects.push({
        type: ConversationEffectType.AbortExecution,
        conversation: state.ref,
        turnId: turn.id,
        executionId: execution.id,
        effectId,
        reason
      })
    } else if (execution.phase === ConversationExecutionPhase.Persisting) {
      const abortEffectId = abortEffectIds.get(execution.id)
      if (!abortEffectId) return undefined
      effects.push({
        type: ConversationEffectType.AbortExecution,
        conversation: state.ref,
        turnId: turn.id,
        executionId: execution.id,
        effectId: abortEffectId,
        reason
      })
      if (execution.continuation === ConversationPersistenceContinuation.WaitInteraction) {
        for (const interactionId of execution.interactionIds) interactions.delete(interactionId)
        executions.set(execution.id, { ...execution, continuation: ConversationPersistenceContinuation.Settle })
      }
      effects.push({
        type: ConversationEffectType.FinalizeTerminalPersistence,
        conversation: state.ref,
        turnId: turn.id,
        executionId: execution.id,
        effectId: execution.persistenceEffectId
      })
    }
  }
  return {
    turn: {
      ...turn,
      executions,
      interactions,
      terminalOverride: { kind: ConversationOutcomeKind.Paused, reason }
    },
    effects
  }
}

const replaceExecution = (
  state: Extract<ConversationState, { phase: ConversationPhase.Running | ConversationPhase.Stopping }>,
  execution: ConversationExecution
): Extract<ConversationState, { phase: ConversationPhase.Running | ConversationPhase.Stopping }> => {
  const executions = new Map(state.turn.executions)
  executions.set(execution.id, execution)
  return { ...state, turn: { ...state.turn, executions } }
}

const activityBlocksQuiescence = (activity: ConversationActivity): boolean =>
  activity.kind === ConversationActivityKind.Compaction ||
  activity.kind === ConversationActivityKind.Autonomous ||
  activity.kind === ConversationActivityKind.TerminalRecovery

const hasQuiescenceBlockingActivity = (state: ConversationState): boolean =>
  [...state.activities.values()].some(activityBlocksQuiescence)

const allExecutionsSettled = (turn: ConversationTurn): boolean =>
  turn.executions.size > 0 &&
  [...turn.executions.values()].every((execution) => execution.phase === ConversationExecutionPhase.Settled)

const settledTurnOutcome = (turn: ConversationTurn): ConversationOutcome => {
  const outcomes = [...turn.executions.values()].flatMap((execution) =>
    execution.phase === ConversationExecutionPhase.Settled ? [execution.outcome] : []
  )
  return (
    turn.terminalOverride ??
    outcomes.find((candidate) => candidate.kind === ConversationOutcomeKind.Error) ??
    outcomes.find((candidate) => candidate.kind === ConversationOutcomeKind.Paused) ??
    ({ kind: ConversationOutcomeKind.Success } as const)
  )
}

const settledTurnDurability = (turn: ConversationTurn): ConversationTerminalDurability =>
  [...turn.executions.values()].some(
    (execution) =>
      execution.phase === ConversationExecutionPhase.Settled &&
      execution.durability === ConversationTerminalDurability.DeferredRecovery
  )
    ? ConversationTerminalDurability.DeferredRecovery
    : ConversationTerminalDurability.Durable

const nextTurnBatch = (inbox: ConversationInbox): readonly ConversationInput[] => {
  const first = inbox.nextTurn[0]
  if (!first) return []
  if (first.batchKey === null) return [first]
  const batch: ConversationInput[] = []
  for (const input of inbox.nextTurn) {
    if (input.batchKey !== first.batchKey) break
    batch.push(input)
  }
  return batch
}

const withoutRedirect = (input: ConversationInput): ConversationInput => ({
  id: input.id,
  historyNodeId: input.historyNodeId,
  provenance: input.provenance,
  responder: input.responder,
  batchKey: input.batchKey
})

const deliveredStepBatch = (inbox: ConversationInbox): readonly ConversationInput[] => {
  const first = inbox.nextStep[0]
  if (!first?.redirect || first.redirect.phase !== ConversationRedirectPhase.Delivered) return []
  const batch: ConversationInput[] = []
  for (const input of inbox.nextStep) {
    if (
      !input.redirect ||
      input.redirect.phase !== ConversationRedirectPhase.Delivered ||
      input.redirect.segmentId !== first.redirect.segmentId
    ) {
      break
    }
    batch.push(input)
  }
  return batch
}

const settleTurn = (
  state: Extract<ConversationState, { phase: ConversationPhase.Running | ConversationPhase.Stopping }>,
  turnTerminalEffectId: ConversationEffectId,
  quiescenceEffectId: ConversationEffectId,
  scheduleEffectId?: ConversationEffectId
): ConversationTransition => {
  if (!allExecutionsSettled(state.turn) || state.turn.interactions.size > 0) return unchanged(state)
  const outcome = settledTurnOutcome(state.turn)
  const durability = settledTurnDurability(state.turn)
  const pendingInputs = [...state.inbox.nextTurn, ...state.inbox.nextStep.map(withoutRedirect)]
  const shouldDropInputs =
    state.profile.kind === ConversationKind.Chat && outcome.kind !== ConversationOutcomeKind.Success
  const retainedNextTurn = shouldDropInputs ? [] : pendingInputs
  const scheduledInputs = nextTurnBatch({ nextTurn: retainedNextTurn, nextStep: [] })
  const shouldSchedule = scheduledInputs.length > 0 && state.phase !== ConversationPhase.Stopping
  const quiescent = !shouldSchedule && !hasQuiescenceBlockingActivity(state)
  const nextState: ConversationState = {
    ref: state.ref,
    profile: state.profile,
    phase: ConversationPhase.Idle,
    inbox: { nextTurn: retainedNextTurn, nextStep: [] },
    activities: state.activities,
    lastTurnId: state.turn.id
  }
  const effects: ConversationEffect[] = [
    {
      type: ConversationEffectType.PublishTurnTerminal,
      conversation: state.ref,
      turnId: state.turn.id,
      effectId: turnTerminalEffectId,
      outcome,
      durability,
      quiescent
    }
  ]
  if (shouldDropInputs && pendingInputs.length > 0 && scheduleEffectId) {
    effects.push({
      type: ConversationEffectType.DropInputs,
      conversation: state.ref,
      turnId: state.turn.id,
      effectId: scheduleEffectId,
      inputs: pendingInputs
    })
  } else if (shouldSchedule && scheduleEffectId) {
    effects.push({
      type: ConversationEffectType.ScheduleNextTurn,
      conversation: state.ref,
      turnId: state.turn.id,
      effectId: scheduleEffectId,
      inputs: scheduledInputs
    })
  } else if (quiescent) {
    effects.push({
      type: ConversationEffectType.PublishQuiescence,
      conversation: state.ref,
      turnId: state.turn.id,
      effectId: quiescenceEffectId
    })
  }
  return {
    state: nextState,
    events: [
      { type: ConversationEventType.TurnSettled, turnId: state.turn.id },
      ...(quiescent ? ([{ type: ConversationEventType.ConversationQuiesced }] as const) : [])
    ],
    effects
  }
}

export function transitionConversation(state: ConversationState, command: ConversationCommand): ConversationTransition {
  switch (command.type) {
    case ConversationCommandType.TurnCommitted: {
      if (state.phase !== ConversationPhase.Idle) return unchanged(state, ConversationCommandRejection.Busy)
      if (command.executions.length === 0) return unchanged(state, ConversationCommandRejection.Invalid)
      const inputIds = command.inputIds
      const queuedInputs = state.inbox.nextTurn.slice(0, inputIds.length)
      if (
        queuedInputs.length > 0 &&
        (queuedInputs.length !== inputIds.length || queuedInputs.some((input, index) => input.id !== inputIds[index]))
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const executions = new Map<ConversationExecutionId, ConversationExecution>()
      for (const plan of command.executions) {
        if (executions.has(plan.id)) return unchanged(state, ConversationCommandRejection.Invalid)
        executions.set(plan.id, {
          id: plan.id,
          outputNodeId: plan.outputNodeId,
          driver: plan.driver,
          modelId: plan.modelId,
          phase: ConversationExecutionPhase.Starting,
          runEffectId: plan.startEffectId
        })
      }
      const turn: ConversationTurn = {
        id: command.turnId,
        kind: command.turnKind,
        anchorNodeId: command.anchorNodeId,
        responder: command.responder,
        executions,
        interactions: new Map()
      }
      return {
        state: {
          ...state,
          phase: ConversationPhase.Running,
          runMode: ConversationRunMode.Foreground,
          inbox:
            queuedInputs.length > 0
              ? { ...state.inbox, nextTurn: state.inbox.nextTurn.slice(queuedInputs.length) }
              : state.inbox,
          turn
        },
        events: [
          { type: ConversationEventType.TurnOpened, turnId: command.turnId },
          ...command.executions.map(
            (execution): ConversationEvent => ({
              type: ConversationEventType.ExecutionChanged,
              executionId: execution.id,
              phase: ConversationExecutionPhase.Starting
            })
          )
        ],
        effects: command.executions.map(
          (execution): ConversationEffect => ({
            type: ConversationEffectType.StartExecution,
            conversation: state.ref,
            turnId: command.turnId,
            executionId: execution.id,
            effectId: execution.startEffectId
          })
        )
      }
    }

    case ConversationCommandType.InputCommitted: {
      if (state.phase !== ConversationPhase.Running) {
        return unchanged(
          state,
          state.phase === ConversationPhase.Stopping
            ? ConversationCommandRejection.Busy
            : ConversationCommandRejection.Stale
        )
      }
      const running = firstRunningExecution(state.turn)
      const canRedirect =
        state.runMode === ConversationRunMode.Foreground &&
        state.profile.kind === ConversationKind.Agent &&
        command.runtimeCanRedirect === true &&
        command.input.responder === ConversationResponderKind.Interactive &&
        state.turn.responder === ConversationResponderKind.Interactive &&
        running !== undefined
      if (canRedirect && command.redirectEffectId) {
        const redirectInput: ConversationRedirectInput = {
          ...command.input,
          redirect: {
            id: toAgentRuntimeRedirectId(command.input.id),
            phase: ConversationRedirectPhase.Queued
          }
        }
        return {
          state: {
            ...state,
            inbox: { ...state.inbox, nextStep: [...state.inbox.nextStep, redirectInput] }
          },
          events: [{ type: ConversationEventType.InputEnqueued, input: redirectInput }],
          effects: [
            {
              type: ConversationEffectType.RedirectInput,
              conversation: state.ref,
              turnId: state.turn.id,
              effectId: command.redirectEffectId,
              executionId: running.id,
              input: redirectInput
            }
          ]
        }
      }
      const effects: ConversationEffect[] = []
      if (state.profile.kind === ConversationKind.Chat && running && command.yieldEffectId) {
        effects.push({
          type: ConversationEffectType.RequestYield,
          conversation: state.ref,
          turnId: state.turn.id,
          effectId: command.yieldEffectId
        })
      }
      return {
        state: {
          ...state,
          inbox: { ...state.inbox, nextTurn: [...state.inbox.nextTurn, command.input] }
        },
        events: [{ type: ConversationEventType.InputEnqueued, input: command.input }],
        effects
      }
    }

    case ConversationCommandType.InputDropped: {
      if (
        state.phase !== ConversationPhase.Idle ||
        state.lastTurnId !== command.turnId ||
        state.inbox.nextTurn[0]?.id !== command.inputId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const [dropped, ...nextTurn] = state.inbox.nextTurn
      if (!dropped) return unchanged(state, ConversationCommandRejection.Stale)
      const next = { ...state, inbox: { ...state.inbox, nextTurn } }
      const scheduledInputs = nextTurnBatch(next.inbox)
      const quiescent = scheduledInputs.length === 0 && !hasQuiescenceBlockingActivity(next)
      return {
        state: next,
        events: [
          { type: ConversationEventType.InputDropped, input: dropped },
          ...(quiescent ? ([{ type: ConversationEventType.ConversationQuiesced }] as const) : [])
        ],
        effects: [
          {
            type: ConversationEffectType.DropInputs,
            conversation: state.ref,
            turnId: command.turnId,
            effectId: command.dropEffectId,
            inputs: [dropped]
          },
          ...(scheduledInputs.length > 0
            ? [
                {
                  type: ConversationEffectType.ScheduleNextTurn as const,
                  conversation: state.ref,
                  turnId: command.turnId,
                  effectId: command.scheduleEffectId,
                  inputs: scheduledInputs
                }
              ]
            : quiescent
              ? [
                  {
                    type: ConversationEffectType.PublishQuiescence as const,
                    conversation: state.ref,
                    turnId: command.turnId,
                    effectId: command.quiescenceEffectId
                  }
                ]
              : [])
        ]
      }
    }

    case ConversationCommandType.InputRemoved: {
      const index = state.inbox.nextTurn.findIndex((input) => input.id === command.inputId)
      if (index < 0) return unchanged(state, ConversationCommandRejection.Stale)
      const removed = state.inbox.nextTurn[index]
      if (!removed) return unchanged(state, ConversationCommandRejection.Stale)
      const nextTurn = state.inbox.nextTurn.filter((input) => input.id !== command.inputId)
      const next = { ...state, inbox: { ...state.inbox, nextTurn } }
      const scheduledInputs = state.phase === ConversationPhase.Idle && index === 0 ? nextTurnBatch(next.inbox) : []
      const quiescent =
        state.phase === ConversationPhase.Idle &&
        scheduledInputs.length === 0 &&
        state.inbox.nextStep.length === 0 &&
        !hasQuiescenceBlockingActivity(next)
      return {
        state: next,
        events: [
          { type: ConversationEventType.InputDropped, input: removed },
          ...(quiescent ? ([{ type: ConversationEventType.ConversationQuiesced }] as const) : [])
        ],
        effects: [
          {
            type: ConversationEffectType.DropInputs,
            conversation: state.ref,
            turnId: state.lastTurnId ?? toConversationTurnId('inbox-remove'),
            effectId: command.dropEffectId,
            inputs: [removed]
          },
          ...(scheduledInputs.length > 0
            ? [
                {
                  type: ConversationEffectType.ScheduleNextTurn as const,
                  conversation: state.ref,
                  turnId: state.lastTurnId ?? toConversationTurnId('inbox-remove'),
                  effectId: command.scheduleEffectId,
                  inputs: scheduledInputs
                }
              ]
            : quiescent
              ? [
                  {
                    type: ConversationEffectType.PublishQuiescence as const,
                    conversation: state.ref,
                    turnId: state.lastTurnId ?? toConversationTurnId('inbox-remove'),
                    effectId: command.quiescenceEffectId
                  }
                ]
              : [])
        ]
      }
    }

    case ConversationCommandType.InboxReordered: {
      if (command.inputIds.length !== state.inbox.nextTurn.length) {
        return unchanged(state, ConversationCommandRejection.Invalid)
      }
      const inputs = new Map(state.inbox.nextTurn.map((input) => [input.id, input]))
      const nextTurn = command.inputIds.flatMap((inputId) => {
        const input = inputs.get(inputId)
        if (!input) return []
        inputs.delete(inputId)
        return [input]
      })
      if (inputs.size > 0 || nextTurn.length !== command.inputIds.length) {
        return unchanged(state, ConversationCommandRejection.Invalid)
      }
      return { state: { ...state, inbox: { ...state.inbox, nextTurn } }, events: [], effects: [] }
    }

    case ConversationCommandType.StepCommitted: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (
        command.inputIds.length === 0 ||
        command.inputIds.some((inputId, index) => state.inbox.nextStep[index]?.id !== inputId) ||
        command.executions.length === 0 ||
        !allExecutionsSettled(state.turn)
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const executions = new Map(state.turn.executions)
      for (const plan of command.executions) {
        if (executions.has(plan.id)) return unchanged(state, ConversationCommandRejection.Invalid)
        executions.set(plan.id, {
          id: plan.id,
          outputNodeId: plan.outputNodeId,
          driver: plan.driver,
          modelId: plan.modelId,
          phase: ConversationExecutionPhase.Starting,
          runEffectId: plan.startEffectId
        })
      }
      const turn = { ...state.turn }
      delete turn.terminalOverride
      return {
        state: {
          ...state,
          inbox: {
            ...state.inbox,
            nextStep: state.inbox.nextStep.slice(command.inputIds.length)
          },
          turn: { ...turn, executions }
        },
        events: command.executions.map((execution) => ({
          type: ConversationEventType.ExecutionChanged,
          executionId: execution.id,
          phase: ConversationExecutionPhase.Starting
        })),
        effects: command.executions.map((execution) => ({
          type: ConversationEffectType.StartExecution,
          conversation: state.ref,
          turnId: state.turn.id,
          executionId: execution.id,
          effectId: execution.startEffectId
        }))
      }
    }

    case ConversationCommandType.StepFailed: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (
        command.inputIds.length === 0 ||
        command.inputIds.some((inputId, index) => state.inbox.nextStep[index]?.id !== inputId) ||
        !allExecutionsSettled(state.turn)
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      return settleTurn(
        {
          ...state,
          inbox: {
            ...state.inbox,
            nextStep: state.inbox.nextStep.slice(command.inputIds.length)
          },
          turn: { ...state.turn, terminalOverride: { kind: ConversationOutcomeKind.Error, error: command.error } }
        },
        command.turnTerminalEffectId,
        command.quiescenceEffectId,
        command.scheduleEffectId
      )
    }

    case ConversationCommandType.ExecutionsAdded: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const executions = new Map(state.turn.executions)
      for (const plan of command.executions) {
        if (executions.has(plan.id) || [...executions.values()].some(({ modelId }) => modelId === plan.modelId)) {
          return unchanged(state, ConversationCommandRejection.Invalid)
        }
        executions.set(plan.id, {
          id: plan.id,
          outputNodeId: plan.outputNodeId,
          driver: plan.driver,
          modelId: plan.modelId,
          phase: ConversationExecutionPhase.Starting,
          runEffectId: plan.startEffectId
        })
      }
      return {
        state: { ...state, turn: { ...state.turn, executions } },
        events: command.executions.map((execution) => ({
          type: ConversationEventType.ExecutionChanged,
          executionId: execution.id,
          phase: ConversationExecutionPhase.Starting
        })),
        effects: command.executions.map((execution) => ({
          type: ConversationEffectType.StartExecution,
          conversation: state.ref,
          turnId: state.turn.id,
          executionId: execution.id,
          effectId: execution.startEffectId
        }))
      }
    }

    case ConversationCommandType.ExecutionRestarted: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const current = state.turn.executions.get(command.execution.id)
      if (
        current?.phase !== ConversationExecutionPhase.Settled ||
        current.outputNodeId !== command.execution.outputNodeId ||
        current.driver !== command.execution.driver ||
        current.modelId !== command.execution.modelId
      ) {
        return unchanged(state, ConversationCommandRejection.Invalid)
      }
      const executions = new Map(state.turn.executions)
      executions.set(command.execution.id, {
        id: command.execution.id,
        outputNodeId: command.execution.outputNodeId,
        driver: command.execution.driver,
        modelId: command.execution.modelId,
        phase: ConversationExecutionPhase.Starting,
        runEffectId: command.execution.startEffectId
      })
      return {
        state: { ...state, turn: { ...state.turn, executions } },
        events: [
          {
            type: ConversationEventType.ExecutionChanged,
            executionId: command.execution.id,
            phase: ConversationExecutionPhase.Starting
          }
        ],
        effects: [
          {
            type: ConversationEffectType.StartExecution,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: command.execution.id,
            effectId: command.execution.startEffectId
          }
        ]
      }
    }

    case ConversationCommandType.ExecutionFirstChunk: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      if (execution?.phase !== ConversationExecutionPhase.Starting || execution.runEffectId !== command.runEffectId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const next = replaceExecution(state, { ...execution, phase: ConversationExecutionPhase.Active })
      return {
        state: next,
        events: [
          {
            type: ConversationEventType.ExecutionChanged,
            executionId: execution.id,
            phase: ConversationExecutionPhase.Active
          }
        ],
        effects: [
          {
            type: ConversationEffectType.PublishStatus,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.statusEffectId
          }
        ]
      }
    }

    case ConversationCommandType.ExecutionStartFailed: {
      if (!stateHasTurn(state) || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      if (execution?.phase !== ConversationExecutionPhase.Starting || execution.runEffectId !== command.runEffectId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const outcome: ConversationOutcome = { kind: ConversationOutcomeKind.Error, error: command.error }
      let next = replaceExecution(state, {
        ...execution,
        phase: ConversationExecutionPhase.Persisting,
        outcome,
        persistenceEffectId: command.persistenceEffectId,
        continuation: ConversationPersistenceContinuation.Settle
      })
      if (next.runMode === ConversationRunMode.RuntimePreempted) {
        next = { ...next, runtimeOwnership: ConversationRuntimeOwnership.Released }
      }
      return {
        state: next,
        events: [
          {
            type: ConversationEventType.ExecutionChanged,
            executionId: execution.id,
            phase: ConversationExecutionPhase.Persisting
          }
        ],
        effects: [
          {
            type: ConversationEffectType.PersistTerminal,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: command.persistenceEffectId,
            outcome
          }
        ]
      }
    }

    case ConversationCommandType.RedirectQueued:
    case ConversationCommandType.RedirectRejected: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const index = state.inbox.nextStep.findIndex((input) => input.id === command.inputId)
      if (index < 0) return unchanged(state, ConversationCommandRejection.Stale)
      const input = state.inbox.nextStep[index]
      if (command.type === ConversationCommandType.RedirectQueued) {
        return unchanged(state)
      }
      return {
        state: {
          ...state,
          inbox: {
            nextStep: state.inbox.nextStep.toSpliced(index, 1),
            nextTurn: [...state.inbox.nextTurn, withoutRedirect(input)]
          }
        },
        events: [{ type: ConversationEventType.InputEnqueued, input }],
        effects: []
      }
    }

    case ConversationCommandType.RedirectDelivered: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const deliveredIds = new Set(command.redirectIds)
      if (
        command.redirectIds.length === 0 ||
        command.redirectIds.some(
          (redirectId) =>
            !state.inbox.nextStep.some(
              (input) => input.redirect?.phase === ConversationRedirectPhase.Queued && input.redirect.id === redirectId
            )
        )
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      return {
        state: {
          ...state,
          inbox: {
            ...state.inbox,
            nextStep: state.inbox.nextStep.map((input): ConversationInput => {
              if (!input.redirect || !deliveredIds.has(input.redirect.id)) return input
              return {
                ...input,
                redirect: {
                  id: input.redirect.id,
                  phase: ConversationRedirectPhase.Delivered,
                  segmentId: command.segmentId
                }
              }
            })
          }
        },
        events: [],
        effects: []
      }
    }

    case ConversationCommandType.RedirectUndelivered: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const undelivered = new Set(command.redirectIds)
      const matched = state.inbox.nextStep.filter((input) => input.redirect && undelivered.has(input.redirect.id))
      if (matched.length !== command.redirectIds.length) return unchanged(state, ConversationCommandRejection.Stale)
      return {
        state: {
          ...state,
          inbox: {
            nextStep: state.inbox.nextStep.filter((input) => !input.redirect || !undelivered.has(input.redirect.id)),
            nextTurn: [...state.inbox.nextTurn, ...matched.map(withoutRedirect)]
          }
        },
        events: matched.map((input) => ({ type: ConversationEventType.InputEnqueued, input: withoutRedirect(input) })),
        effects: []
      }
    }

    case ConversationCommandType.InteractionOpened: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.interaction.executionId)
      if (
        !execution ||
        (execution.phase !== ConversationExecutionPhase.Starting &&
          execution.phase !== ConversationExecutionPhase.Active &&
          execution.phase !== ConversationExecutionPhase.WaitingInteraction)
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (state.turn.interactions.has(command.interaction.id)) return unchanged(state)
      const interactions = new Map(state.turn.interactions)
      const available = command.interaction.resumeMode === ConversationInteractionResumeMode.InPlace
      interactions.set(command.interaction.id, {
        ...command.interaction,
        phase: available ? ConversationInteractionPhase.Available : ConversationInteractionPhase.Observed
      })
      const interactionIds =
        execution.phase === ConversationExecutionPhase.WaitingInteraction
          ? [...execution.interactionIds, command.interaction.id]
          : [command.interaction.id]
      const executions = new Map(state.turn.executions)
      if (available) {
        executions.set(execution.id, {
          ...execution,
          phase: ConversationExecutionPhase.WaitingInteraction,
          interactionIds
        })
      }
      return {
        state: { ...state, turn: { ...state.turn, executions, interactions } },
        events: [
          { type: ConversationEventType.InteractionChanged, interactionId: command.interaction.id },
          ...(available
            ? [
                {
                  type: ConversationEventType.ExecutionChanged as const,
                  executionId: execution.id,
                  phase: ConversationExecutionPhase.WaitingInteraction
                }
              ]
            : [])
        ],
        effects: available
          ? [
              {
                type: ConversationEffectType.PublishStatus,
                conversation: state.ref,
                turnId: state.turn.id,
                effectId: command.statusEffectId
              }
            ]
          : []
      }
    }

    case ConversationCommandType.InteractionCompleted: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      const interaction = state.turn.interactions.get(command.interactionId)
      if (
        !execution ||
        (execution.phase !== ConversationExecutionPhase.Active &&
          execution.phase !== ConversationExecutionPhase.WaitingInteraction) ||
        execution.runEffectId !== command.runEffectId ||
        !interaction ||
        interaction.executionId !== execution.id ||
        interaction.phase === ConversationInteractionPhase.Resolving
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      interactions.delete(interaction.id)
      const executions = new Map(state.turn.executions)
      if (execution.phase === ConversationExecutionPhase.WaitingInteraction) {
        const remainingIds = execution.interactionIds.filter((id) => id !== interaction.id)
        executions.set(
          execution.id,
          remainingIds.length > 0
            ? { ...execution, interactionIds: remainingIds }
            : {
                id: execution.id,
                outputNodeId: execution.outputNodeId,
                driver: execution.driver,
                modelId: execution.modelId,
                phase: ConversationExecutionPhase.Active,
                runEffectId: execution.runEffectId
              }
        )
      }
      return {
        state: { ...state, turn: { ...state.turn, executions, interactions } },
        events: [
          { type: ConversationEventType.InteractionChanged, interactionId: interaction.id },
          ...(execution.phase === ConversationExecutionPhase.WaitingInteraction && execution.interactionIds.length === 1
            ? [
                {
                  type: ConversationEventType.ExecutionChanged as const,
                  executionId: execution.id,
                  phase: ConversationExecutionPhase.Active
                }
              ]
            : [])
        ],
        effects: [
          {
            type: ConversationEffectType.PublishStatus,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.statusEffectId
          }
        ]
      }
    }

    case ConversationCommandType.InteractionResolved: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interaction = state.turn.interactions.get(command.interactionId)
      if (!interaction || interaction.phase !== ConversationInteractionPhase.Available) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(interaction.executionId)
      if (execution?.phase !== ConversationExecutionPhase.WaitingInteraction) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      const remainingIds = execution.interactionIds.filter((id) => id !== interaction.id)
      if (remainingIds.length > 0 && interaction.resumeMode === ConversationInteractionResumeMode.NewRun) {
        interactions.delete(interaction.id)
        const executions = new Map(state.turn.executions)
        executions.set(execution.id, { ...execution, interactionIds: remainingIds })
        return {
          state: { ...state, turn: { ...state.turn, executions, interactions } },
          events: [{ type: ConversationEventType.InteractionChanged, interactionId: interaction.id }],
          effects: [
            {
              type: ConversationEffectType.PublishStatus,
              conversation: state.ref,
              turnId: state.turn.id,
              effectId: command.statusEffectId
            }
          ]
        }
      }
      interactions.set(interaction.id, {
        ...interaction,
        phase: ConversationInteractionPhase.Resolving,
        resumeEffectId: command.resumeEffectId
      })
      return {
        state: { ...state, turn: { ...state.turn, interactions } },
        events: [{ type: ConversationEventType.InteractionChanged, interactionId: interaction.id }],
        effects:
          interaction.resumeMode === ConversationInteractionResumeMode.NewRun
            ? [
                {
                  type: ConversationEffectType.StartExecution,
                  conversation: state.ref,
                  turnId: state.turn.id,
                  executionId: execution.id,
                  interactionId: interaction.id,
                  effectId: command.resumeEffectId
                }
              ]
            : [
                {
                  type: ConversationEffectType.ResumeExecution,
                  conversation: state.ref,
                  turnId: state.turn.id,
                  executionId: execution.id,
                  interactionId: interaction.id,
                  effectId: command.resumeEffectId
                }
              ]
      }
    }

    case ConversationCommandType.InteractionResumeSucceeded: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interaction = state.turn.interactions.get(command.interactionId)
      if (
        !interaction ||
        interaction.phase !== ConversationInteractionPhase.Resolving ||
        interaction.resumeEffectId !== command.resumeEffectId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(interaction.executionId)
      if (execution?.phase !== ConversationExecutionPhase.WaitingInteraction) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      interactions.delete(interaction.id)
      const executions = new Map(state.turn.executions)
      const remainingIds = execution.interactionIds.filter((id) => id !== interaction.id)
      executions.set(
        execution.id,
        remainingIds.length > 0
          ? { ...execution, interactionIds: remainingIds }
          : interaction.resumeMode === ConversationInteractionResumeMode.NewRun
            ? {
                id: execution.id,
                outputNodeId: execution.outputNodeId,
                driver: execution.driver,
                modelId: execution.modelId,
                phase: ConversationExecutionPhase.Starting,
                runEffectId: command.resumeEffectId
              }
            : {
                id: execution.id,
                outputNodeId: execution.outputNodeId,
                driver: execution.driver,
                modelId: execution.modelId,
                phase: ConversationExecutionPhase.Active,
                runEffectId: execution.runEffectId
              }
      )
      return {
        state: { ...state, turn: { ...state.turn, executions, interactions } },
        events: [
          { type: ConversationEventType.InteractionChanged, interactionId: interaction.id },
          {
            type: ConversationEventType.ExecutionChanged,
            executionId: execution.id,
            phase: executions.get(execution.id)!.phase
          }
        ],
        effects: [
          {
            type: ConversationEffectType.PublishStatus,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.statusEffectId
          }
        ]
      }
    }

    case ConversationCommandType.InteractionResumeFailed: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interaction = state.turn.interactions.get(command.interactionId)
      if (
        !interaction ||
        interaction.phase !== ConversationInteractionPhase.Resolving ||
        interaction.resumeEffectId !== command.resumeEffectId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      interactions.set(interaction.id, { ...interaction, phase: ConversationInteractionPhase.Available })
      return {
        state: { ...state, turn: { ...state.turn, interactions } },
        events: [{ type: ConversationEventType.InteractionChanged, interactionId: interaction.id }],
        effects: []
      }
    }

    case ConversationCommandType.ExecutionTerminal: {
      if (!stateHasTurn(state) || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      if (!execution || !('runEffectId' in execution) || execution.runEffectId !== command.runEffectId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      const executionInteractionIds = [...interactions.values()]
        .filter((interaction) => interaction.executionId === execution.id)
        .map((interaction) => interaction.id)
      const waitsForInteraction =
        executionInteractionIds.length > 0 && command.outcome.kind === ConversationOutcomeKind.Success
      if (!waitsForInteraction) {
        for (const interactionId of executionInteractionIds) interactions.delete(interactionId)
      }
      const next = replaceExecution(
        { ...state, turn: { ...state.turn, interactions } },
        {
          ...execution,
          phase: ConversationExecutionPhase.Persisting,
          outcome: command.outcome,
          persistenceEffectId: command.persistenceEffectId,
          ...(waitsForInteraction
            ? {
                continuation: ConversationPersistenceContinuation.WaitInteraction,
                interactionIds: executionInteractionIds
              }
            : { continuation: ConversationPersistenceContinuation.Settle })
        }
      )
      return {
        state: next,
        events: [
          {
            type: ConversationEventType.ExecutionChanged,
            executionId: execution.id,
            phase: ConversationExecutionPhase.Persisting
          }
        ],
        effects: [
          {
            type: ConversationEffectType.PersistTerminal,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: command.persistenceEffectId,
            outcome: command.outcome
          }
        ]
      }
    }

    case ConversationCommandType.PersistenceSucceeded:
    case ConversationCommandType.PersistenceAbandoned: {
      if (
        state.phase === ConversationPhase.Stopping &&
        state.runMode === ConversationRunMode.RuntimePreempted &&
        state.suspendedTurn.id === command.turnId
      ) {
        const suspendedExecution = state.suspendedTurn.executions.get(command.executionId)
        if (
          suspendedExecution?.phase !== ConversationExecutionPhase.Persisting ||
          suspendedExecution.persistenceEffectId !== command.persistenceEffectId
        ) {
          return unchanged(state, ConversationCommandRejection.Stale)
        }
        const executions = new Map(state.suspendedTurn.executions)
        executions.set(suspendedExecution.id, {
          ...suspendedExecution,
          phase: ConversationExecutionPhase.Settled,
          durability:
            command.type === ConversationCommandType.PersistenceSucceeded
              ? ConversationTerminalDurability.Durable
              : ConversationTerminalDurability.DeferredRecovery
        })
        return settleStoppedPreemption(
          state,
          { ...state.suspendedTurn, executions },
          suspendedExecution,
          command.type === ConversationCommandType.PersistenceSucceeded
            ? ConversationTerminalDurability.Durable
            : ConversationTerminalDurability.DeferredRecovery,
          command
        )
      }
      if (!stateHasTurn(state) || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      if (
        execution?.phase !== ConversationExecutionPhase.Persisting ||
        execution.persistenceEffectId !== command.persistenceEffectId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (
        command.type === ConversationCommandType.PersistenceSucceeded &&
        execution.continuation === ConversationPersistenceContinuation.WaitInteraction
      ) {
        const interactions = new Map(state.turn.interactions)
        for (const interactionId of execution.interactionIds) {
          const interaction = interactions.get(interactionId)
          if (interaction?.phase === ConversationInteractionPhase.Observed) {
            interactions.set(interactionId, { ...interaction, phase: ConversationInteractionPhase.Available })
          }
        }
        const next = replaceExecution(
          { ...state, turn: { ...state.turn, interactions } },
          {
            id: execution.id,
            outputNodeId: execution.outputNodeId,
            driver: execution.driver,
            modelId: execution.modelId,
            phase: ConversationExecutionPhase.WaitingInteraction,
            runEffectId: execution.runEffectId,
            interactionIds: execution.interactionIds
          }
        )
        return {
          state: next,
          events: [
            {
              type: ConversationEventType.ExecutionChanged,
              executionId: execution.id,
              phase: ConversationExecutionPhase.WaitingInteraction
            }
          ],
          effects: [
            {
              type: ConversationEffectType.PublishStatus,
              conversation: state.ref,
              turnId: state.turn.id,
              effectId: command.statusEffectId
            }
          ]
        }
      }
      const next = replaceExecution(state, {
        ...execution,
        phase: ConversationExecutionPhase.Settled,
        durability:
          command.type === ConversationCommandType.PersistenceSucceeded
            ? ConversationTerminalDurability.Durable
            : ConversationTerminalDurability.DeferredRecovery
      })
      const durability =
        command.type === ConversationCommandType.PersistenceSucceeded
          ? ConversationTerminalDurability.Durable
          : ConversationTerminalDurability.DeferredRecovery
      if (
        next.runMode === ConversationRunMode.RuntimePreempted &&
        next.turn.id === command.turnId &&
        allExecutionsSettled(next.turn)
      ) {
        const runtimeSettled = { ...next, runtimeTerminalDurable: true }
        if (runtimeSettled.phase === ConversationPhase.Stopping) {
          return settleStoppedPreemption(runtimeSettled, runtimeSettled.turn, execution, durability, command)
        }
        const terminalEffects: ConversationEffect[] = [
          {
            type: ConversationEffectType.PublishExecutionTerminal,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: command.executionTerminalEffectId,
            outcome: execution.outcome,
            durability,
            audience:
              durability === ConversationTerminalDurability.Durable
                ? ConversationTerminalAudience.All
                : ConversationTerminalAudience.InternalOnly
          },
          {
            type: ConversationEffectType.PublishTurnTerminal,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.turnTerminalEffectId,
            outcome: settledTurnOutcome(runtimeSettled.turn),
            durability: settledTurnDurability(runtimeSettled.turn),
            quiescent: false
          }
        ]
        if (
          runtimeSettled.phase === ConversationPhase.Running &&
          runtimeSettled.runtimeOwnership === ConversationRuntimeOwnership.Released
        ) {
          const resumed = resumeForeground(
            runtimeSettled,
            command.type === ConversationCommandType.PersistenceSucceeded && command.scheduleEffectId
              ? command.scheduleEffectId
              : command.quiescenceEffectId
          )
          return { ...resumed, effects: [...terminalEffects, ...resumed.effects] }
        }
        return {
          state: runtimeSettled,
          events: [
            {
              type: ConversationEventType.ExecutionChanged,
              executionId: execution.id,
              phase: ConversationExecutionPhase.Settled
            }
          ],
          effects: terminalEffects
        }
      }
      const nextStepInputs = deliveredStepBatch(next.inbox)
      if (
        command.type === ConversationCommandType.PersistenceSucceeded &&
        next.phase === ConversationPhase.Running &&
        next.profile.kind === ConversationKind.Agent &&
        nextStepInputs.length > 0 &&
        command.scheduleStepEffectId &&
        allExecutionsSettled(next.turn) &&
        next.turn.interactions.size === 0
      ) {
        return {
          state: next,
          events: [
            {
              type: ConversationEventType.ExecutionChanged,
              executionId: execution.id,
              phase: ConversationExecutionPhase.Settled
            }
          ],
          effects: [
            {
              type: ConversationEffectType.ScheduleNextStep,
              conversation: state.ref,
              turnId: state.turn.id,
              effectId: command.scheduleStepEffectId,
              inputs: nextStepInputs
            },
            {
              type: ConversationEffectType.PublishExecutionTerminal,
              conversation: state.ref,
              turnId: state.turn.id,
              executionId: execution.id,
              effectId: command.executionTerminalEffectId,
              outcome: execution.outcome,
              durability,
              audience: ConversationTerminalAudience.All
            }
          ]
        }
      }
      const settled = settleTurn(
        next,
        command.turnTerminalEffectId,
        command.quiescenceEffectId,
        command.scheduleEffectId
      )
      return {
        ...settled,
        effects: [
          ...settled.effects.filter(
            ({ type }) => type === ConversationEffectType.ScheduleNextTurn || type === ConversationEffectType.DropInputs
          ),
          {
            type: ConversationEffectType.PublishExecutionTerminal,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: command.executionTerminalEffectId,
            outcome: execution.outcome,
            durability,
            audience:
              durability === ConversationTerminalDurability.Durable
                ? ConversationTerminalAudience.All
                : ConversationTerminalAudience.InternalOnly
          },
          ...settled.effects.filter(
            ({ type }) => type !== ConversationEffectType.ScheduleNextTurn && type !== ConversationEffectType.DropInputs
          )
        ]
      }
    }

    case ConversationCommandType.PersistenceFailed: {
      if (
        state.phase === ConversationPhase.Stopping &&
        state.runMode === ConversationRunMode.RuntimePreempted &&
        state.suspendedTurn.id === command.turnId
      ) {
        const execution = state.suspendedTurn.executions.get(command.executionId)
        return execution?.phase === ConversationExecutionPhase.Persisting &&
          execution.persistenceEffectId === command.persistenceEffectId
          ? unchanged(state)
          : unchanged(state, ConversationCommandRejection.Stale)
      }
      if (!stateHasTurn(state) || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      return execution?.phase === ConversationExecutionPhase.Persisting &&
        execution.persistenceEffectId === command.persistenceEffectId
        ? unchanged(state)
        : unchanged(state, ConversationCommandRejection.Stale)
    }

    case ConversationCommandType.ActivityOpened: {
      if (state.activities.has(command.activity.id)) return unchanged(state)
      const activities = new Map(state.activities)
      activities.set(command.activity.id, command.activity)
      return {
        state: { ...state, activities },
        events: [{ type: ConversationEventType.ActivityChanged, activityId: command.activity.id }],
        effects: []
      }
    }

    case ConversationCommandType.ActivityClosed: {
      if (!state.activities.has(command.activityId)) return unchanged(state, ConversationCommandRejection.Stale)
      const activities = new Map(state.activities)
      activities.delete(command.activityId)
      const next = { ...state, activities }
      const quiescent = isConversationQuiescent(next)
      return {
        state: next,
        events: [{ type: ConversationEventType.ActivityChanged, activityId: command.activityId }],
        effects:
          quiescent && state.lastTurnId
            ? [
                {
                  type: ConversationEffectType.PublishQuiescence,
                  conversation: state.ref,
                  turnId: state.lastTurnId,
                  effectId: command.quiescenceEffectId
                }
              ]
            : []
      }
    }

    case ConversationCommandType.RuntimePreemptionRequested: {
      if (
        state.phase !== ConversationPhase.Running ||
        state.profile.kind !== ConversationKind.Agent ||
        state.runMode !== ConversationRunMode.Foreground ||
        state.turn.interactions.size > 0
      ) {
        return unchanged(state, ConversationCommandRejection.Busy)
      }
      const execution = foregroundStartingExecution(state.turn)
      if (!execution || state.turn.executions.size !== 1) {
        return unchanged(state, ConversationCommandRejection.Busy)
      }
      return {
        state: {
          ...state,
          runMode: ConversationRunMode.Preempting,
          runtimeInput: command.input,
          runtimeSegmentId: command.runtimeSegmentId,
          preemptionPhase: ConversationPreemptionPhase.Suspending,
          suspendEffectId: command.suspendEffectId,
          runtimeOwnership: ConversationRuntimeOwnership.Active
        },
        events: [],
        effects: [
          {
            type: ConversationEffectType.SuspendExecution,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            runtimeSegmentId: command.runtimeSegmentId,
            effectId: command.suspendEffectId
          }
        ]
      }
    }

    case ConversationCommandType.RuntimeSuspensionSucceeded: {
      if (
        state.phase !== ConversationPhase.Running ||
        state.runMode !== ConversationRunMode.Preempting ||
        state.preemptionPhase !== ConversationPreemptionPhase.Suspending ||
        state.suspendEffectId !== command.suspendEffectId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      return {
        state: { ...state, preemptionPhase: ConversationPreemptionPhase.AwaitingRuntimeCommit },
        events: [],
        effects: [
          {
            type: ConversationEffectType.ScheduleRuntimeTurn,
            conversation: state.ref,
            turnId: state.turn.id,
            input: state.runtimeInput,
            effectId: command.scheduleEffectId,
            suspendEffectId: command.suspendEffectId
          }
        ]
      }
    }

    case ConversationCommandType.RuntimeSuspensionFailed: {
      if (
        state.phase !== ConversationPhase.Running ||
        state.runMode !== ConversationRunMode.Preempting ||
        state.preemptionPhase !== ConversationPreemptionPhase.Suspending ||
        state.suspendEffectId !== command.suspendEffectId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      return {
        state: {
          ref: state.ref,
          profile: state.profile,
          phase: ConversationPhase.Running,
          runMode: ConversationRunMode.Foreground,
          inbox: state.inbox,
          activities: state.activities,
          ...(state.lastTurnId ? { lastTurnId: state.lastTurnId } : {}),
          turn: state.turn
        },
        events: [],
        effects: [
          {
            type: ConversationEffectType.DiscardRuntimeBuffer,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.discardEffectId,
            preemptionId: command.suspendEffectId
          }
        ]
      }
    }

    case ConversationCommandType.RuntimeTurnCommitted: {
      if (
        state.phase !== ConversationPhase.Running ||
        state.runMode !== ConversationRunMode.Preempting ||
        state.preemptionPhase !== ConversationPreemptionPhase.AwaitingRuntimeCommit ||
        state.suspendEffectId !== command.suspendEffectId ||
        state.runtimeInput.id !== command.inputId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const turn = runtimeTurn(command)
      if (!turn) return unchanged(state, ConversationCommandRejection.Invalid)
      return {
        state: {
          ref: state.ref,
          profile: state.profile,
          phase: ConversationPhase.Running,
          runMode: ConversationRunMode.RuntimePreempted,
          inbox: state.inbox,
          activities: state.activities,
          ...(state.lastTurnId ? { lastTurnId: state.lastTurnId } : {}),
          turn,
          suspendedTurn: state.turn,
          suspendEffectId: state.suspendEffectId,
          runtimeOwnership: state.runtimeOwnership,
          runtimeTerminalDurable: false
        },
        events: [
          { type: ConversationEventType.TurnOpened, turnId: turn.id },
          ...command.executions.map(
            (execution): ConversationEvent => ({
              type: ConversationEventType.ExecutionChanged,
              executionId: execution.id,
              phase: ConversationExecutionPhase.Starting
            })
          )
        ],
        effects: command.executions.map(
          (execution): ConversationEffect => ({
            type: ConversationEffectType.StartExecution,
            conversation: state.ref,
            turnId: turn.id,
            executionId: execution.id,
            effectId: execution.startEffectId
          })
        )
      }
    }

    case ConversationCommandType.RuntimeTurnCommitFailed: {
      if (
        state.phase !== ConversationPhase.Running ||
        state.runMode !== ConversationRunMode.Preempting ||
        state.preemptionPhase !== ConversationPreemptionPhase.AwaitingRuntimeCommit ||
        state.suspendEffectId !== command.suspendEffectId
      ) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = foregroundStartingExecution(state.turn)
      if (!execution) return unchanged(state, ConversationCommandRejection.Invalid)
      return {
        state: {
          ref: state.ref,
          profile: state.profile,
          phase: ConversationPhase.Running,
          runMode: ConversationRunMode.Foreground,
          inbox: state.inbox,
          activities: state.activities,
          ...(state.lastTurnId ? { lastTurnId: state.lastTurnId } : {}),
          turn: state.turn
        },
        events: [],
        effects: [
          {
            type: ConversationEffectType.ResumeSuspendedExecution,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: command.resumeEffectId,
            runEffectId: execution.runEffectId,
            suspendEffectId: command.suspendEffectId
          },
          {
            type: ConversationEffectType.DiscardRuntimeBuffer,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.discardEffectId,
            preemptionId: command.suspendEffectId
          }
        ]
      }
    }

    case ConversationCommandType.RuntimeOwnershipReleased: {
      if (state.phase !== ConversationPhase.Running && state.phase !== ConversationPhase.Stopping) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (state.runMode === ConversationRunMode.Preempting) {
        if (command.suspendEffectId !== state.suspendEffectId) {
          return unchanged(state, ConversationCommandRejection.Stale)
        }
        return state.runtimeOwnership === ConversationRuntimeOwnership.Released
          ? unchanged(state)
          : { state: { ...state, runtimeOwnership: ConversationRuntimeOwnership.Released }, events: [], effects: [] }
      }
      if (state.runMode !== ConversationRunMode.RuntimePreempted) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (command.suspendEffectId !== state.suspendEffectId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (state.runtimeOwnership === ConversationRuntimeOwnership.Released) return unchanged(state)
      const released = { ...state, runtimeOwnership: ConversationRuntimeOwnership.Released } as const
      if (
        released.phase === ConversationPhase.Stopping &&
        allExecutionsSettled(released.turn) &&
        allExecutionsSettled(released.suspendedTurn)
      ) {
        const quiescent = !hasQuiescenceBlockingActivity(released)
        return {
          state: {
            ref: released.ref,
            profile: released.profile,
            phase: ConversationPhase.Idle,
            inbox: { nextTurn: [], nextStep: [] },
            activities: released.activities,
            lastTurnId: released.turn.id
          },
          events: [...(quiescent ? ([{ type: ConversationEventType.ConversationQuiesced }] as const) : [])],
          effects: quiescent
            ? [
                {
                  type: ConversationEffectType.PublishQuiescence,
                  conversation: released.ref,
                  turnId: released.turn.id,
                  effectId: command.quiescenceEffectId
                }
              ]
            : []
        }
      }
      return released.runtimeTerminalDurable && released.phase === ConversationPhase.Running
        ? resumeForeground(released, command.resumeEffectId)
        : { state: released, events: [], effects: [] }
    }

    case ConversationCommandType.KickInbox: {
      if (state.phase === ConversationPhase.Idle) {
        const inputs = nextTurnBatch(state.inbox)
        if (inputs.length === 0) return unchanged(state, ConversationCommandRejection.Stale)
        return {
          state,
          events: [],
          effects: [
            {
              type: ConversationEffectType.ScheduleNextTurn,
              conversation: state.ref,
              turnId: state.lastTurnId ?? toConversationTurnId('inbox-kick'),
              effectId: command.scheduleEffectId,
              inputs
            }
          ]
        }
      }
      if (
        state.phase !== ConversationPhase.Running ||
        state.runMode !== ConversationRunMode.Foreground ||
        state.turn.interactions.size > 0 ||
        !allExecutionsSettled(state.turn)
      ) {
        return unchanged(state, ConversationCommandRejection.Busy)
      }
      const inputs = deliveredStepBatch(state.inbox)
      if (inputs.length === 0) return unchanged(state, ConversationCommandRejection.Stale)
      return {
        state,
        events: [],
        effects: [
          {
            type: ConversationEffectType.ScheduleNextStep,
            conversation: state.ref,
            turnId: state.turn.id,
            effectId: command.scheduleEffectId,
            inputs
          }
        ]
      }
    }

    case ConversationCommandType.Stop: {
      const pendingInputs = [...state.inbox.nextTurn, ...state.inbox.nextStep]
      const droppedEvents: ConversationEvent[] = pendingInputs.map((input) => ({
        type: ConversationEventType.InputDropped,
        input
      }))
      if (state.phase === ConversationPhase.Idle) {
        if (pendingInputs.length === 0) return unchanged(state)
        if (!state.lastTurnId) return unchanged(state, ConversationCommandRejection.Invalid)
        return {
          state: { ...state, inbox: { nextTurn: [], nextStep: [] } },
          events: droppedEvents,
          effects: [
            {
              type: ConversationEffectType.DropInputs,
              conversation: state.ref,
              turnId: state.lastTurnId,
              effectId: command.dropEffectId,
              inputs: pendingInputs
            }
          ]
        }
      }
      if (state.phase === ConversationPhase.Stopping) return unchanged(state)
      const dropEffects: ConversationEffect[] =
        pendingInputs.length === 0
          ? []
          : [
              {
                type: ConversationEffectType.DropInputs,
                conversation: state.ref,
                turnId: state.turn.id,
                effectId: command.dropEffectId,
                inputs: pendingInputs
              }
            ]
      const stoppedCurrent = stopTurn(
        state,
        state.turn,
        command.reason,
        command.abortEffectIds,
        command.persistenceEffectIds
      )
      if (!stoppedCurrent) return unchanged(state, ConversationCommandRejection.Invalid)
      if (state.runMode === ConversationRunMode.RuntimePreempted) {
        const stoppedSuspended = stopTurn(
          state,
          state.suspendedTurn,
          command.reason,
          command.abortEffectIds,
          command.persistenceEffectIds
        )
        if (!stoppedSuspended) return unchanged(state, ConversationCommandRejection.Invalid)
        const suspendedExecutions = new Map(stoppedSuspended.turn.executions)
        const suspendedEffects = [...stoppedSuspended.effects]
        for (const execution of stoppedSuspended.turn.executions.values()) {
          if (execution.phase !== ConversationExecutionPhase.Starting) continue
          const persistenceEffectId = command.persistenceEffectIds.get(execution.id)
          if (!persistenceEffectId) return unchanged(state, ConversationCommandRejection.Invalid)
          const outcome: ConversationOutcome = { kind: ConversationOutcomeKind.Paused, reason: command.reason }
          suspendedExecutions.set(execution.id, {
            ...execution,
            phase: ConversationExecutionPhase.Persisting,
            outcome,
            persistenceEffectId,
            continuation: ConversationPersistenceContinuation.Settle
          })
          suspendedEffects.push({
            type: ConversationEffectType.PersistTerminal,
            conversation: state.ref,
            turnId: state.suspendedTurn.id,
            executionId: execution.id,
            effectId: persistenceEffectId,
            outcome
          })
        }
        return {
          state: {
            ...state,
            phase: ConversationPhase.Stopping,
            inbox: { nextTurn: [], nextStep: [] },
            turn: stoppedCurrent.turn,
            suspendedTurn: { ...stoppedSuspended.turn, executions: suspendedExecutions }
          },
          events: droppedEvents,
          effects: [
            ...dropEffects,
            ...stoppedCurrent.effects,
            ...suspendedEffects,
            {
              type: ConversationEffectType.DiscardRuntimeBuffer,
              conversation: state.ref,
              turnId: state.suspendedTurn.id,
              effectId: command.discardEffectId,
              preemptionId: state.suspendEffectId
            }
          ]
        }
      }
      const stopping: Extract<ConversationState, { phase: ConversationPhase.Stopping }> = {
        ...state,
        phase: ConversationPhase.Stopping,
        inbox: { nextTurn: [], nextStep: [] },
        turn: stoppedCurrent.turn
      }
      const settled = settleTurn(stopping, command.turnTerminalEffectId, command.quiescenceEffectId)
      return settled.state.phase === ConversationPhase.Idle
        ? {
            ...settled,
            events: [...droppedEvents, ...settled.events],
            effects: [...dropEffects, ...stoppedCurrent.effects, ...settled.effects]
          }
        : {
            state: stopping,
            events: droppedEvents,
            effects: [
              ...dropEffects,
              ...stoppedCurrent.effects,
              ...(state.runMode === ConversationRunMode.Preempting
                ? [
                    {
                      type: ConversationEffectType.DiscardRuntimeBuffer,
                      conversation: state.ref,
                      turnId: state.turn.id,
                      effectId: command.discardEffectId,
                      preemptionId: state.suspendEffectId
                    } as const
                  ]
                : [])
            ]
          }
    }
  }
  return assertNever(command)
}

export const isConversationQuiescent = (state: ConversationState): boolean =>
  state.phase === ConversationPhase.Idle &&
  state.inbox.nextTurn.length === 0 &&
  state.inbox.nextStep.length === 0 &&
  !hasQuiescenceBlockingActivity(state)
