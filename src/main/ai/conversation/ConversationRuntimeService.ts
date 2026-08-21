import { application } from '@application'
import { loggerService } from '@logger'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { serializeError } from '@main/ai/utils/serializeError'
import {
  BaseService,
  DependsOn,
  type Disposable,
  Emitter,
  type Event,
  Injectable,
  Phase,
  ServicePhase
} from '@main/core/lifecycle'
import { agentSessionMessageService } from '@main/data/services/AgentSessionMessageService'
import { messageService } from '@main/data/services/MessageService'
import {
  ConversationActiveNodeMove,
  type ConversationActivityId,
  ConversationActivityKind,
  ConversationAdmissionReason,
  ConversationAttachStatus,
  ConversationBlockReason,
  ConversationContinuationTrigger,
  type ConversationEffectId,
  ConversationExecutionAttachState,
  type ConversationExecutionId,
  ConversationExecutionPhase,
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  ConversationPhase,
  type ConversationRef,
  conversationRefKey,
  conversationRefsEqual,
  ConversationStatus,
  ConversationStreamTerminalStatus,
  type ConversationTurnId,
  ConversationTurnKind,
  toConversationActivityId,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInputId,
  toConversationInteractionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type {
  ActiveNodeDecision,
  AiStreamAttachResponse,
  AiStreamOpenResponse,
  ApprovalDecision,
  ExecutionAttachTerminal
} from '@shared/ai/transport'
import type { MessageRuntimeSpan } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type {
  StreamCleanupPort,
  StreamDoneResult,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult,
  StreamPersistencePort
} from '../streamManager'
import {
  agentChatContextProvider,
  type CommittedDispatch,
  type ConversationCompletedEvent,
  type ConversationExecutionContext,
  type ConversationHistoryPort,
  ConversationInteractionCommitResultKind,
  finalizeInterruptedParts,
  type MainContinueConversationRequest,
  type MainDispatchRequest,
  persistentChatContextProvider,
  StreamListenerAudience,
  temporaryChatContextProvider,
  TerminalPersistenceError,
  WebContentsListener
} from '../streamManager'
import { AiExecutionManager, type ConversationExecutionObserver } from './AiExecutionManager'
import { ConversationActor, ConversationAdmissionOperationKind } from './ConversationActor'
import { ConversationAdmissionError } from './ConversationAdmissionError'
import type {
  ConversationPresentationPort,
  ConversationRuntimeIdFactory,
  ConversationRuntimePortSet,
  ConversationTerminalPersistencePort,
  ConversationTerminalPersistenceResult,
  PersistConversationTerminalEffect,
  PublishConversationExecutionTerminalEffect,
  PublishConversationStatusEffect,
  PublishConversationTurnTerminalEffect
} from './conversationPorts'
import { ConversationTerminalPersistenceResultKind } from './conversationPorts'
import { ConversationRuntime } from './ConversationRuntime'
import type {
  ConversationCommand,
  ConversationExecutionPlan,
  ConversationInput,
  ConversationOutcome,
  ConversationState,
  ConversationTransition
} from './conversationState'
import {
  AgentInteractionTurnKind,
  AgentUserResponseMode,
  ConversationCommandType,
  ConversationExecutionDriverKind,
  ConversationInputProvenance,
  ConversationResponderKind,
  ConversationRunMode,
  ConversationTerminalAudience,
  isConversationQuiescent
} from './conversationState'

const logger = loggerService.withContext('ConversationRuntimeService')
const GRACE_PERIOD_MS = 30_000
const PERSISTENCE_RETRY_INTERVAL_MS = 5_000

interface CommittedConversationInput {
  readonly request: MainDispatchRequest
  readonly agentSegment?: boolean
  readonly agentAutonomous?: boolean
}

interface ConversationPresentationBinding {
  readonly subscriber: StreamListener
  readonly extraListeners?: readonly StreamListener[]
}

export enum ConversationHistoryCommitKind {
  FreshTurn = 'fresh-turn',
  NextInput = 'next-input',
  ExecutionAppend = 'execution-append',
  NextStep = 'next-step',
  InteractionResume = 'interaction-resume'
}

interface ReservedExecutionIdentity {
  readonly executionId: ConversationExecutionId
  readonly startEffectId: ConversationEffectId
  readonly modelId: UniqueModelId
}

type ConversationHistoryCommitReservation =
  | {
      readonly kind: ConversationHistoryCommitKind.FreshTurn
      readonly inputId: ConversationInput['id']
      readonly turnId: ConversationTurnId
      readonly turnKind: ConversationTurnKind
      readonly executions: readonly ReservedExecutionIdentity[]
    }
  | {
      readonly kind: ConversationHistoryCommitKind.NextInput
      readonly inputId: ConversationInput['id']
      readonly yieldEffectId: ConversationEffectId
      readonly redirectEffectId: ConversationEffectId
    }
  | {
      readonly kind: ConversationHistoryCommitKind.ExecutionAppend
      readonly turnId: ConversationTurnId
      readonly executions: readonly ReservedExecutionIdentity[]
    }
  | {
      readonly kind: ConversationHistoryCommitKind.NextStep
      readonly turnId: ConversationTurnId
      readonly inputId: ConversationInput['id']
      readonly executions: readonly ReservedExecutionIdentity[]
    }
  | {
      readonly kind: ConversationHistoryCommitKind.InteractionResume
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly interactionId: ReturnType<typeof toConversationInteractionId>
      readonly resumeEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
    }

type ConversationDispatchCommitReservation = Extract<
  ConversationHistoryCommitReservation,
  {
    kind:
      | ConversationHistoryCommitKind.FreshTurn
      | ConversationHistoryCommitKind.NextInput
      | ConversationHistoryCommitKind.ExecutionAppend
  }
>

interface ExecutionProjection {
  readonly id: ConversationExecutionId
  readonly modelId: UniqueModelId
  readonly outputNodeId: string
  readonly persistencePorts: readonly StreamPersistencePort[]
  readonly seedFromEmpty: boolean
  readonly listeners: Map<string, StreamListener>
}

interface TurnProjection {
  readonly ref: ConversationRef
  readonly id: ConversationTurnId
  readonly inputId: ConversationInput['id']
  readonly listeners: Map<string, StreamListener>
  readonly cleanupPorts: readonly StreamCleanupPort[]
  readonly executions: Map<ConversationExecutionId, ExecutionProjection>
  readonly reservedMessages: CommittedDispatch['reservation']['reservedMessages']
  readonly activeNodeDecision: ActiveNodeDecision
  terminal?: StreamDoneResult | StreamPausedResult | StreamErrorResult
  quiescencePublished?: boolean
  cleanupTimer?: ReturnType<typeof setTimeout>
}

const nullStreamListener: StreamListener = {
  id: 'conversation:null',
  onChunk: () => {},
  onDone: () => {},
  onPaused: () => {},
  onError: () => {},
  isAlive: () => false
}

function assertExecutionContextConversation(ref: ConversationRef, context: ConversationExecutionContext): void {
  if (!conversationRefsEqual(ref, context.conversation)) {
    throw new Error('History adapter returned a dispatch for another Conversation')
  }
}

export interface ConversationTurnTerminalEvent {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly outputNodeIds: readonly string[]
  readonly outcome: ConversationOutcome
}

export interface AgentConversationInteractionState {
  readonly currentTurn: AgentInteractionTurnKind
  readonly userResponse: AgentUserResponseMode
}

export interface ConversationDispatchPolicy {
  readonly requireIdle?: boolean
  readonly expectedAgentId?: string
}

@Injectable('ConversationRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ChannelManager', 'ChannelDeliveryService'])
export class ConversationRuntimeService extends BaseService {
  private readonly _onApprovalRequested = new Emitter<ApprovalRequestedEvent>()
  readonly onApprovalRequested: Event<ApprovalRequestedEvent> = this._onApprovalRequested.event
  private readonly _onConversationCompleted = new Emitter<ConversationCompletedEvent>()
  readonly onConversationCompleted = this._onConversationCompleted.event
  private readonly _onTurnTerminal = new Emitter<ConversationTurnTerminalEvent>()
  readonly onTurnTerminal: Event<ConversationTurnTerminalEvent> = this._onTurnTerminal.event
  private readonly executionManager: AiExecutionManager
  private readonly providers: readonly ConversationHistoryPort[]
  private readonly actors = new Map<string, ConversationActor>()
  private readonly committedInputs = new Map<string, CommittedConversationInput>()
  private readonly presentationBindings = new Map<string, ConversationPresentationBinding>()
  private readonly turns = new Map<string, TurnProjection>()
  private readonly deferredQuiescence = new Map<string, ConversationTurnId>()
  private readonly presentationOperations = new Map<string, Promise<void>>()
  private readonly pauseHolds = new Set<symbol>()
  private readonly runtime: ConversationRuntime

  constructor(
    dependencies: { executionManager?: AiExecutionManager; providers?: readonly ConversationHistoryPort[] } = {}
  ) {
    super()
    this.executionManager = dependencies.executionManager ?? new AiExecutionManager()
    this.providers = dependencies.providers ?? [
      agentChatContextProvider,
      temporaryChatContextProvider,
      persistentChatContextProvider
    ]
    const ids: ConversationRuntimeIdFactory = {
      turn: () => toConversationTurnId(crypto.randomUUID()),
      execution: () => toConversationExecutionId(crypto.randomUUID()),
      effect: () => toConversationEffectId(crypto.randomUUID()),
      interaction: () => toConversationInteractionId(crypto.randomUUID()),
      input: () => toConversationInputId(crypto.randomUUID())
    }
    const ports: ConversationRuntimePortSet = {
      terminalPersistence: this.terminalPersistencePort(),
      execution: this.executionManager,
      presentation: this.presentationPort(),
      scheduleNextTurn: (ref, input) =>
        queueMicrotask(() => {
          if (this.isWriteQuiesced) return
          void this.scheduleCommittedInput(ref, input, false).catch((error) => {
            this.deleteCommittedInput(input.id)
            logger.warn('Conversation successor admission failed', { conversation: conversationRefKey(ref), error })
          })
        }),
      scheduleNextStep: (ref, turnId, input) =>
        queueMicrotask(() => {
          void this.scheduleCommittedStep(ref, turnId, input).catch((error) => {
            this.deleteCommittedInput(input.id)
            this.runtime.failStep(ref, turnId, input.id, serializeError(error))
            logger.warn('Conversation step admission failed', { conversation: conversationRefKey(ref), turnId, error })
          })
        }),
      scheduleRuntimeTurn: (ref, input, suspendEffectId) =>
        queueMicrotask(() => {
          void this.scheduleAutonomousTurn(ref, input, suspendEffectId).catch((error) => {
            this.deleteCommittedInput(input.id)
            this.runtime.failRuntimeTurnCommit(ref, suspendEffectId)
            logger.warn('Agent autonomous turn commit failed', {
              conversation: conversationRefKey(ref),
              error
            })
          })
        })
    }
    this.runtime = new ConversationRuntime({ resolve: () => ports }, ids, (ref, command, transition) =>
      this.afterTransition(ref, command, transition)
    )
  }

  protected async onInit(): Promise<void> {
    this.reconcileStalePendingMessages()
    this.registerInterval(() => this.runtime.retryBlockedPersistence(), PERSISTENCE_RETRY_INTERVAL_MS)
  }

  private reconcileStalePendingMessages(): void {
    try {
      const stale = messageService.findCrashOrphanedAssistantMessages()
      if (stale.length === 0) return
      logger.info('Reconciling crash-orphaned pending Chat messages', { count: stale.length })
      messageService.resolveCrashOrphanedMessages(
        stale.map(({ id, data }) => ({
          id,
          data: { ...data, parts: finalizeInterruptedParts(data.parts ?? [], ConversationOutcomeKind.Error) }
        }))
      )
    } catch (error) {
      logger.error('Failed to reconcile stale pending Chat messages', { error })
    }
  }

  protected async onStop(): Promise<void> {
    const hold = this.pause('app-shutdown')
    try {
      for (const ref of this.activeConversationRefs()) this.stop(ref, 'app-shutdown')
      await this.drainInFlight({ timeoutMs: 30_000 })
    } finally {
      hold.dispose()
    }
  }

  protected onDestroy(): void {
    this._onApprovalRequested.dispose()
    this._onConversationCompleted.dispose()
    this._onTurnTerminal.dispose()
  }

  async dispatch(
    subscriber: StreamListener,
    request: MainDispatchRequest,
    extraListeners: readonly StreamListener[] = [],
    policy: ConversationDispatchPolicy = {}
  ): Promise<AiStreamOpenResponse> {
    const ref = request.conversation
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.Dispatch, async (operation) => {
      if (this.isWriteQuiesced) {
        return { mode: ConversationOpenMode.Blocked, reason: ConversationBlockReason.Paused }
      }
      const provider = this.providerFor(ref)
      const initial = this.runtime.inspect(ref)
      if (initial.phase === ConversationPhase.Stopping) throw new Error('Conversation is stopping')
      if (policy.requireIdle && initial.phase !== ConversationPhase.Idle) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy)
      }
      const dispatchContext = {
        hasLiveStream: initial.phase === ConversationPhase.Running,
        ...(policy.requireIdle ? { requireIdle: true } : {}),
        ...(policy.expectedAgentId ? { expectedAgentId: policy.expectedAgentId } : {})
      }
      const validation = await provider.validateDispatch(request, dispatchContext, operation.signal)
      operation.assertCurrent()
      const state = this.runtime.inspect(ref)
      if (state.phase === ConversationPhase.Stopping) throw new Error('Conversation is stopping')
      if (policy.requireIdle && state.phase !== ConversationPhase.Idle) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy)
      }
      const hasLiveStream = state.phase === ConversationPhase.Running
      const reservation = this.reserveDispatchCommit(ref, request, validation.executionModelIds, state)
      const committed = provider.commitDispatch(subscriber, validation, { ...dispatchContext, hasLiveStream })
      operation.assertCurrent()
      if (reservation.kind === ConversationHistoryCommitKind.FreshTurn) {
        return this.commitFreshDispatch(ref, request, extraListeners, committed, reservation)
      }
      return this.commitActiveDispatch(ref, subscriber, request, extraListeners, committed, reservation)
    })
  }

  async dispatchAgentDelivery(
    subscriber: StreamListener,
    message: ReturnType<typeof agentSessionMessageService.getSessionMessage>
  ): Promise<AiStreamOpenResponse | undefined> {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: message.sessionId }
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.Dispatch, async (operation) => {
      if (this.isWriteQuiesced || this.runtime.inspect(ref).phase !== ConversationPhase.Idle) return undefined
      const request: MainDispatchRequest = {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation: ref,
        userMessageParts: message.data.parts ?? [],
        headless: true,
        agentDeliveryMessage: message
      }
      const provider = this.providerFor(ref)
      const validation = await provider.validateDispatch(
        request,
        { hasLiveStream: false, requireIdle: true },
        operation.signal
      )
      operation.assertCurrent()
      if (this.runtime.inspect(ref).phase !== ConversationPhase.Idle) return undefined
      const reservation = this.reserveFreshTurnCommit(
        ref,
        request,
        validation.executionModelIds,
        ConversationTurnKind.Submit
      )
      const committed = provider.commitDispatch(subscriber, validation, { hasLiveStream: false, requireIdle: true })
      operation.assertCurrent()
      return this.commitFreshDispatch(ref, request, [], committed, reservation)
    })
  }

  stop(ref: ConversationRef, reason: string): void {
    this.actors.get(conversationRefKey(ref))?.interrupt(reason)
    this.runtime.stop(ref, reason)
    this.deleteCommittedInputsFor(ref)
  }

  abort(ref: ConversationRef, reason: string): boolean {
    if (!this.hasLiveConversation(ref)) return false
    this.stop(ref, reason)
    return true
  }

  hasLiveConversation(ref: ConversationRef): boolean {
    return (
      this.runtime.inspect(ref).phase !== ConversationPhase.Idle ||
      this.actors.get(conversationRefKey(ref))?.hasPendingAdmissions === true
    )
  }

  hasLiveStream(topicId: string): boolean {
    return this.hasLiveConversation({ kind: ConversationKind.Chat, id: topicId })
  }

  hasPendingChatInput(topicId: string): boolean {
    const state = this.runtime.inspect({ kind: ConversationKind.Chat, id: topicId })
    return state.inbox.nextTurn.length > 0
  }

  hasTerminalPersistenceInFlight(ref: ConversationRef): boolean {
    const state = this.runtime.inspect(ref)
    return (
      (state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping) &&
      [...state.turn.executions.values()].some((execution) => execution.phase === ConversationExecutionPhase.Persisting)
    )
  }

  private canContinueInteraction(ref: ConversationRef, approvalId: string): boolean {
    const state = this.runtime.inspect(ref)
    if (state.phase === ConversationPhase.Idle) return true
    if (state.phase !== ConversationPhase.Running) return false
    const interaction = state.turn.interactions.get(toConversationInteractionId(approvalId))
    if (!interaction) return false
    const execution = state.turn.executions.get(interaction.executionId)
    return (
      execution?.phase === ConversationExecutionPhase.WaitingInteraction &&
      this.executionManager.result(ref, state.turn.id, interaction.executionId) !== undefined
    )
  }

  resolveAgentInteraction(sessionId: string, approvalId: string): boolean {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    return this.runtime.resolveInteraction(ref, toConversationInteractionId(approvalId)).rejection === undefined
  }

  enqueueAgentUndelivered(sessionId: string, userMessageId: string): void {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    const resourceEntry = [...this.committedInputs.entries()].find(
      ([, resource]) => resource.request.agentDeliveryMessage?.id === userMessageId
    )
    if (!resourceEntry) {
      logger.warn('Undelivered Agent steer lost its Conversation input', { sessionId, userMessageId })
      return
    }
    this.runtime.rejectRedirectedInput(ref, toConversationInputId(resourceEntry[0]))
  }

  startAgentAutonomous(sessionId: string, headless: boolean): boolean {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    const inputId = toConversationInputId(crypto.randomUUID())
    const input: ConversationInput = {
      id: inputId,
      historyNodeId: `autonomous:${inputId}`,
      provenance: ConversationInputProvenance.Runtime,
      responder: headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive
    }
    this.committedInputs.set(inputId, {
      request: {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation: ref,
        userMessageParts: [],
        headless
      },
      agentAutonomous: true
    })
    this.presentationBindings.set(inputId, { subscriber: nullStreamListener })
    if (this.runtime.inspect(ref).phase === ConversationPhase.Idle) {
      void this.scheduleCommittedInput(ref, input, true).catch((error) => {
        this.deleteCommittedInput(inputId)
        logger.warn('Agent autonomous Conversation admission failed', { sessionId, error })
      })
      return true
    }
    const transition = this.runtime.requestRuntimePreemption(ref, input)
    if (transition.rejection) {
      this.deleteCommittedInput(inputId)
      return false
    }
    return true
  }

  releaseAgentRuntimeOwnership(sessionId: string, suspendEffectId?: ConversationEffectId): void {
    this.runtime.releaseRuntimeOwnership({ kind: ConversationKind.Agent, id: sessionId }, suspendEffectId)
  }

  openAgentActivity(
    sessionId: string,
    kind: ConversationActivityKind,
    responder?: ConversationResponderKind
  ): ConversationActivityId {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    const id = toConversationActivityId(crypto.randomUUID())
    this.runtime.openActivity(ref, { id, kind, ...(responder ? { responder } : {}) })
    return id
  }

  closeAgentActivity(sessionId: string, activityId: ConversationActivityId): void {
    this.runtime.closeActivity({ kind: ConversationKind.Agent, id: sessionId }, activityId)
  }

  getAgentInteractionState(sessionId: string): AgentConversationInteractionState {
    const state = this.runtime.inspect({ kind: ConversationKind.Agent, id: sessionId })
    const responder =
      state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping
        ? state.turn.responder
        : [...state.activities.values()].find((activity) => activity.kind === ConversationActivityKind.Background)
            ?.responder
    if (!responder) {
      return { currentTurn: AgentInteractionTurnKind.None, userResponse: AgentUserResponseMode.Unavailable }
    }
    if (responder === ConversationResponderKind.Headless) {
      return { currentTurn: AgentInteractionTurnKind.Headless, userResponse: AgentUserResponseMode.Unavailable }
    }
    return {
      currentTurn: AgentInteractionTurnKind.Interactive,
      userResponse:
        state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping
          ? AgentUserResponseMode.Stream
          : AgentUserResponseMode.Message
    }
  }

  async respondChatToolApproval(
    ref: ConversationRef,
    anchorId: string,
    decision: ApprovalDecision,
    subscriber?: StreamListener
  ): Promise<boolean> {
    if (ref.kind !== ConversationKind.Chat) return false
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.Interaction, async (operation) => {
      const initial = this.runtime.inspect(ref)
      if (initial.phase === ConversationPhase.Stopping) return false
      if (initial.phase === ConversationPhase.Running && !this.canContinueInteraction(ref, decision.approvalId)) {
        return false
      }
      const provider = this.providerFor(ref)
      if (!provider.commitInteractionDecision) return false
      const result = provider.commitInteractionDecision(anchorId, decision)
      if (result.kind === ConversationInteractionCommitResultKind.Missing) return false
      const continuation =
        result.kind === ConversationInteractionCommitResultKind.Duplicate ? result.continuation : result.kind
      if (result.kind === ConversationInteractionCommitResultKind.Duplicate) {
        const duplicateState = this.runtime.inspect(ref)
        if (
          duplicateState.phase !== ConversationPhase.Running ||
          !duplicateState.turn.interactions.has(toConversationInteractionId(decision.approvalId))
        ) {
          return true
        }
      }
      if (continuation === ConversationInteractionCommitResultKind.Pending) {
        const state = this.runtime.inspect(ref)
        if (state.phase !== ConversationPhase.Running) return true
        const interactionId = toConversationInteractionId(decision.approvalId)
        const interaction = state.turn.interactions.get(interactionId)
        if (!interaction) return false
        const admission = this.reserveInteractionCommit(ref, state.turn.id, interactionId, interaction.executionId)
        return (
          this.runtime.resolveInteraction(ref, interactionId, admission.resumeEffectId, admission.statusEffectId)
            .rejection === undefined
        )
      }
      if (!subscriber) return false

      const request: MainContinueConversationRequest = {
        trigger: ConversationContinuationTrigger.ContinueInteraction,
        conversation: ref,
        parentAnchorId: anchorId,
        approvalDecisions: [decision]
      }
      const validation = await provider.validateDispatch(request, { hasLiveStream: false }, operation.signal)
      operation.assertCurrent()
      const state = this.runtime.inspect(ref)
      if (state.phase === ConversationPhase.Idle) {
        const admission = this.reserveFreshTurnCommit(
          ref,
          request,
          validation.executionModelIds,
          ConversationTurnKind.Submit
        )
        const committed = provider.commitDispatch(subscriber, validation, { hasLiveStream: false })
        this.commitFreshDispatch(ref, request, [], committed, admission)
        return true
      }
      if (state.phase !== ConversationPhase.Running) return false
      const interactionId = toConversationInteractionId(decision.approvalId)
      const interaction = state.turn.interactions.get(interactionId)
      if (!interaction || !this.canContinueInteraction(ref, decision.approvalId)) return false
      if (validation.executionModelIds.length !== 1) {
        throw new Error('Interaction continuation must reserve one execution')
      }
      const admission = this.reserveInteractionCommit(ref, state.turn.id, interactionId, interaction.executionId)
      const committed = provider.commitDispatch(subscriber, validation, { hasLiveStream: false })
      this.commitInteractionExecution(ref, state.turn.id, interaction.executionId, interactionId, committed, admission)
      return true
    })
  }

  inspect(ref: ConversationRef) {
    return this.runtime.inspect(ref)
  }

  attach(sender: Electron.WebContents, ref: ConversationRef): AiStreamAttachResponse {
    const listener: StreamListener = new WebContentsListener(sender, ref)
    const turn = this.latestTurn(ref)
    if (!turn) return { status: ConversationAttachStatus.NotFound }
    const resources = this.executionManager.attachSnapshot(ref, turn.id, this.observerForListener(ref, listener))
    if (resources.length === 0) return { status: ConversationAttachStatus.NotFound }
    turn.listeners.set(listener.id, listener)
    for (const execution of turn.executions.values()) {
      const bound = listener.createForExecution?.(execution.id) ?? listener
      execution.listeners.set(bound.id, bound)
    }
    const state = this.runtime.inspect(ref)
    const aggregateTurn =
      (state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping) &&
      state.turn.id === turn.id
        ? state.turn
        : undefined
    const executions = resources.map((resource) => {
      const aggregateExecution = aggregateTurn?.executions.get(resource.projection.executionId)
      const settled = turn.terminal !== undefined || aggregateExecution?.phase === ConversationExecutionPhase.Settled
      if (!settled) {
        return {
          state: ConversationExecutionAttachState.Live,
          projection: resource.projection,
          replay: resource.replay
        } as const
      }
      const aggregateOutcome =
        aggregateExecution?.phase === ConversationExecutionPhase.Settled ? aggregateExecution.outcome : undefined
      const outcome = resource.result?.outcome ?? aggregateOutcome
      if (!outcome) throw new Error(`Settled execution ${resource.projection.executionId} has no terminal outcome`)
      return {
        state: ConversationExecutionAttachState.Settled,
        projection: resource.projection,
        replay: resource.replay,
        terminal: this.executionAttachTerminal(outcome, resource.result?.finalMessage)
      } as const
    })
    return turn.terminal
      ? {
          status: ConversationAttachStatus.Settled,
          turnId: turn.id,
          executions,
          terminal: this.streamAttachTerminal(turn.terminal)
        }
      : { status: ConversationAttachStatus.Live, turnId: turn.id, executions }
  }

  detach(sender: Electron.WebContents, ref: ConversationRef): void {
    const observerId = `wc:${sender.id}:${conversationRefKey(ref)}`
    this.executionManager.detach(ref, observerId)
    this.latestTurn(ref)?.listeners.delete(observerId)
  }

  removeListener(ref: ConversationRef, listenerId: string): void {
    this.executionManager.detach(ref, listenerId)
    this.latestTurn(ref)?.listeners.delete(listenerId)
  }

  getDeferredToolOutput(ref: ConversationRef, toolCallId: string): { found: true; output: unknown } | { found: false } {
    return this.executionManager.deferredOutput(ref, toolCallId)
  }

  addCompletedRuntimeSpan(ref: ConversationRef, outputNodeId: string, span: MessageRuntimeSpan): boolean {
    return this.executionManager.addCompletedRuntimeSpan(ref, outputNodeId, span)
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'conversation-runtime-pause')
    this.pauseHolds.add(token)
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token) || this.pauseHolds.size > 0) return
        queueMicrotask(() => this.kickRetainedInputs())
      }
    }
  }

  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  async drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    if (!this.isWriteQuiesced) logger.warn('drainInFlight called without an active pause hold')
    const deadline = Date.now() + options.timeoutMs
    while (true) {
      const runs = this.inFlightOperations()
      if (runs.length === 0) return { stragglerIds: [] }
      const remaining = deadline - Date.now()
      if (remaining <= 0) return { stragglerIds: runs.map(({ id }) => id) }
      let timer: ReturnType<typeof setTimeout> | undefined
      const winner = await Promise.race([
        Promise.allSettled(runs.map(({ run }) => run)).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining)
        })
      ])
      if (timer) clearTimeout(timer)
      if (!winner) return { stragglerIds: this.inFlightOperations().map(({ id }) => id) }
      await Promise.resolve()
    }
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return this.activeConversationRefs().map((ref) => ({
      id: conversationRefKey(ref),
      summary: `conversation:${this.runtime.inspect(ref).phase}`
    }))
  }

  hasLiveStreams(): boolean {
    return this.activeConversationRefs().length > 0
  }

  private reserveDispatchCommit(
    ref: ConversationRef,
    request: MainDispatchRequest,
    executionModelIds: readonly UniqueModelId[],
    state: ConversationState
  ): ConversationDispatchCommitReservation {
    if (state.phase === ConversationPhase.Idle) {
      return this.reserveFreshTurnCommit(
        ref,
        request,
        executionModelIds,
        request.trigger === ConversationOpenTrigger.RegenerateMessage
          ? ConversationTurnKind.Regenerate
          : ConversationTurnKind.Submit
      )
    }
    if (state.phase !== ConversationPhase.Running) throw new Error('Conversation is stopping')
    if (request.trigger === ConversationOpenTrigger.RegenerateMessage) {
      if (executionModelIds.length < 1) throw new Error('Live execution append must reserve an execution')
      const executions = this.reserveExecutionIdentities(executionModelIds)
      const command: ConversationCommand = {
        type: ConversationCommandType.ExecutionsAdded,
        turnId: state.turn.id,
        executions: this.provisionalExecutionPlans(ref, executions)
      }
      this.assertAdmissionPreview(ref, command)
      return { kind: ConversationHistoryCommitKind.ExecutionAppend, turnId: state.turn.id, executions }
    }
    if (executionModelIds.length !== 0) throw new Error('Active input cannot commit execution skeletons')
    const inputId = toConversationInputId(crypto.randomUUID())
    const yieldEffectId = toConversationEffectId(crypto.randomUUID())
    const redirectEffectId = toConversationEffectId(crypto.randomUUID())
    const input: ConversationInput = {
      id: inputId,
      historyNodeId: `admission:${inputId}`,
      provenance: ConversationInputProvenance.Renderer,
      responder: request.headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive
    }
    this.assertAdmissionPreview(ref, {
      type: ConversationCommandType.InputCommitted,
      input,
      yieldEffectId,
      redirectEffectId,
      runtimeCanRedirect: ref.kind === ConversationKind.Agent && request.headless !== true
    })
    return { kind: ConversationHistoryCommitKind.NextInput, inputId, yieldEffectId, redirectEffectId }
  }

  private reserveFreshTurnCommit(
    ref: ConversationRef,
    request: MainDispatchRequest,
    executionModelIds: readonly UniqueModelId[],
    turnKind: ConversationTurnKind,
    input?: ConversationInput
  ): Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.FreshTurn }> {
    if (executionModelIds.length < 1) throw new Error('Conversation turn must reserve at least one execution')
    const turnId = toConversationTurnId(crypto.randomUUID())
    const inputId = input?.id ?? toConversationInputId(crypto.randomUUID())
    const executions = this.reserveExecutionIdentities(executionModelIds)
    this.assertAdmissionPreview(ref, {
      type: ConversationCommandType.TurnCommitted,
      inputId,
      turnId,
      turnKind,
      anchorNodeId: 'parentAnchorId' in request ? (request.parentAnchorId ?? null) : null,
      responder:
        input?.responder ??
        (request.headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive),
      executions: this.provisionalExecutionPlans(ref, executions)
    })
    return { kind: ConversationHistoryCommitKind.FreshTurn, inputId, turnId, turnKind, executions }
  }

  private reserveStepCommit(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    input: ConversationInput,
    executionModelIds: readonly UniqueModelId[]
  ): Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.NextStep }> {
    const executions = this.reserveExecutionIdentities(executionModelIds)
    this.assertAdmissionPreview(ref, {
      type: ConversationCommandType.StepCommitted,
      turnId,
      inputId: input.id,
      executions: this.provisionalExecutionPlans(ref, executions)
    })
    return { kind: ConversationHistoryCommitKind.NextStep, turnId, inputId: input.id, executions }
  }

  private reserveInteractionCommit(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    interactionId: ReturnType<typeof toConversationInteractionId>,
    executionId: ConversationExecutionId
  ): Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.InteractionResume }> {
    const resumeEffectId = toConversationEffectId(crypto.randomUUID())
    const statusEffectId = toConversationEffectId(crypto.randomUUID())
    this.assertAdmissionPreview(ref, {
      type: ConversationCommandType.InteractionResolved,
      turnId,
      interactionId,
      resumeEffectId,
      statusEffectId
    })
    return {
      kind: ConversationHistoryCommitKind.InteractionResume,
      turnId,
      executionId,
      interactionId,
      resumeEffectId,
      statusEffectId
    }
  }

  private reserveExecutionIdentities(modelIds: readonly UniqueModelId[]): readonly ReservedExecutionIdentity[] {
    return modelIds.map((modelId) => ({
      executionId: toConversationExecutionId(crypto.randomUUID()),
      startEffectId: toConversationEffectId(crypto.randomUUID()),
      modelId
    }))
  }

  private provisionalExecutionPlans(
    ref: ConversationRef,
    identities: readonly ReservedExecutionIdentity[]
  ): readonly ConversationExecutionPlan[] {
    return identities.map((identity) => ({
      id: identity.executionId,
      outputNodeId: `admission:${identity.executionId}`,
      driver:
        ref.kind === ConversationKind.Agent
          ? ConversationExecutionDriverKind.Agent
          : ConversationExecutionDriverKind.Chat,
      modelId: identity.modelId,
      startEffectId: identity.startEffectId
    }))
  }

  private assertAdmissionPreview(ref: ConversationRef, command: ConversationCommand): void {
    const preview = this.runtime.preview(ref, command)
    if (preview.rejection) throw new Error(`Conversation admission was rejected: ${preview.rejection}`)
  }

  private commitFreshDispatch(
    ref: ConversationRef,
    request: MainDispatchRequest,
    extraListeners: readonly StreamListener[],
    committed: CommittedDispatch,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.FreshTurn }>,
    committedInput?: ConversationInput
  ): AiStreamOpenResponse {
    this.assertCommittedConversation(ref, committed)
    if (committed.reservation.models.length === 0) throw new Error('Committed Conversation turn has no executions')
    if (committedInput && committedInput.id !== admission.inputId) {
      throw new Error('Committed Conversation input changed its reserved identity')
    }
    const inputId = admission.inputId
    const turnId = admission.turnId
    const input: ConversationInput =
      committedInput ??
      ({
        id: inputId,
        historyNodeId: this.committedInputNodeId(ref, committed),
        provenance: ConversationInputProvenance.Renderer,
        responder: request.headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive
      } satisfies ConversationInput)
    const plans = this.installCommittedExecutions(
      ref,
      turnId,
      committed,
      extraListeners,
      new Map(),
      admission.executions
    )
    const reservation = committed.reservation
    const turn: TurnProjection = {
      ref,
      id: turnId,
      inputId,
      listeners: new Map([...reservation.listeners, ...extraListeners].map((listener) => [listener.id, listener])),
      cleanupPorts: reservation.cleanupPorts,
      executions: new Map(plans.map(({ projection }) => [projection.id, projection])),
      reservedMessages: reservation.reservedMessages,
      activeNodeDecision: reservation.liveExecutionChange
        ? { move: ConversationActiveNodeMove.Keep }
        : { move: ConversationActiveNodeMove.Advance }
    }
    this.turns.set(this.turnKey(ref, turnId), turn)
    const transition = this.runtime.openTurn(
      ref,
      input,
      plans.map(({ plan }) => plan),
      {
        turnId,
        turnKind: admission.turnKind,
        anchorNodeId: 'parentAnchorId' in request ? (request.parentAnchorId ?? null) : null
      }
    )
    if (transition.rejection) {
      this.releaseTurn(turn)
      throw new Error(`Committed Conversation turn was rejected: ${transition.rejection}`)
    }
    return {
      mode: ConversationOpenMode.Started,
      reservedMessages: reservation.reservedMessages,
      activeNodeDecision: turn.activeNodeDecision,
      activeExecutions: plans.map(({ projection }) => ({
        turnId,
        executionId: projection.id,
        modelId: projection.modelId,
        outputNodeId: projection.outputNodeId,
        ...(projection.seedFromEmpty ? { seedFromEmpty: true } : {})
      }))
    }
  }

  private commitActiveDispatch(
    ref: ConversationRef,
    subscriber: StreamListener,
    request: MainDispatchRequest,
    extraListeners: readonly StreamListener[],
    committed: CommittedDispatch,
    admission: Extract<
      ConversationDispatchCommitReservation,
      { kind: ConversationHistoryCommitKind.NextInput | ConversationHistoryCommitKind.ExecutionAppend }
    >
  ): AiStreamOpenResponse {
    this.assertCommittedConversation(ref, committed)
    if (request.trigger === ConversationOpenTrigger.RegenerateMessage) {
      if (ref.kind !== ConversationKind.Chat || !request.appendToLiveGroupMessageId) {
        throw new Error('Only a live-group append may regenerate an active Conversation')
      }
      if (admission.kind !== ConversationHistoryCommitKind.ExecutionAppend) {
        throw new Error('Live execution append did not match its admission preview')
      }
      return this.commitActiveExecutions(ref, extraListeners, committed, admission)
    }
    if (committed.reservation.models.length !== 0) {
      throw new Error('Active Conversation input unexpectedly committed executions')
    }
    const userMessageId = this.committedInputNodeId(ref, committed)
    if (admission.kind !== ConversationHistoryCommitKind.NextInput) {
      throw new Error('Active input did not match its admission preview')
    }
    const inputId = admission.inputId
    const queuedRequest: MainDispatchRequest =
      ref.kind === ConversationKind.Agent
        ? {
            ...request,
            agentDeliveryMessage: agentSessionMessageService.getSessionMessage(ref.id, userMessageId)
          }
        : {
            trigger: ConversationContinuationTrigger.ContinueSteer,
            conversation: ref,
            userMessageId,
            reasoningEffort: committed.reservation.pendingSteerReasoningEffort,
            fastMode: committed.reservation.pendingSteerFastMode === true,
            headless: request.headless
          }
    this.committedInputs.set(inputId, { request: queuedRequest })
    this.presentationBindings.set(inputId, { subscriber, extraListeners })
    const input: ConversationInput = {
      id: inputId,
      historyNodeId: userMessageId,
      provenance: ConversationInputProvenance.Renderer,
      responder: request.headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive
    }
    const transition = this.runtime.commitInput(ref, input, {
      runtimeCanRedirect: ref.kind === ConversationKind.Agent && request.headless !== true,
      yieldEffectId: admission.yieldEffectId,
      redirectEffectId: admission.redirectEffectId
    })
    if (transition.rejection) {
      this.deleteCommittedInput(inputId)
      throw new Error(`Committed Conversation input was rejected: ${transition.rejection}`)
    }
    this.addListener(ref, subscriber)
    for (const listener of extraListeners) this.addListener(ref, listener)
    return { mode: ConversationOpenMode.Injected, reservedMessages: committed.reservation.reservedMessages }
  }

  private commitActiveExecutions(
    ref: ConversationRef,
    extraListeners: readonly StreamListener[],
    committed: CommittedDispatch,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.ExecutionAppend }>
  ): AiStreamOpenResponse {
    const state = this.runtime.inspect(ref)
    if (state.phase !== ConversationPhase.Running) throw new Error('Conversation is not running')
    const turn = this.turns.get(this.turnKey(ref, state.turn.id))
    if (!turn) throw new Error('Conversation turn projection is missing')
    if (admission.turnId !== state.turn.id) throw new Error('Live append turn changed after admission preview')
    const plans = this.installCommittedExecutions(
      ref,
      state.turn.id,
      committed,
      extraListeners,
      turn.listeners,
      admission.executions
    )
    for (const { projection } of plans) turn.executions.set(projection.id, projection)
    for (const listener of [...committed.reservation.listeners, ...extraListeners]) {
      turn.listeners.set(listener.id, listener)
    }
    const transition = this.runtime.addExecutions(
      ref,
      state.turn.id,
      plans.map(({ plan }) => plan)
    )
    if (transition.rejection) {
      for (const { projection } of plans) {
        this.executionManager.release(ref, state.turn.id, projection.id)
        turn.executions.delete(projection.id)
      }
      throw new Error(`Committed execution append was rejected: ${transition.rejection}`)
    }
    return {
      mode: ConversationOpenMode.Started,
      reservedMessages: committed.reservation.reservedMessages,
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep },
      activeExecutions: plans.map(({ projection }) => ({
        turnId: state.turn.id,
        executionId: projection.id,
        modelId: projection.modelId,
        outputNodeId: projection.outputNodeId
      }))
    }
  }

  private commitInteractionExecution(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId,
    interactionId: ReturnType<typeof toConversationInteractionId>,
    committed: CommittedDispatch,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.InteractionResume }>
  ): AiStreamOpenResponse {
    if (
      admission.turnId !== turnId ||
      admission.executionId !== executionId ||
      admission.interactionId !== interactionId
    ) {
      throw new Error('Interaction continuation changed its admission identity')
    }
    this.assertCommittedConversation(ref, committed)
    const turn = this.turns.get(this.turnKey(ref, turnId))
    const current = turn?.executions.get(executionId)
    const model = committed.reservation.models[0]
    if (!turn || !current) throw new Error('Conversation interaction projection is missing')
    if (!model || committed.reservation.models.length !== 1) {
      throw new Error('Interaction continuation requires one committed execution')
    }
    if (model.outputNodeId !== current.outputNodeId) {
      throw new Error('Interaction continuation changed its committed output identity')
    }

    const executionListeners = new Map(current.listeners)
    for (const listener of committed.reservation.listeners) {
      turn.listeners.set(listener.id, listener)
      const bound = listener.createForExecution?.(executionId) ?? listener
      executionListeners.set(bound.id, bound)
    }
    const projection: ExecutionProjection = {
      ...current,
      modelId: model.modelId,
      persistencePorts: committed.reservation.persistencePorts,
      seedFromEmpty: model.seedFromEmpty === true,
      listeners: executionListeners
    }
    turn.executions.set(executionId, projection)
    this.executionManager.release(ref, turnId, executionId)
    const observers = [...executionListeners.values()].map((listener) =>
      this.observerForExecution(executionId, projection, listener)
    )
    observers.push(this.controlObserver(ref, executionId, projection))
    this.executionManager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: projection.outputNodeId,
      modelId: projection.modelId,
      request: async (signal, compactionSink) => {
        const prepared = await committed.prepareExecutionContext(signal, compactionSink)
        assertExecutionContextConversation(ref, prepared)
        const preparedModel = prepared.models[0]
        if (
          !preparedModel ||
          prepared.models.length !== 1 ||
          preparedModel.modelId !== model.modelId ||
          preparedModel.request.messageId !== model.outputNodeId
        ) {
          throw new Error('History adapter changed an interaction execution identity during preparation')
        }
        return preparedModel.request
      },
      observers,
      runtimeTimingSeed: model.runtimeTimingSeed,
      rootSpan: model.rootSpan,
      abortController: model.abortController,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    const transition = this.runtime.resolveInteraction(
      ref,
      interactionId,
      admission.resumeEffectId,
      admission.statusEffectId
    )
    if (transition.rejection) {
      this.executionManager.release(ref, turnId, executionId)
      throw new Error(`Interaction continuation was rejected: ${transition.rejection}`)
    }
    return {
      mode: ConversationOpenMode.Started,
      reservedMessages: committed.reservation.reservedMessages,
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep },
      activeExecutions: [
        {
          turnId,
          executionId,
          modelId: projection.modelId,
          outputNodeId: projection.outputNodeId,
          ...(projection.seedFromEmpty ? { seedFromEmpty: true } : {})
        }
      ]
    }
  }

  private installCommittedExecutions(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    committed: CommittedDispatch,
    extraListeners: readonly StreamListener[],
    inheritedListeners: ReadonlyMap<string, StreamListener> = new Map(),
    identities: readonly ReservedExecutionIdentity[]
  ): Array<{ plan: ConversationExecutionPlan; projection: ExecutionProjection }> {
    if (committed.reservation.models.length !== identities.length) {
      throw new Error('History adapter changed the execution count after admission preview')
    }
    const listeners = new Map(inheritedListeners)
    for (const listener of [...committed.reservation.listeners, ...extraListeners]) listeners.set(listener.id, listener)
    let preparation: Promise<ConversationExecutionContext> | undefined
    const prepare = (
      signal: AbortSignal,
      compactionSink: Parameters<CommittedDispatch['prepareExecutionContext']>[1]
    ): Promise<ConversationExecutionContext> =>
      (preparation ??= committed.prepareExecutionContext(signal, compactionSink))
    return committed.reservation.models.map((model, index) => {
      const identity = identities[index]
      if (!identity) throw new Error('Reserved execution identity is missing')
      if (identity.modelId !== model.modelId) {
        throw new Error('History adapter changed a validated execution model during commit')
      }
      const executionId = identity.executionId
      const projection: ExecutionProjection = {
        id: executionId,
        modelId: model.modelId,
        outputNodeId: model.outputNodeId,
        persistencePorts: committed.reservation.persistencePorts,
        seedFromEmpty: model.seedFromEmpty === true,
        listeners: this.bindExecutionListeners(listeners, executionId)
      }
      const observers = [...projection.listeners.values()].map((listener) =>
        this.observerForExecution(executionId, projection, listener)
      )
      observers.push(this.controlObserver(ref, executionId, projection))
      this.executionManager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: projection.outputNodeId,
        modelId: model.modelId,
        request: async (signal, compactionSink) => {
          const prepared = await prepare(signal, compactionSink)
          assertExecutionContextConversation(ref, prepared)
          const preparedModel = prepared.models[index]
          if (
            !preparedModel ||
            preparedModel.modelId !== model.modelId ||
            preparedModel.request.messageId !== model.outputNodeId
          ) {
            throw new Error('History adapter changed a committed execution identity during preparation')
          }
          return preparedModel.request
        },
        observers,
        runtimeTimingSeed: model.runtimeTimingSeed,
        rootSpan: model.rootSpan,
        abortController: model.abortController,
        interactionResumeMode:
          ref.kind === ConversationKind.Chat
            ? ConversationInteractionResumeMode.NewRun
            : ConversationInteractionResumeMode.InPlace,
        ...(ref.kind === ConversationKind.Agent
          ? {
              redirect: (effect) => this.redirectAgentInput(ref, effect.input),
              ...(model.agentRuntimeTurnId
                ? {
                    suspend: (effect) =>
                      application
                        .get('AgentConnectionManager')
                        .suspendConversationExecution(ref.id, model.agentRuntimeTurnId!, effect.effectId),
                    resumeSuspended: () =>
                      application
                        .get('AgentConnectionManager')
                        .resumeConversationExecution(ref.id, model.agentRuntimeTurnId!),
                    discardRuntimeBuffer: () =>
                      application.get('AgentConnectionManager').discardAutonomousBuffer(ref.id)
                  }
                : {})
            }
          : {})
      })
      return {
        projection,
        plan: {
          id: executionId,
          outputNodeId: projection.outputNodeId,
          driver:
            ref.kind === ConversationKind.Agent
              ? ConversationExecutionDriverKind.Agent
              : ConversationExecutionDriverKind.Chat,
          modelId: model.modelId,
          startEffectId: identity.startEffectId
        }
      }
    })
  }

  private terminalPersistencePort(): ConversationTerminalPersistencePort {
    return { persistTerminal: (effect) => this.persistTerminal(effect) }
  }

  private scheduleAutonomousTurn(
    ref: ConversationRef,
    input: ConversationInput,
    suspendEffectId: ConversationEffectId
  ): Promise<void> {
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.RuntimeContinuation, async (operation) => {
      operation.assertCurrent()
      const state = this.runtime.inspect(ref)
      const resource = this.committedInputs.get(input.id)
      const presentation = this.presentationBindings.get(input.id)
      if (!resource || !presentation) throw new Error(`Conversation input resource is missing: ${input.id}`)
      if (
        ref.kind !== ConversationKind.Agent ||
        state.phase !== ConversationPhase.Running ||
        state.runMode !== ConversationRunMode.Preempting ||
        state.suspendEffectId !== suspendEffectId
      ) {
        throw new Error('Agent autonomous preemption was superseded before history commit')
      }
      const intent = application
        .get('AgentConnectionManager')
        .describeConversationAutonomous(ref.id, resource.request.headless === true)
      const turnId = toConversationTurnId(crypto.randomUUID())
      const executions = this.reserveExecutionIdentities([intent.modelId])
      const preview: ConversationCommand = {
        type: ConversationCommandType.RuntimeTurnCommitted,
        inputId: input.id,
        suspendEffectId,
        turnId,
        anchorNodeId: null,
        responder: input.responder,
        executions: this.provisionalExecutionPlans(ref, executions)
      }
      this.assertAdmissionPreview(ref, preview)
      const committed = agentChatContextProvider.commitRuntimeTurn(intent, presentation.subscriber)
      const plans = this.installCommittedExecutions(
        ref,
        turnId,
        committed,
        presentation.extraListeners ?? [],
        new Map(),
        executions
      )
      const reservation = committed.reservation
      const turn: TurnProjection = {
        ref,
        id: turnId,
        inputId: input.id,
        listeners: new Map(
          [...reservation.listeners, ...(presentation.extraListeners ?? [])].map((listener) => [listener.id, listener])
        ),
        cleanupPorts: reservation.cleanupPorts,
        executions: new Map(plans.map(({ projection }) => [projection.id, projection])),
        reservedMessages: reservation.reservedMessages,
        activeNodeDecision: { move: ConversationActiveNodeMove.Advance }
      }
      this.turns.set(this.turnKey(ref, turnId), turn)
      const transition = this.runtime.commitRuntimeTurn(
        ref,
        input,
        suspendEffectId,
        turnId,
        plans.map(({ plan }) => plan)
      )
      if (transition.rejection) {
        this.releaseTurn(turn)
        throw new Error(`Committed autonomous turn was rejected: ${transition.rejection}`)
      }
      this.deleteCommittedInput(input.id)
    })
  }

  private scheduleCommittedInput(ref: ConversationRef, input: ConversationInput, autonomous: boolean): Promise<void> {
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.RuntimeContinuation, async (operation) => {
      const resource = this.committedInputs.get(input.id)
      const presentation = this.presentationBindings.get(input.id)
      if (!resource || !presentation) throw new Error(`Conversation input resource is missing: ${input.id}`)
      if (this.isWriteQuiesced) return
      if (this.runtime.inspect(ref).phase !== ConversationPhase.Idle) {
        throw new Error('Conversation successor turn is no longer idle')
      }
      let committed: CommittedDispatch
      let admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.FreshTurn }>
      const turnKind =
        autonomous || resource.agentAutonomous ? ConversationTurnKind.RuntimeInitiated : ConversationTurnKind.Submit
      if (autonomous || resource.agentAutonomous) {
        if (ref.kind !== ConversationKind.Agent) throw new Error('Only Agent Conversations support autonomous turns')
        const intent = application
          .get('AgentConnectionManager')
          .describeConversationAutonomous(ref.id, resource.request.headless === true)
        admission = this.reserveFreshTurnCommit(ref, resource.request, [intent.modelId], turnKind, input)
        committed = agentChatContextProvider.commitRuntimeTurn(intent, presentation.subscriber)
      } else {
        const provider = this.providerFor(ref)
        const validation = await provider.validateDispatch(resource.request, { hasLiveStream: false }, operation.signal)
        operation.assertCurrent()
        if (this.isWriteQuiesced) return
        if (this.runtime.inspect(ref).phase !== ConversationPhase.Idle) {
          throw new Error('Conversation successor turn was superseded')
        }
        admission = this.reserveFreshTurnCommit(ref, resource.request, validation.executionModelIds, turnKind, input)
        committed = provider.commitDispatch(presentation.subscriber, validation, { hasLiveStream: false })
      }
      this.commitFreshDispatch(ref, resource.request, presentation.extraListeners ?? [], committed, admission, input)
      this.deleteCommittedInput(input.id)
    })
  }

  private scheduleCommittedStep(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    input: ConversationInput
  ): Promise<void> {
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.RuntimeContinuation, async (operation) => {
      const resource = this.committedInputs.get(input.id)
      const presentation = this.presentationBindings.get(input.id)
      if (!resource || !presentation) throw new Error(`Conversation step resource is missing: ${input.id}`)
      const initial = this.runtime.inspect(ref)
      if (initial.phase !== ConversationPhase.Running || initial.turn.id !== turnId) return
      let committed: CommittedDispatch
      let admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.NextStep }>
      if (resource.agentSegment) {
        if (ref.kind !== ConversationKind.Agent) throw new Error('Only Agent Conversations support native segments')
        const intent = application.get('AgentConnectionManager').describeConversationContinuation(ref.id)
        admission = this.reserveStepCommit(ref, turnId, input, [intent.modelId])
        committed = agentChatContextProvider.commitRuntimeTurn(intent, presentation.subscriber)
      } else {
        const provider = this.providerFor(ref)
        const validation = await provider.validateDispatch(resource.request, { hasLiveStream: false }, operation.signal)
        operation.assertCurrent()
        const current = this.runtime.inspect(ref)
        if (current.phase !== ConversationPhase.Running || current.turn.id !== turnId) return
        admission = this.reserveStepCommit(ref, turnId, input, validation.executionModelIds)
        committed = provider.commitDispatch(presentation.subscriber, validation, { hasLiveStream: false })
      }
      const plans = this.installCommittedExecutions(
        ref,
        turnId,
        committed,
        presentation.extraListeners ?? [],
        this.turns.get(this.turnKey(ref, turnId))?.listeners,
        admission.executions
      )
      const turn = this.turns.get(this.turnKey(ref, turnId))
      if (!turn) throw new Error('Conversation step projection is missing')
      for (const { projection } of plans) turn.executions.set(projection.id, projection)
      for (const listener of committed.reservation.listeners) turn.listeners.set(listener.id, listener)
      const transition = this.runtime.commitStep(
        ref,
        turnId,
        input.id,
        plans.map(({ plan }) => plan)
      )
      if (transition.rejection) {
        for (const { projection } of plans) {
          this.executionManager.release(ref, turnId, projection.id)
          turn.executions.delete(projection.id)
        }
        throw new Error(`Committed Conversation step was rejected: ${transition.rejection}`)
      }
      this.deleteCommittedInput(input.id)
    })
  }

  private actorFor(ref: ConversationRef): ConversationActor {
    const key = conversationRefKey(ref)
    let actor = this.actors.get(key)
    if (!actor) {
      actor = new ConversationActor(ref, () => this.onActorIdle(ref))
      this.actors.set(key, actor)
    }
    return actor
  }

  private onActorIdle(ref: ConversationRef): void {
    const key = conversationRefKey(ref)
    const turnId = this.deferredQuiescence.get(key)
    if (turnId && isConversationQuiescent(this.runtime.inspect(ref))) {
      this.deferredQuiescence.delete(key)
      this.trackPresentationOperation(`quiescence:${key}:${turnId}`, this.finalizeQuiescence(ref, turnId))
    }
    if (
      isConversationQuiescent(this.runtime.inspect(ref)) &&
      ![...this.committedInputs.values()].some((input) => conversationRefsEqual(input.request.conversation, ref))
    ) {
      this.actors.delete(key)
    }
  }

  private assertCommittedConversation(ref: ConversationRef, committed: CommittedDispatch): void {
    if (!conversationRefsEqual(ref, committed.reservation.conversation)) {
      throw new Error('History adapter committed another Conversation')
    }
  }

  private committedInputNodeId(ref: ConversationRef, committed: CommittedDispatch): string {
    this.assertCommittedConversation(ref, committed)
    const explicit = committed.reservation.pendingSteerUserMessageId
    if (explicit) return explicit
    const user = committed.reservation.reservedMessages?.findLast((message) => message.role === 'user')
    if (user) return user.id
    throw new Error('History adapter did not return the committed input identity')
  }

  private async persistTerminal(
    effect: PersistConversationTerminalEffect
  ): Promise<ConversationTerminalPersistenceResult> {
    const projection = this.executionProjection(effect.conversation, effect.turnId, effect.executionId)
    const result = this.executionManager.result(effect.conversation, effect.turnId, effect.executionId)
    const common = {
      finalMessage: result?.finalMessage,
      modelId: projection.modelId,
      anchorMessageId: projection.outputNodeId,
      runtimeTiming: result?.runtimeTiming,
      turnTerminal: false
    }
    try {
      for (const port of projection.persistencePorts) {
        if (effect.outcome.kind === ConversationOutcomeKind.Success) {
          await port.onDone({ ...common, status: ConversationOutcomeKind.Success })
        } else if (effect.outcome.kind === ConversationOutcomeKind.Paused) {
          await port.onPaused({ ...common, status: ConversationOutcomeKind.Paused })
        } else {
          await port.onError({ ...common, status: ConversationOutcomeKind.Error, error: effect.outcome.error })
        }
      }
      return { kind: ConversationTerminalPersistenceResultKind.Durable }
    } catch (error) {
      const serialized = error instanceof TerminalPersistenceError ? error.serializedError : serializeError(error)
      return { kind: ConversationTerminalPersistenceResultKind.Failed, error: serialized }
    }
  }

  private presentationPort(): ConversationPresentationPort {
    return {
      publishStatus: (effect) => this.publishStatus(effect),
      publishExecutionTerminal: (effect) =>
        this.trackPresentationOperation(
          `execution-terminal:${conversationRefKey(effect.conversation)}:${effect.turnId}:${effect.executionId}`,
          this.publishExecutionTerminal(effect)
        ),
      publishTurnTerminal: (effect) =>
        this.trackPresentationOperation(
          `turn-terminal:${conversationRefKey(effect.conversation)}:${effect.turnId}`,
          this.publishTurnTerminal(effect)
        ),
      publishQuiescence: (ref, turnId) => this.publishQuiescence(ref, turnId)
    }
  }

  private publishStatus(effect: PublishConversationStatusEffect): void {
    this.publishConversationStatus(effect.conversation, effect.turnId)
  }

  private async publishExecutionTerminal(effect: PublishConversationExecutionTerminalEffect): Promise<void> {
    const turn = this.turns.get(this.turnKey(effect.conversation, effect.turnId))
    const projection = turn?.executions.get(effect.executionId)
    const result = this.executionManager.result(effect.conversation, effect.turnId, effect.executionId)
    if (!turn || !projection) return
    const state = this.runtime.inspect(effect.conversation)
    const turnTerminal = state.phase === ConversationPhase.Idle
    const common = {
      finalMessage: result?.finalMessage,
      modelId: projection.modelId,
      conversation: effect.conversation,
      turnId: effect.turnId,
      executionId: effect.executionId,
      anchorMessageId: projection.outputNodeId,
      runtimeTiming: result?.runtimeTiming,
      turnTerminal
    }
    for (const listener of projection.listeners.values()) {
      if (
        effect.audience === ConversationTerminalAudience.InternalOnly &&
        listener.audience === StreamListenerAudience.ExternalDelivery
      ) {
        continue
      }
      if (!listener.isAlive()) continue
      try {
        if (effect.outcome.kind === ConversationOutcomeKind.Success) {
          await listener.onDone({ ...common, status: ConversationOutcomeKind.Success })
        } else if (effect.outcome.kind === ConversationOutcomeKind.Paused) {
          await listener.onPaused({ ...common, status: ConversationOutcomeKind.Paused })
        } else {
          await listener.onError({ ...common, status: ConversationOutcomeKind.Error, error: effect.outcome.error })
        }
      } catch (error) {
        logger.warn('Conversation listener terminal failed', { listenerId: listener.id, error })
      }
    }
  }

  private async publishTurnTerminal(effect: PublishConversationTurnTerminalEffect): Promise<void> {
    const turn = this.turns.get(this.turnKey(effect.conversation, effect.turnId))
    if (!turn) return
    const isFirstTerminal = turn.terminal === undefined
    const result = turn.terminal ?? this.turnTerminalResult(effect)
    turn.terminal = result
    if (isFirstTerminal) {
      this._onTurnTerminal.fire({
        conversation: effect.conversation,
        turnId: effect.turnId,
        outputNodeIds: [...turn.executions.values()].map((execution) => execution.outputNodeId),
        outcome: effect.outcome
      })
    }
    if (!effect.quiescent) {
      if (turn.cleanupTimer) clearTimeout(turn.cleanupTimer)
      turn.cleanupTimer = setTimeout(() => this.releaseTurn(turn), GRACE_PERIOD_MS)
      return
    }
    if (this.actors.get(conversationRefKey(effect.conversation))?.hasPendingAdmissions) {
      this.deferredQuiescence.set(conversationRefKey(effect.conversation), effect.turnId)
      return
    }
    await this.finalizeQuiescence(effect.conversation, effect.turnId)
  }

  private publishQuiescence(ref: ConversationRef, turnId: ConversationTurnId): void {
    if (this.actors.get(conversationRefKey(ref))?.hasPendingAdmissions) {
      this.deferredQuiescence.set(conversationRefKey(ref), turnId)
      return
    }
    this.trackPresentationOperation(
      `quiescence:${conversationRefKey(ref)}:${turnId}`,
      this.finalizeQuiescence(ref, turnId)
    )
  }

  private trackPresentationOperation(id: string, operation: Promise<void>): void {
    this.presentationOperations.set(id, operation)
    const release = () => {
      if (this.presentationOperations.get(id) === operation) this.presentationOperations.delete(id)
    }
    void operation.then(release, release)
  }

  private inFlightOperations(): Array<{ id: string; run: Promise<unknown> }> {
    const runs: Array<{ id: string; run: Promise<unknown> }> = []
    for (const actor of this.actors.values()) {
      if (actor.hasPendingAdmissions) {
        runs.push({ id: `admission:${conversationRefKey(actor.conversation)}`, run: actor.inFlightAdmission })
      }
    }
    this.executionManager.inFlightRuns().forEach((run, index) => runs.push({ id: `execution:${index}`, run }))
    this.runtime.inFlightPersistenceRuns().forEach((run, index) => runs.push({ id: `persistence:${index}`, run }))
    for (const [id, run] of this.presentationOperations) runs.push({ id, run })
    return runs
  }

  private async finalizeQuiescence(ref: ConversationRef, turnId: ConversationTurnId): Promise<void> {
    const turn = this.turns.get(this.turnKey(ref, turnId))
    if (!turn?.terminal || turn.quiescencePublished) return
    turn.quiescencePublished = true
    for (const port of turn.cleanupPorts) {
      try {
        await port.onTopicQuiesced(turn.terminal)
      } catch (error) {
        logger.warn('Conversation cleanup port failed', { cleanupPortId: port.id, error })
      }
    }
    const state = this.runtime.inspect(ref)
    const stillOwnsPublishedState =
      state.phase === ConversationPhase.Idle ? state.lastTurnId === turnId : state.turn.id === turnId
    if (!stillOwnsPublishedState) {
      if (turn.cleanupTimer) clearTimeout(turn.cleanupTimer)
      turn.cleanupTimer = setTimeout(() => this.releaseTurn(turn), GRACE_PERIOD_MS)
      return
    }
    this.publishConversationStatus(
      ref,
      turnId,
      turn.terminal.status === ConversationOutcomeKind.Success
        ? ConversationStatus.Done
        : turn.terminal.status === ConversationOutcomeKind.Paused
          ? ConversationStatus.Aborted
          : ConversationStatus.Error
    )
    if (ref.kind === ConversationKind.Chat && turn.terminal.status === ConversationOutcomeKind.Success) {
      this._onConversationCompleted.fire({ conversation: ref, turnId, completedAt: Date.now() })
    }
    if (turn.cleanupTimer) clearTimeout(turn.cleanupTimer)
    turn.cleanupTimer = setTimeout(() => this.releaseTurn(turn), GRACE_PERIOD_MS)
  }

  private afterTransition(
    ref: ConversationRef,
    command: ConversationCommand,
    transition: ConversationTransition
  ): void {
    if (transition.rejection) return
    switch (command.type) {
      case ConversationCommandType.TurnCommitted:
      case ConversationCommandType.RuntimeTurnCommitted:
      case ConversationCommandType.StepCommitted:
      case ConversationCommandType.ExecutionsAdded:
        this.deferredQuiescence.delete(conversationRefKey(ref))
        this.publishConversationStatus(ref, command.turnId, ConversationStatus.Pending)
        return
      case ConversationCommandType.PersistenceSucceeded:
      case ConversationCommandType.RuntimeOwnershipReleased:
      case ConversationCommandType.RuntimeTurnCommitFailed:
        if (
          transition.state.phase === ConversationPhase.Running &&
          transition.state.runMode === ConversationRunMode.Foreground
        ) {
          this.publishConversationStatus(ref, transition.state.turn.id, ConversationStatus.Pending)
        }
        return
      default:
        return
    }
  }

  private providerFor(conversation: ConversationRef) {
    const provider = this.providers.find((candidate) => candidate.canHandle(conversation))
    if (!provider) throw new Error(`No Conversation history provider can handle ${conversationRefKey(conversation)}`)
    return provider
  }

  private addListener(ref: ConversationRef, listener: StreamListener): void {
    const turn = this.latestTurn(ref)
    if (!turn) return
    turn.listeners.set(listener.id, listener)
    for (const projection of turn.executions.values()) {
      const bound = listener.createForExecution?.(projection.id) ?? listener
      projection.listeners.set(bound.id, bound)
      this.executionManager.observe(ref, turn.id, this.observerForExecution(projection.id, projection, bound))
    }
  }

  private bindExecutionListeners(
    listeners: ReadonlyMap<string, StreamListener>,
    executionId: ConversationExecutionId
  ): Map<string, StreamListener> {
    const bound = new Map<string, StreamListener>()
    for (const listener of listeners.values()) {
      const executionListener = listener.createForExecution?.(executionId) ?? listener
      bound.set(executionListener.id, executionListener)
    }
    return bound
  }

  private observerForListener(ref: ConversationRef, listener: StreamListener): ConversationExecutionObserver {
    return {
      id: listener.id,
      isAlive: () => listener.isAlive(),
      onChunk: (payload) => {
        const projection = this.executionProjection(ref, payload.turnId, payload.executionId)
        listener.onChunk(payload.chunk, {
          conversation: payload.conversation,
          turnId: payload.turnId,
          executionId: payload.executionId,
          modelId: projection.modelId,
          outputNodeId: projection.outputNodeId,
          chunkSeq: payload.chunkSeq,
          throughChunkSeq: payload.chunkSeq
        })
      }
    }
  }

  private redirectAgentInput(ref: ConversationRef, input: ConversationInput): boolean {
    if (ref.kind !== ConversationKind.Agent) return false
    const resource = this.committedInputs.get(input.id)
    const message = resource?.request.agentDeliveryMessage
    if (!message || resource.request.trigger !== ConversationOpenTrigger.SubmitMessage) return false
    const redirected = application.get('AgentConnectionManager').redirectConversationInput(ref.id, message, {
      headless: resource.request.headless,
      reasoningEffort: resource.request.reasoningEffort,
      fastMode: resource.request.fastMode
    })
    if (redirected) this.committedInputs.set(input.id, { ...resource, agentSegment: true })
    return redirected
  }

  private deleteCommittedInput(inputId: ConversationInput['id']): void {
    this.committedInputs.delete(inputId)
    this.presentationBindings.delete(inputId)
  }

  private deleteCommittedInputsFor(ref: ConversationRef): void {
    for (const [inputId, input] of this.committedInputs) {
      if (conversationRefsEqual(input.request.conversation, ref))
        this.deleteCommittedInput(toConversationInputId(inputId))
    }
  }

  private kickRetainedInputs(): void {
    const refs = new Map<string, ConversationRef>()
    for (const input of this.committedInputs.values()) {
      refs.set(conversationRefKey(input.request.conversation), input.request.conversation)
    }
    for (const ref of refs.values()) this.runtime.kickInbox(ref)
  }

  private observerForExecution(
    executionId: ConversationExecutionId,
    projection: ExecutionProjection,
    listener: StreamListener
  ): ConversationExecutionObserver {
    return {
      id: listener.id,
      isAlive: () => listener.isAlive(),
      onChunk: (payload) => {
        if (payload.executionId !== executionId) return
        listener.onChunk(payload.chunk, {
          conversation: payload.conversation,
          turnId: payload.turnId,
          executionId: payload.executionId,
          modelId: projection.modelId,
          outputNodeId: projection.outputNodeId,
          chunkSeq: payload.chunkSeq,
          throughChunkSeq: payload.chunkSeq
        })
      }
    }
  }

  private controlObserver(
    ref: ConversationRef,
    executionId: ConversationExecutionId,
    projection: ExecutionProjection
  ): ConversationExecutionObserver {
    const published = new Set<string>()
    return {
      id: `conversation-control:${executionId}`,
      isAlive: () => true,
      onChunk: ({ chunk }) => {
        if (chunk.type !== 'tool-approval-request' || published.has(chunk.approvalId)) return
        published.add(chunk.approvalId)
        this._onApprovalRequested.fire({
          conversation: ref,
          approvalId: chunk.approvalId,
          requestedAt: Date.now()
        })
        void projection
      }
    }
  }

  private turnTerminalResult(
    effect: PublishConversationTurnTerminalEffect
  ): StreamDoneResult | StreamPausedResult | StreamErrorResult {
    if (effect.outcome.kind === ConversationOutcomeKind.Success) {
      return { status: ConversationOutcomeKind.Success, turnTerminal: true }
    }
    if (effect.outcome.kind === ConversationOutcomeKind.Paused) {
      return { status: ConversationOutcomeKind.Paused, turnTerminal: true }
    }
    return { status: ConversationOutcomeKind.Error, turnTerminal: true, error: effect.outcome.error }
  }

  private executionAttachTerminal(
    outcome: ConversationOutcome,
    finalMessage?: StreamDoneResult['finalMessage']
  ): ExecutionAttachTerminal {
    if (outcome.kind === ConversationOutcomeKind.Success) {
      return { status: ConversationStreamTerminalStatus.Done, ...(finalMessage ? { finalMessage } : {}) }
    }
    if (outcome.kind === ConversationOutcomeKind.Paused) {
      return { status: ConversationStreamTerminalStatus.Paused, ...(finalMessage ? { finalMessage } : {}) }
    }
    return {
      status: ConversationStreamTerminalStatus.Error,
      error: outcome.error,
      ...(finalMessage ? { finalMessage } : {})
    }
  }

  private streamAttachTerminal(
    result: StreamDoneResult | StreamPausedResult | StreamErrorResult
  ): ExecutionAttachTerminal {
    if (result.status === ConversationOutcomeKind.Success) {
      return {
        status: ConversationStreamTerminalStatus.Done,
        ...(result.finalMessage ? { finalMessage: result.finalMessage } : {})
      }
    }
    if (result.status === ConversationOutcomeKind.Paused) {
      return {
        status: ConversationStreamTerminalStatus.Paused,
        ...(result.finalMessage ? { finalMessage: result.finalMessage } : {})
      }
    }
    return {
      status: ConversationStreamTerminalStatus.Error,
      error: result.error,
      ...(result.finalMessage ? { finalMessage: result.finalMessage } : {})
    }
  }

  private publishConversationStatus(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    forced?: ConversationStatus
  ): void {
    const state = this.runtime.inspect(ref)
    const turn = this.turns.get(this.turnKey(ref, turnId))
    if (!turn) return
    const activeExecutions =
      state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping
        ? [...state.turn.executions.values()].flatMap((execution) => {
            if (
              execution.phase !== ConversationExecutionPhase.Starting &&
              execution.phase !== ConversationExecutionPhase.Active &&
              execution.phase !== ConversationExecutionPhase.WaitingInteraction
            )
              return []
            const projection = turn.executions.get(execution.id)
            return projection
              ? [
                  {
                    turnId,
                    executionId: execution.id,
                    modelId: projection.modelId,
                    outputNodeId: projection.outputNodeId
                  }
                ]
              : []
          })
        : []
    const awaitingInteractionExecutions =
      state.phase === ConversationPhase.Running
        ? [...state.turn.executions.values()].flatMap((execution) => {
            if (execution.phase !== ConversationExecutionPhase.WaitingInteraction) return []
            const projection = turn.executions.get(execution.id)
            return projection
              ? [
                  {
                    turnId,
                    executionId: execution.id,
                    modelId: projection.modelId,
                    outputNodeId: projection.outputNodeId
                  }
                ]
              : []
          })
        : []
    const status: ConversationStatus =
      forced ??
      (awaitingInteractionExecutions.length > 0
        ? ConversationStatus.AwaitingInteraction
        : activeExecutions.some((execution) => {
              const current =
                state.phase === ConversationPhase.Running ? state.turn.executions.get(execution.executionId) : undefined
              return current?.phase === ConversationExecutionPhase.Active
            })
          ? ConversationStatus.Streaming
          : ConversationStatus.Pending)
    const cache = application.get('CacheService')
    const key = `conversation.statuses.${conversationRefKey(ref)}` as const
    const previous = cache.getShared(key)
    cache.setShared(key, {
      status,
      turnId,
      activeExecutions,
      awaitingInteractionExecutions,
      lastCompletedAt: status === ConversationStatus.Done ? Date.now() : previous?.lastCompletedAt
    })
  }

  private executionProjection(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId
  ): ExecutionProjection {
    const projection = this.turns.get(this.turnKey(ref, turnId))?.executions.get(executionId)
    if (!projection) throw new Error(`Missing Conversation execution projection ${executionId}`)
    return projection
  }

  private latestTurn(ref: ConversationRef): TurnProjection | undefined {
    const state = this.runtime.inspect(ref)
    if (state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping) {
      const current = this.turns.get(this.turnKey(ref, state.turn.id))
      if (current) return current
    }
    const prefix = `${conversationRefKey(ref)}\0`
    return [...this.turns.entries()].findLast(([key]) => key.startsWith(prefix))?.[1]
  }

  private releaseTurn(turn: TurnProjection): void {
    for (const execution of turn.executions.values()) this.executionManager.release(turn.ref, turn.id, execution.id)
    this.turns.delete(this.turnKey(turn.ref, turn.id))
    this.runtime.forgetIfQuiescent(turn.ref, turn.id)
  }

  private turnKey(ref: ConversationRef, turnId: ConversationTurnId): string {
    return `${conversationRefKey(ref)}\0${turnId}`
  }

  private activeConversationRefs(): ConversationRef[] {
    const refs = new Map<string, ConversationRef>()
    for (const actor of this.actors.values()) {
      if (actor.hasPendingAdmissions) refs.set(conversationRefKey(actor.conversation), actor.conversation)
    }
    for (const turn of this.turns.values()) {
      if (this.runtime.inspect(turn.ref).phase !== ConversationPhase.Idle)
        refs.set(conversationRefKey(turn.ref), turn.ref)
    }
    for (const input of this.committedInputs.values()) {
      refs.set(conversationRefKey(input.request.conversation), input.request.conversation)
    }
    return [...refs.values()]
  }
}
