import type { ConversationInteractionKind, ConversationTurnKind } from '@shared/ai/conversation'
import {
  type ConversationActivityId,
  ConversationActivityKind,
  type ConversationEffectId,
  type ConversationExecutionId,
  ConversationExecutionPhase,
  type ConversationInputId,
  type ConversationInteractionId,
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOutcomeKind,
  ConversationPhase,
  type ConversationRef,
  ConversationTerminalDurability,
  type ConversationTurnId
} from '@shared/ai/conversation'
import type { SerializedError } from '@shared/types/error'

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

export enum ConversationCommandType {
  TurnCommitted = 'turn-committed',
  InputCommitted = 'input-committed',
  StepCommitted = 'step-committed',
  StepFailed = 'step-failed',
  ExecutionsAdded = 'executions-added',
  ExecutionFirstChunk = 'execution-first-chunk',
  ExecutionStartFailed = 'execution-start-failed',
  RedirectAccepted = 'redirect-accepted',
  RedirectRejected = 'redirect-rejected',
  InteractionOpened = 'interaction-opened',
  InteractionResolved = 'interaction-resolved',
  ExecutionTerminal = 'execution-terminal',
  PersistenceSucceeded = 'persistence-succeeded',
  PersistenceFailed = 'persistence-failed',
  PersistenceAbandoned = 'persistence-abandoned',
  ActivityOpened = 'activity-opened',
  ActivityClosed = 'activity-closed',
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
  ScheduleNextTurn = 'schedule-next-turn',
  ScheduleNextStep = 'schedule-next-step',
  PublishStatus = 'publish-status',
  PublishExecutionTerminal = 'publish-execution-terminal',
  PublishTurnTerminal = 'publish-turn-terminal',
  PublishQuiescence = 'publish-quiescence'
}

export enum ConversationEventType {
  InputEnqueued = 'input-enqueued',
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

export interface ConversationProfile {
  readonly kind: ConversationKind
}

export interface ConversationInput {
  readonly id: ConversationInputId
  readonly historyNodeId: string
  readonly provenance: ConversationInputProvenance
  readonly responder: ConversationResponderKind
}

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

export interface ConversationInteraction {
  readonly id: ConversationInteractionId
  readonly executionId: ConversationExecutionId
  readonly kind: ConversationInteractionKind
  readonly resumeMode: ConversationInteractionResumeMode
}

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

export type ConversationState =
  | (ConversationStateBase & { readonly phase: ConversationPhase.Idle })
  | (ConversationStateBase & { readonly phase: ConversationPhase.Running; readonly turn: ConversationTurn })
  | (ConversationStateBase & { readonly phase: ConversationPhase.Stopping; readonly turn: ConversationTurn })

interface ConversationEffectIdentity {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly effectId: ConversationEffectId
}

export type ConversationEffect =
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.StartExecution
      readonly executionId: ConversationExecutionId
    })
  | (ConversationEffectIdentity & { readonly type: ConversationEffectType.RequestYield })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.RedirectInput
      readonly executionId: ConversationExecutionId
      readonly input: ConversationInput
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
      readonly type: ConversationEffectType.ScheduleNextTurn
      readonly input: ConversationInput
    })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.ScheduleNextStep
      readonly input: ConversationInput
    })
  | (ConversationEffectIdentity & { readonly type: ConversationEffectType.PublishStatus })
  | (ConversationEffectIdentity & {
      readonly type: ConversationEffectType.PublishExecutionTerminal
      readonly executionId: ConversationExecutionId
      readonly outcome: ConversationOutcome
      readonly durability: ConversationTerminalDurability
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
      readonly type: ConversationCommandType.StepCommitted
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
      readonly executions: readonly ConversationExecutionPlan[]
    }
  | {
      readonly type: ConversationCommandType.StepFailed
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
      readonly error: SerializedError
      readonly turnTerminalEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.ExecutionsAdded
      readonly turnId: ConversationTurnId
      readonly executions: readonly ConversationExecutionPlan[]
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
      readonly type: ConversationCommandType.RedirectAccepted
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
    }
  | {
      readonly type: ConversationCommandType.RedirectRejected
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInputId
    }
  | {
      readonly type: ConversationCommandType.InteractionOpened
      readonly turnId: ConversationTurnId
      readonly interaction: ConversationInteraction
      readonly statusEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.InteractionResolved
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
    }
  | { readonly type: ConversationCommandType.ActivityOpened; readonly activity: ConversationActivity }
  | {
      readonly type: ConversationCommandType.ActivityClosed
      readonly activityId: ConversationActivityId
      readonly quiescenceEffectId: ConversationEffectId
    }
  | {
      readonly type: ConversationCommandType.Stop
      readonly reason: string
      readonly abortEffectIds: ReadonlyMap<ConversationExecutionId, ConversationEffectId>
      readonly persistenceEffectIds: ReadonlyMap<ConversationExecutionId, ConversationEffectId>
      readonly turnTerminalEffectId: ConversationEffectId
      readonly quiescenceEffectId: ConversationEffectId
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

const settleTurn = (
  state: Extract<ConversationState, { phase: ConversationPhase.Running | ConversationPhase.Stopping }>,
  turnTerminalEffectId: ConversationEffectId,
  quiescenceEffectId: ConversationEffectId,
  scheduleEffectId?: ConversationEffectId
): ConversationTransition => {
  if (!allExecutionsSettled(state.turn) || state.turn.interactions.size > 0) return unchanged(state)
  const outcomes = [...state.turn.executions.values()].flatMap((execution) =>
    execution.phase === ConversationExecutionPhase.Settled ? [execution.outcome] : []
  )
  const outcome =
    state.turn.terminalOverride ??
    outcomes.find((candidate) => candidate.kind === ConversationOutcomeKind.Error) ??
    outcomes.find((candidate) => candidate.kind === ConversationOutcomeKind.Paused) ??
    ({ kind: ConversationOutcomeKind.Success } as const)
  const durability = [...state.turn.executions.values()].some(
    (execution) =>
      execution.phase === ConversationExecutionPhase.Settled &&
      execution.durability === ConversationTerminalDurability.DeferredRecovery
  )
    ? ConversationTerminalDurability.DeferredRecovery
    : ConversationTerminalDurability.Durable
  const [nextInput, ...remainingNextTurn] = state.inbox.nextTurn
  const shouldSchedule =
    nextInput !== undefined &&
    (state.profile.kind === ConversationKind.Agent || outcome.kind === ConversationOutcomeKind.Success)
  const quiescent = !shouldSchedule && !hasQuiescenceBlockingActivity(state)
  const nextState: ConversationState = {
    ref: state.ref,
    profile: state.profile,
    phase: ConversationPhase.Idle,
    inbox: { nextTurn: shouldSchedule ? remainingNextTurn : [], nextStep: [] },
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
  if (shouldSchedule && nextInput && scheduleEffectId) {
    effects.push({
      type: ConversationEffectType.ScheduleNextTurn,
      conversation: state.ref,
      turnId: state.turn.id,
      effectId: scheduleEffectId,
      input: nextInput
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
        state: { ...state, phase: ConversationPhase.Running, turn },
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
        state.profile.kind === ConversationKind.Agent &&
        command.runtimeCanRedirect === true &&
        command.input.responder === ConversationResponderKind.Interactive &&
        state.turn.responder === ConversationResponderKind.Interactive &&
        running !== undefined
      if (canRedirect && command.redirectEffectId) {
        return {
          state: {
            ...state,
            inbox: { ...state.inbox, nextStep: [...state.inbox.nextStep, command.input] }
          },
          events: [{ type: ConversationEventType.InputEnqueued, input: command.input }],
          effects: [
            {
              type: ConversationEffectType.RedirectInput,
              conversation: state.ref,
              turnId: state.turn.id,
              effectId: command.redirectEffectId,
              executionId: running.id,
              input: command.input
            }
          ]
        }
      }
      const effects: ConversationEffect[] = []
      if (state.profile.kind === ConversationKind.Chat && command.yieldEffectId) {
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

    case ConversationCommandType.StepCommitted: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      if (
        state.inbox.nextStep[0]?.id !== command.inputId ||
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
            nextStep: state.inbox.nextStep.filter((input) => input.id !== command.inputId)
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
      if (state.inbox.nextStep[0]?.id !== command.inputId || !allExecutionsSettled(state.turn)) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      return settleTurn(
        {
          ...state,
          inbox: {
            ...state.inbox,
            nextStep: state.inbox.nextStep.filter((input) => input.id !== command.inputId)
          },
          turn: { ...state.turn, terminalOverride: { kind: ConversationOutcomeKind.Error, error: command.error } }
        },
        command.turnTerminalEffectId,
        command.quiescenceEffectId
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
      const next = replaceExecution(state, {
        ...execution,
        phase: ConversationExecutionPhase.Persisting,
        outcome,
        persistenceEffectId: command.persistenceEffectId,
        continuation: ConversationPersistenceContinuation.Settle
      })
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

    case ConversationCommandType.RedirectAccepted:
    case ConversationCommandType.RedirectRejected: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const index = state.inbox.nextStep.findIndex((input) => input.id === command.inputId)
      if (index < 0) return unchanged(state, ConversationCommandRejection.Stale)
      const input = state.inbox.nextStep[index]
      if (command.type === ConversationCommandType.RedirectAccepted) {
        return unchanged(state)
      }
      return {
        state: {
          ...state,
          inbox: {
            nextStep: state.inbox.nextStep.toSpliced(index, 1),
            nextTurn: [...state.inbox.nextTurn, input]
          }
        },
        events: [{ type: ConversationEventType.InputEnqueued, input }],
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
      interactions.set(command.interaction.id, command.interaction)
      const interactionIds =
        execution.phase === ConversationExecutionPhase.WaitingInteraction
          ? [...execution.interactionIds, command.interaction.id]
          : [command.interaction.id]
      const executions = new Map(state.turn.executions)
      executions.set(execution.id, {
        ...execution,
        phase: ConversationExecutionPhase.WaitingInteraction,
        interactionIds
      })
      return {
        state: { ...state, turn: { ...state.turn, executions, interactions } },
        events: [
          { type: ConversationEventType.InteractionChanged, interactionId: command.interaction.id },
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

    case ConversationCommandType.InteractionResolved: {
      if (state.phase !== ConversationPhase.Running || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interaction = state.turn.interactions.get(command.interactionId)
      if (!interaction) return unchanged(state, ConversationCommandRejection.Stale)
      const execution = state.turn.executions.get(interaction.executionId)
      if (execution?.phase !== ConversationExecutionPhase.WaitingInteraction) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      interactions.delete(interaction.id)
      const remainingIds = execution.interactionIds.filter((id) => id !== interaction.id)
      const executions = new Map(state.turn.executions)
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
        events: [{ type: ConversationEventType.InteractionChanged, interactionId: interaction.id }],
        effects:
          remainingIds.length > 0
            ? []
            : interaction.resumeMode === ConversationInteractionResumeMode.NewRun
              ? [
                  {
                    type: ConversationEffectType.StartExecution,
                    conversation: state.ref,
                    turnId: state.turn.id,
                    executionId: execution.id,
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

    case ConversationCommandType.ExecutionTerminal: {
      if (!stateHasTurn(state) || state.turn.id !== command.turnId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const execution = state.turn.executions.get(command.executionId)
      if (!execution || !('runEffectId' in execution) || execution.runEffectId !== command.runEffectId) {
        return unchanged(state, ConversationCommandRejection.Stale)
      }
      const interactions = new Map(state.turn.interactions)
      const waitsForInteraction =
        execution.phase === ConversationExecutionPhase.WaitingInteraction &&
        command.outcome.kind === ConversationOutcomeKind.Success
      if (execution.phase === ConversationExecutionPhase.WaitingInteraction && !waitsForInteraction) {
        for (const interactionId of execution.interactionIds) interactions.delete(interactionId)
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
                interactionIds: execution.interactionIds
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
        const next = replaceExecution(state, {
          id: execution.id,
          outputNodeId: execution.outputNodeId,
          driver: execution.driver,
          modelId: execution.modelId,
          phase: ConversationExecutionPhase.WaitingInteraction,
          runEffectId: execution.runEffectId,
          interactionIds: execution.interactionIds
        })
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
      const nextStepInput = next.inbox.nextStep[0]
      if (
        command.type === ConversationCommandType.PersistenceSucceeded &&
        next.phase === ConversationPhase.Running &&
        next.profile.kind === ConversationKind.Agent &&
        nextStepInput &&
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
              type: ConversationEffectType.PublishExecutionTerminal,
              conversation: state.ref,
              turnId: state.turn.id,
              executionId: execution.id,
              effectId: command.executionTerminalEffectId,
              outcome: execution.outcome,
              durability
            },
            {
              type: ConversationEffectType.ScheduleNextStep,
              conversation: state.ref,
              turnId: state.turn.id,
              effectId: command.scheduleStepEffectId,
              input: nextStepInput
            }
          ]
        }
      }
      const settled = settleTurn(
        next,
        command.turnTerminalEffectId,
        command.quiescenceEffectId,
        command.type === ConversationCommandType.PersistenceSucceeded ? command.scheduleEffectId : undefined
      )
      return {
        ...settled,
        effects: [
          {
            type: ConversationEffectType.PublishExecutionTerminal,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: command.executionTerminalEffectId,
            outcome: execution.outcome,
            durability
          },
          ...settled.effects
        ]
      }
    }

    case ConversationCommandType.PersistenceFailed: {
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

    case ConversationCommandType.Stop: {
      if (state.phase === ConversationPhase.Idle) {
        return state.inbox.nextTurn.length === 0 && state.inbox.nextStep.length === 0
          ? unchanged(state)
          : {
              state: { ...state, inbox: { nextTurn: [], nextStep: [] } },
              events: [],
              effects: []
            }
      }
      if (state.phase === ConversationPhase.Stopping) return unchanged(state)
      const effects: ConversationEffect[] = []
      const executions = new Map(state.turn.executions)
      const interactions = new Map(state.turn.interactions)
      for (const execution of state.turn.executions.values()) {
        const waitingOnNewRun =
          execution.phase === ConversationExecutionPhase.WaitingInteraction &&
          execution.interactionIds.every(
            (interactionId) => interactions.get(interactionId)?.resumeMode === ConversationInteractionResumeMode.NewRun
          )
        if (waitingOnNewRun) {
          const persistenceEffectId = command.persistenceEffectIds.get(execution.id)
          if (!persistenceEffectId) return unchanged(state, ConversationCommandRejection.Invalid)
          for (const interactionId of execution.interactionIds) interactions.delete(interactionId)
          const outcome: ConversationOutcome = { kind: ConversationOutcomeKind.Paused, reason: command.reason }
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
            turnId: state.turn.id,
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
          const effectId = command.abortEffectIds.get(execution.id)
          if (!effectId) return unchanged(state, ConversationCommandRejection.Invalid)
          effects.push({
            type: ConversationEffectType.AbortExecution,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId,
            reason: command.reason
          })
        } else if (execution.phase === ConversationExecutionPhase.Persisting) {
          effects.push({
            type: ConversationEffectType.FinalizeTerminalPersistence,
            conversation: state.ref,
            turnId: state.turn.id,
            executionId: execution.id,
            effectId: execution.persistenceEffectId
          })
        }
      }
      const stopping: Extract<ConversationState, { phase: ConversationPhase.Stopping }> = {
        ...state,
        phase: ConversationPhase.Stopping,
        inbox: { nextTurn: [], nextStep: [] },
        turn: {
          ...state.turn,
          executions,
          interactions,
          terminalOverride: { kind: ConversationOutcomeKind.Paused, reason: command.reason }
        }
      }
      const settled = settleTurn(stopping, command.turnTerminalEffectId, command.quiescenceEffectId)
      return settled.state.phase === ConversationPhase.Idle
        ? { ...settled, effects: [...effects, ...settled.effects] }
        : { state: stopping, events: [], effects }
    }
  }
  return assertNever(command)
}

export const isConversationQuiescent = (state: ConversationState): boolean =>
  state.phase === ConversationPhase.Idle &&
  state.inbox.nextTurn.length === 0 &&
  state.inbox.nextStep.length === 0 &&
  !hasQuiescenceBlockingActivity(state)
