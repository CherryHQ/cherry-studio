import { application } from '@application'
import { loggerService } from '@logger'
import { isAgentSessionWorkspaceError } from '@main/ai/runtime/agentSessionWorkspace'
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
import { topicNamingService } from '@main/services/TopicNamingService'
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
  type ConversationTerminalDurability,
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
  AiStreamAttachResponse,
  AiStreamOpenResponse,
  ApprovalDecision,
  ExecutionAttachTerminal,
  ExecutionReplayCursor
} from '@shared/ai/transport'
import type { MessageRuntimeSpan } from '@shared/data/types/message'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../streamManager'
import {
  agentChatContextProvider,
  type CommittedConversationIntent,
  type ConversationAfterPersistTaskDescriptor,
  ConversationAfterPersistTaskKind,
  type ConversationCompletedEvent,
  ConversationExecutionDriverBindingKind,
  ConversationExecutionMutationKind,
  ConversationHistoryAdapterKind,
  type ConversationHistoryPort,
  ConversationInteractionCommitResultKind,
  type ConversationNamingPostCommitTaskDescriptor,
  type ConversationPostCommitTaskDescriptor,
  ConversationPostCommitTaskKind,
  type ConversationTraceFlushTaskDescriptor,
  type MainContinueConversationRequest,
  type MainDispatchRequest,
  persistentChatContextProvider,
  StreamListenerAudience,
  temporaryChatContextProvider,
  TerminalPersistenceError,
  TraceFlushListener,
  type ValidatedConversationIntent,
  WebContentsListener
} from '../streamManager'
import { AiExecutionManager, type ConversationExecutionObserver } from './AiExecutionManager'
import {
  ConversationActor,
  ConversationAdmissionOperationKind,
  type ConversationDispatchCommitReservation,
  ConversationExecutionAdmissionKind,
  ConversationHistoryCommitKind,
  type ConversationHistoryCommitReservation,
  type ConversationStopHandle,
  type ReservedExecutionIdentity
} from './ConversationActor'
import { ConversationAdmissionError } from './ConversationAdmissionError'
import { ConversationBindingRegistry } from './ConversationBindingRegistry'
import { ConversationExecutionResourcePort } from './ConversationExecutionResourcePort'
import type {
  ConversationPresentationPort,
  ConversationRuntimeIdFactory,
  ConversationRuntimePortSet,
  ConversationTerminalPersistencePort,
  ConversationTerminalPersistenceResult,
  PersistConversationTerminalEffect,
  PublishConversationExecutionTerminalEffect,
  PublishConversationStatusEffect,
  PublishConversationTurnTerminalEffect,
  StartConversationExecutionEffect
} from './conversationPorts'
import { ConversationTerminalPersistenceResultKind } from './conversationPorts'
import {
  type ConversationExecutionProjection as ExecutionProjection,
  ConversationPresentationRegistry,
  type ConversationTurnProjection as TurnProjection
} from './ConversationPresentationRegistry'
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
  createConversationState,
  isConversationQuiescent
} from './conversationState'

const logger = loggerService.withContext('ConversationRuntimeService')
const GRACE_PERIOD_MS = 30_000
const PERSISTENCE_RETRY_INTERVAL_MS = 5_000

const nullStreamListener: StreamListener = {
  id: 'conversation:null',
  onChunk: () => {},
  onDone: () => {},
  onPaused: () => {},
  onError: () => {},
  isAlive: () => false
}

export interface ConversationTurnTerminalEvent {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly outputNodeIds: readonly string[]
  readonly outcome: ConversationOutcome
  readonly durability: ConversationTerminalDurability
}

export interface AgentConversationInteractionState {
  readonly currentTurn: AgentInteractionTurnKind
  readonly userResponse: AgentUserResponseMode
}

export interface ConversationQuiescenceTaskExecutor {
  execute(
    task: ConversationTraceFlushTaskDescriptor,
    terminal: StreamDoneResult | StreamPausedResult | StreamErrorResult
  ): Promise<void>
}

export interface ConversationNamingTaskExecutor {
  executePostCommit(task: ConversationNamingPostCommitTaskDescriptor): Promise<void>
  executeAfterPersist(task: ConversationAfterPersistTaskDescriptor, finalMessage: CherryUIMessage): Promise<void>
}

const traceQuiescenceTaskExecutor: ConversationQuiescenceTaskExecutor = {
  async execute(task, terminal) {
    await new TraceFlushListener(task.conversationId).onTopicQuiesced(terminal)
  }
}

const conversationNamingTaskExecutor: ConversationNamingTaskExecutor = {
  async executePostCommit(task) {
    switch (task.kind) {
      case ConversationPostCommitTaskKind.RenameChatFromFirstUser:
        topicNamingService.maybeRenameFromFirstUserMessage(task.topicId, task.userMessageId)
        return
      case ConversationPostCommitTaskKind.RenameAgentFromFirstUser:
        topicNamingService.maybeRenameAgentSessionFromFirstUserMessage(task.sessionId, task.userMessageData)
        return
    }
  },
  async executeAfterPersist(task, finalMessage) {
    switch (task.kind) {
      case ConversationAfterPersistTaskKind.RenameChatFromSummary:
        await topicNamingService.maybeRenameFromConversationSummary(
          task.topicId,
          task.assistantId,
          task.userMessageId,
          finalMessage
        )
        return
      case ConversationAfterPersistTaskKind.RenameAgentFromSummary:
        await topicNamingService.maybeRenameAgentSession(task.agentId, task.sessionId, task.userText, finalMessage)
        return
    }
  }
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
  private readonly _onCrashRecoveryCompleted = new Emitter<void>()
  readonly onCrashRecoveryCompleted: Event<void> = this._onCrashRecoveryCompleted.event
  private readonly executionManager: AiExecutionManager
  private readonly executionResources: ConversationExecutionResourcePort
  private readonly providers: readonly ConversationHistoryPort[]
  private readonly ids: ConversationRuntimeIdFactory
  private readonly ports: ConversationRuntimePortSet
  private readonly quiescenceTasks: ConversationQuiescenceTaskExecutor
  private readonly namingTasks: ConversationNamingTaskExecutor
  private readonly actors = new Map<string, ConversationActor>()
  private readonly bindings = new ConversationBindingRegistry()
  private readonly presentation = new ConversationPresentationRegistry()
  private readonly pauseHolds = new Set<symbol>()
  private readonly bootRecoveryAbort = new AbortController()
  private bootRecoveryOperation: Promise<void> | undefined
  private crashRecoveryComplete = false

  constructor(
    dependencies: {
      executionManager?: AiExecutionManager
      providers?: readonly ConversationHistoryPort[]
      quiescenceTasks?: ConversationQuiescenceTaskExecutor
      namingTasks?: ConversationNamingTaskExecutor
    } = {}
  ) {
    super()
    this.executionManager = dependencies.executionManager ?? new AiExecutionManager()
    this.executionResources = new ConversationExecutionResourcePort(this.executionManager, (effect) =>
      this.executionResourceDescriptor(effect)
    )
    this.executionManager.setDriverControl({
      redirect: (effect) => this.redirectAgentInput(effect.conversation, effect.input)
    })
    this.providers = dependencies.providers ?? [
      agentChatContextProvider,
      temporaryChatContextProvider,
      persistentChatContextProvider
    ]
    this.quiescenceTasks = dependencies.quiescenceTasks ?? traceQuiescenceTaskExecutor
    this.namingTasks = dependencies.namingTasks ?? conversationNamingTaskExecutor
    this.ids = {
      turn: () => toConversationTurnId(crypto.randomUUID()),
      execution: () => toConversationExecutionId(crypto.randomUUID()),
      effect: () => toConversationEffectId(crypto.randomUUID()),
      interaction: () => toConversationInteractionId(crypto.randomUUID()),
      input: () => toConversationInputId(crypto.randomUUID())
    }
    this.ports = {
      terminalPersistence: this.terminalPersistencePort(),
      execution: this.executionResources,
      presentation: this.presentationPort(),
      scheduleNextTurn: (ref, input) => {
        if (this.isWriteQuiesced) return
        void this.scheduleCommittedInput(ref, input, false).catch((error) => {
          this.handleScheduledInputFailure(ref, input)
          logger.warn('Conversation successor admission failed', { conversation: conversationRefKey(ref), error })
        })
      },
      scheduleNextStep: (ref, turnId, input) => {
        void this.scheduleCommittedStep(ref, turnId, input).catch((error) => {
          this.deleteCommittedInput(input.id)
          this.actorFor(ref).failStep(turnId, input.id, serializeError(error))
          logger.warn('Conversation step admission failed', { conversation: conversationRefKey(ref), turnId, error })
        })
      },
      dropInputs: (_ref, inputs) => {
        for (const input of inputs) this.deleteCommittedInput(input.id)
      },
      scheduleRuntimeTurn: (ref, input, suspendEffectId) => {
        void this.scheduleAutonomousTurn(ref, input, suspendEffectId).catch((error) => {
          this.deleteCommittedInput(input.id)
          this.actorFor(ref).failRuntimeTurnCommit(suspendEffectId)
          logger.warn('Agent autonomous turn commit failed', {
            conversation: conversationRefKey(ref),
            error
          })
        })
      }
    }
  }

  protected async onInit(): Promise<void> {
    this.startCrashRecovery()
    this.registerInterval(() => {
      for (const actor of this.actors.values()) actor.retryBlockedPersistence()
    }, PERSISTENCE_RETRY_INTERVAL_MS)
  }

  private startCrashRecovery(): void {
    if (this.bootRecoveryOperation) return
    this.bootRecoveryOperation = (async () => {
      while (!this.crashRecoveryComplete && !this.bootRecoveryAbort.signal.aborted) {
        try {
          const repairedOutputs = this.providers.flatMap(
            (provider) => provider.recoverCrashOrphans?.().repairedOutputs ?? []
          )
          this.crashRecoveryComplete = true
          logger.info('Conversation crash recovery completed', { repairedOutputCount: repairedOutputs.length })
          this._onCrashRecoveryCompleted.fire()
        } catch (error) {
          if (this.bootRecoveryAbort.signal.aborted) break
          logger.error('Conversation crash recovery failed; retrying', { error })
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer)
              this.bootRecoveryAbort.signal.removeEventListener('abort', done)
              resolve()
            }
            const timer = setTimeout(done, PERSISTENCE_RETRY_INTERVAL_MS)
            this.bootRecoveryAbort.signal.addEventListener('abort', done, { once: true })
          })
        }
      }
    })().finally(() => {
      this.bootRecoveryOperation = undefined
    })
  }

  get isCrashRecoveryComplete(): boolean {
    return this.crashRecoveryComplete
  }

  protected async onStop(): Promise<void> {
    this.bootRecoveryAbort.abort('conversation-runtime-stop')
    const hold = this.pause('app-shutdown')
    try {
      for (const ref of this.activeConversationRefs()) this.stop(ref, 'app-shutdown')
      await this.drainInFlight({ timeoutMs: 30_000 })
    } finally {
      hold.dispose()
    }
  }

  protected onDestroy(): void {
    this.bootRecoveryAbort.abort('conversation-runtime-destroy')
    this._onApprovalRequested.dispose()
    this._onConversationCompleted.dispose()
    this._onTurnTerminal.dispose()
    this._onCrashRecoveryCompleted.dispose()
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
      const initial = this.inspect(ref)
      if (initial.phase === ConversationPhase.Stopping) throw new Error('Conversation is stopping')
      if (policy.requireIdle && initial.phase !== ConversationPhase.Idle) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy)
      }
      const dispatchContext = {
        hasLiveStream: initial.phase === ConversationPhase.Running,
        ...(policy.requireIdle ? { requireIdle: true } : {}),
        ...(policy.expectedAgentId ? { expectedAgentId: policy.expectedAgentId } : {})
      }
      let validation
      try {
        validation = await provider.validateIntent(request, dispatchContext, operation.signal)
      } catch (error) {
        if (isAgentSessionWorkspaceError(error)) {
          return {
            mode: ConversationOpenMode.Blocked,
            reason: ConversationBlockReason.AgentSessionWorkspace,
            message: error.message
          }
        }
        throw error
      }
      operation.assertCurrent()
      const state = this.inspect(ref)
      if (state.phase === ConversationPhase.Stopping) throw new Error('Conversation is stopping')
      if (policy.requireIdle && state.phase !== ConversationPhase.Idle) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy)
      }
      const hasLiveStream = state.phase === ConversationPhase.Running
      const liveMutation =
        validation.kind === ConversationHistoryAdapterKind.PersistentChat ? validation.liveExecutionMutation : undefined
      const reservation = this.actorFor(ref).reserveDispatch({
        turnKind:
          request.trigger === ConversationOpenTrigger.RegenerateMessage
            ? ConversationTurnKind.Regenerate
            : ConversationTurnKind.Submit,
        anchorNodeId: 'parentAnchorId' in request ? (request.parentAnchorId ?? null) : null,
        responder: request.headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive,
        executionModelIds: validation.executionModelIds,
        ...(liveMutation
          ? {
              executionMutation: {
                kind:
                  liveMutation.kind === ConversationExecutionMutationKind.Retry
                    ? ConversationExecutionAdmissionKind.Retry
                    : ConversationExecutionAdmissionKind.Append,
                outputNodeId: liveMutation.outputNodeId,
                persistedSiblingsGroupId: liveMutation.persistedSiblingsGroupId
              }
            }
          : {}),
        runtimeCanRedirect: ref.kind === ConversationKind.Agent && request.headless !== true
      })
      const committed = provider.commitIntent(validation, { ...dispatchContext, hasLiveStream })
      operation.assertCurrent()
      if (reservation.kind === ConversationHistoryCommitKind.FreshTurn) {
        return this.commitFreshDispatch(ref, request, subscriber, extraListeners, committed, reservation, provider)
      }
      return this.commitActiveDispatch(
        ref,
        subscriber,
        request,
        extraListeners,
        validation,
        committed,
        reservation,
        provider
      )
    })
  }

  async dispatchAgentDelivery(
    subscriber: StreamListener,
    message: ReturnType<typeof agentSessionMessageService.getSessionMessage>
  ): Promise<AiStreamOpenResponse | undefined> {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: message.sessionId }
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.Dispatch, async (operation) => {
      if (this.isWriteQuiesced || this.inspect(ref).phase !== ConversationPhase.Idle) return undefined
      const request: MainDispatchRequest = {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation: ref,
        userMessageParts: message.data.parts ?? [],
        headless: true,
        agentDeliveryMessage: message
      }
      const provider = this.providerFor(ref)
      const validation = await provider.validateIntent(
        request,
        { hasLiveStream: false, requireIdle: true },
        operation.signal
      )
      operation.assertCurrent()
      if (this.inspect(ref).phase !== ConversationPhase.Idle) return undefined
      const reservation = this.actorFor(ref).reserveFreshTurn({
        executionModelIds: validation.executionModelIds,
        turnKind: ConversationTurnKind.Submit,
        anchorNodeId: null,
        responder: ConversationResponderKind.Headless
      })
      const committed = provider.commitIntent(validation, { hasLiveStream: false, requireIdle: true })
      operation.assertCurrent()
      return this.commitFreshDispatch(ref, request, subscriber, [], committed, reservation, provider)
    })
  }

  stop(ref: ConversationRef, reason: string): ConversationStopHandle {
    const actor = this.actors.get(conversationRefKey(ref))
    if (!actor) return { accepted: false, completed: Promise.resolve() }
    const handle = actor.stop(reason)
    this.deleteCommittedInputsFor(ref)
    return handle
  }

  abort(ref: ConversationRef, reason: string): boolean {
    if (!this.hasLiveConversation(ref)) return false
    return this.stop(ref, reason).accepted
  }

  hasLiveConversation(ref: ConversationRef): boolean {
    const actor = this.actors.get(conversationRefKey(ref))
    return (
      this.inspect(ref).phase !== ConversationPhase.Idle ||
      actor?.hasPendingAdmissions === true ||
      actor?.hasPendingOperations === true
    )
  }

  hasLiveStream(topicId: string): boolean {
    return this.hasLiveConversation({ kind: ConversationKind.Chat, id: topicId })
  }

  hasPendingChatInput(topicId: string): boolean {
    const state = this.inspect({ kind: ConversationKind.Chat, id: topicId })
    return state.inbox.nextTurn.length > 0
  }

  hasTerminalPersistenceInFlight(ref: ConversationRef): boolean {
    const state = this.inspect(ref)
    return (
      (state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping) &&
      [...state.turn.executions.values()].some((execution) => execution.phase === ConversationExecutionPhase.Persisting)
    )
  }

  private canContinueInteraction(ref: ConversationRef, approvalId: string): boolean {
    const state = this.inspect(ref)
    if (state.phase === ConversationPhase.Idle) return true
    if (state.phase !== ConversationPhase.Running) return false
    const interaction = state.turn.interactions.get(toConversationInteractionId(approvalId))
    if (!interaction) return false
    const execution = state.turn.executions.get(interaction.executionId)
    return execution?.phase === ConversationExecutionPhase.WaitingInteraction
  }

  resolveAgentInteraction(sessionId: string, approvalId: string): boolean {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    return this.actorFor(ref).resolveInteraction(toConversationInteractionId(approvalId)).rejection === undefined
  }

  enqueueAgentUndelivered(sessionId: string, userMessageId: string): void {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    const resourceEntry = this.bindings.findAgentDelivery(ref, userMessageId)
    if (!resourceEntry) {
      logger.warn('Undelivered Agent steer lost its Conversation input', { sessionId, userMessageId })
      return
    }
    this.actorFor(ref).rejectRedirectedInput(toConversationInputId(resourceEntry[0]))
  }

  startAgentAutonomous(sessionId: string, headless?: boolean): boolean {
    if (this.isWriteQuiesced) return false
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    const isHeadless =
      headless ?? this.getAgentInteractionState(sessionId).userResponse === AgentUserResponseMode.Unavailable
    const inputId = toConversationInputId(crypto.randomUUID())
    const input: ConversationInput = {
      id: inputId,
      historyNodeId: `autonomous:${inputId}`,
      provenance: ConversationInputProvenance.Runtime,
      responder: isHeadless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive
    }
    this.bindings.setInput(inputId, {
      request: {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation: ref,
        userMessageParts: [],
        headless: isHeadless
      },
      agentAutonomous: true
    })
    this.actorFor(ref).rememberCommittedInput(inputId)
    this.presentation.bindInput(inputId, { subscriber: nullStreamListener })
    if (this.inspect(ref).phase === ConversationPhase.Idle) {
      void this.scheduleCommittedInput(ref, input, true).catch((error) => {
        this.deleteCommittedInput(inputId)
        logger.warn('Agent autonomous Conversation admission failed', { sessionId, error })
      })
      return true
    }
    const transition = this.actorFor(ref).requestRuntimePreemption(input)
    if (transition.rejection) {
      this.deleteCommittedInput(inputId)
      return false
    }
    const state = this.inspect(ref)
    if (
      state.phase !== ConversationPhase.Running ||
      state.runMode !== ConversationRunMode.Preempting ||
      state.runtimeInput.id !== inputId
    ) {
      this.deleteCommittedInput(inputId)
      return false
    }
    return true
  }

  releaseAgentRuntimeOwnership(sessionId: string, suspendEffectId: ConversationEffectId): void {
    this.actorFor({ kind: ConversationKind.Agent, id: sessionId }).releaseRuntimeOwnership(suspendEffectId)
  }

  openAgentActivity(
    sessionId: string,
    kind: ConversationActivityKind,
    responder?: ConversationResponderKind
  ): ConversationActivityId {
    const ref: ConversationRef = { kind: ConversationKind.Agent, id: sessionId }
    const id = toConversationActivityId(crypto.randomUUID())
    this.actorFor(ref).openActivity({ id, kind, ...(responder ? { responder } : {}) })
    return id
  }

  closeAgentActivity(sessionId: string, activityId: ConversationActivityId): void {
    this.actorFor({ kind: ConversationKind.Agent, id: sessionId }).closeActivity(activityId)
  }

  getAgentInteractionState(sessionId: string): AgentConversationInteractionState {
    const state = this.inspect({ kind: ConversationKind.Agent, id: sessionId })
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
      const initial = this.inspect(ref)
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
        const duplicateState = this.inspect(ref)
        if (
          duplicateState.phase !== ConversationPhase.Running ||
          !duplicateState.turn.interactions.has(toConversationInteractionId(decision.approvalId))
        ) {
          return true
        }
      }
      if (continuation === ConversationInteractionCommitResultKind.Pending) {
        const state = this.inspect(ref)
        if (state.phase !== ConversationPhase.Running) return true
        const interactionId = toConversationInteractionId(decision.approvalId)
        const interaction = state.turn.interactions.get(interactionId)
        if (!interaction) return false
        const admission = this.actorFor(ref).reserveInteraction(state.turn.id, interactionId, interaction.executionId)
        return (
          this.actorFor(ref).resolveInteraction(interactionId, admission.resumeEffectId, admission.statusEffectId)
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
      const validation = await provider.validateIntent(request, { hasLiveStream: false }, operation.signal)
      operation.assertCurrent()
      const state = this.inspect(ref)
      if (state.phase === ConversationPhase.Idle) {
        const admission = this.actorFor(ref).reserveFreshTurn({
          executionModelIds: validation.executionModelIds,
          turnKind: ConversationTurnKind.Submit,
          anchorNodeId: request.parentAnchorId,
          responder: ConversationResponderKind.Interactive
        })
        const committed = provider.commitIntent(validation, { hasLiveStream: false })
        this.commitFreshDispatch(ref, request, subscriber, [], committed, admission, provider)
        return true
      }
      if (state.phase !== ConversationPhase.Running) return false
      const interactionId = toConversationInteractionId(decision.approvalId)
      const interaction = state.turn.interactions.get(interactionId)
      if (!interaction || !this.canContinueInteraction(ref, decision.approvalId)) return false
      if (validation.executionModelIds.length !== 1) {
        throw new Error('Interaction continuation must reserve one execution')
      }
      const admission = this.actorFor(ref).reserveInteraction(state.turn.id, interactionId, interaction.executionId)
      const committed = provider.commitIntent(validation, { hasLiveStream: false })
      this.commitInteractionExecution(
        ref,
        state.turn.id,
        interaction.executionId,
        interactionId,
        committed,
        admission,
        provider,
        subscriber
      )
      return true
    })
  }

  inspect(ref: ConversationRef): ConversationState {
    return this.actors.get(conversationRefKey(ref))?.inspect() ?? createConversationState(ref)
  }

  attach(
    sender: Electron.WebContents,
    ref: ConversationRef,
    cursors: readonly ExecutionReplayCursor[] = []
  ): AiStreamAttachResponse {
    const listener: StreamListener = new WebContentsListener(sender, ref)
    const turn = this.latestTurn(ref)
    if (!turn) return { status: ConversationAttachStatus.NotFound }
    const resources = this.executionManager.attachSnapshot(
      ref,
      turn.id,
      this.observerForListener(ref, listener),
      cursors
    )
    if (resources.length === 0) return { status: ConversationAttachStatus.NotFound }
    turn.listeners.set(listener.id, listener)
    for (const execution of turn.executions.values()) {
      const bound = listener.createForExecution?.(execution.id) ?? listener
      execution.listeners.set(bound.id, bound)
    }
    const state = this.inspect(ref)
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

  getDeferredToolOutput(
    ref: ConversationRef,
    outputNodeId: string,
    toolCallId: string
  ): { found: true; output: unknown } | { found: false } {
    return this.executionManager.deferredOutput(ref, outputNodeId, toolCallId)
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
        queueMicrotask(() => this.kickRetainedWork())
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
      summary: `conversation:${this.inspect(ref).phase}`
    }))
  }

  hasLiveStreams(): boolean {
    return this.activeConversationRefs().length > 0
  }

  private commitFreshDispatch(
    ref: ConversationRef,
    request: MainDispatchRequest,
    subscriber: StreamListener,
    extraListeners: readonly StreamListener[],
    committed: CommittedConversationIntent,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.FreshTurn }>,
    provider: ConversationHistoryPort,
    committedInput?: ConversationInput
  ): AiStreamOpenResponse {
    this.assertCommittedConversation(ref, committed)
    if (committed.executions.length === 0) throw new Error('Committed Conversation turn has no executions')
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
      provider,
      [subscriber, ...extraListeners],
      new Map(),
      admission.executions
    )
    const turn: TurnProjection = {
      ref,
      id: turnId,
      inputId,
      isPersistentConversation: provider.isPersistentConversation,
      listeners: new Map([subscriber, ...extraListeners].map((listener) => [listener.id, listener])),
      executions: new Map(plans.map(({ projection }) => [projection.id, projection])),
      reservedMessages: [...committed.reservedMessages],
      activeNodeDecision: committed.activeNodeDecision
    }
    this.bindings.setTurn(ref, turnId, { history: provider, postCommitTasks: committed.postCommitTasks })
    this.presentation.setTurn(turn)
    const transition = this.actorFor(ref).openTurn(
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
    this.schedulePostCommitTasks(ref, turnId, committed.postCommitTasks)
    return {
      mode: ConversationOpenMode.Started,
      reservedMessages: [...committed.reservedMessages],
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
    validation: ValidatedConversationIntent,
    committed: CommittedConversationIntent,
    admission: Extract<
      ConversationDispatchCommitReservation,
      {
        kind:
          | ConversationHistoryCommitKind.NextInput
          | ConversationHistoryCommitKind.ExecutionAppend
          | ConversationHistoryCommitKind.ExecutionRetry
      }
    >,
    provider: ConversationHistoryPort
  ): AiStreamOpenResponse {
    this.assertCommittedConversation(ref, committed)
    if (request.trigger === ConversationOpenTrigger.RegenerateMessage) {
      if (ref.kind !== ConversationKind.Chat) {
        throw new Error('Only Chat may mutate executions on an active Conversation')
      }
      if (admission.kind === ConversationHistoryCommitKind.ExecutionRetry) {
        return this.commitActiveExecutionRetry(ref, subscriber, extraListeners, committed, admission, provider)
      }
      if (admission.kind === ConversationHistoryCommitKind.ExecutionAppend) {
        return this.commitActiveExecutions(ref, subscriber, extraListeners, committed, admission, provider)
      }
      throw new Error('Live execution mutation did not match its admission preview')
    }
    if (committed.executions.length !== 0) {
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
            reasoningEffort: committed.input.pendingSteerReasoningEffort,
            serviceTier: committed.input.pendingSteerServiceTier,
            fastMode: committed.input.pendingSteerFastMode === true,
            headless: request.headless
          }
    this.bindings.setInput(inputId, { request: queuedRequest, validation, historyRowId: userMessageId })
    this.actorFor(ref).rememberCommittedInput(inputId)
    this.presentation.bindInput(inputId, { subscriber, extraListeners })
    const input: ConversationInput = {
      id: inputId,
      historyNodeId: userMessageId,
      provenance: ConversationInputProvenance.Renderer,
      responder: request.headless ? ConversationResponderKind.Headless : ConversationResponderKind.Interactive
    }
    const transition = this.actorFor(ref).commitInput(input, {
      runtimeCanRedirect: ref.kind === ConversationKind.Agent && request.headless !== true,
      yieldEffectId: admission.yieldEffectId,
      redirectEffectId: admission.redirectEffectId
    })
    if (transition.rejection) {
      this.deleteCommittedInput(inputId)
      throw new Error(`Committed Conversation input was rejected: ${transition.rejection}`)
    }
    return {
      mode: ConversationOpenMode.Injected,
      inputId,
      reservedMessages: [...committed.reservedMessages]
    }
  }

  private commitActiveExecutions(
    ref: ConversationRef,
    subscriber: StreamListener,
    extraListeners: readonly StreamListener[],
    committed: CommittedConversationIntent,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.ExecutionAppend }>,
    provider: ConversationHistoryPort
  ): AiStreamOpenResponse {
    const state = this.inspect(ref)
    if (state.phase !== ConversationPhase.Running) throw new Error('Conversation is not running')
    const turn = this.presentation.turn(ref, state.turn.id)
    if (!turn) throw new Error('Conversation turn projection is missing')
    if (admission.turnId !== state.turn.id) throw new Error('Live append turn changed after admission preview')
    const plans = this.installCommittedExecutions(
      ref,
      state.turn.id,
      committed,
      provider,
      [subscriber, ...extraListeners],
      turn.listeners,
      admission.executions
    )
    for (const { projection } of plans) turn.executions.set(projection.id, projection)
    for (const listener of [subscriber, ...extraListeners]) {
      turn.listeners.set(listener.id, listener)
    }
    const transition = this.actorFor(ref).addExecutions(
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
      reservedMessages: [...committed.reservedMessages],
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep },
      activeExecutions: plans.map(({ projection }) => ({
        turnId: state.turn.id,
        executionId: projection.id,
        modelId: projection.modelId,
        outputNodeId: projection.outputNodeId,
        ...(projection.seedFromEmpty ? { seedFromEmpty: true } : {})
      }))
    }
  }

  private commitActiveExecutionRetry(
    ref: ConversationRef,
    subscriber: StreamListener,
    extraListeners: readonly StreamListener[],
    committed: CommittedConversationIntent,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.ExecutionRetry }>,
    provider: ConversationHistoryPort
  ): AiStreamOpenResponse {
    const state = this.inspect(ref)
    if (state.phase !== ConversationPhase.Running || state.turn.id !== admission.turnId) {
      throw new Error('Live retry turn changed after admission preview')
    }
    const turn = this.presentation.turn(ref, state.turn.id)
    const current = turn?.executions.get(admission.execution.executionId)
    const model = committed.executions[0]
    if (!turn || !current || !model || committed.executions.length !== 1) {
      throw new Error('Live retry projection changed after admission preview')
    }
    if (model.modelId !== current.modelId || model.outputNodeId !== current.outputNodeId) {
      throw new Error('History adapter changed the retried execution identity during commit')
    }

    const [installed] = this.installCommittedExecutions(
      ref,
      state.turn.id,
      committed,
      provider,
      [subscriber, ...extraListeners],
      turn.listeners,
      [admission.execution]
    )
    if (!installed) throw new Error('History adapter did not install the retried execution')
    turn.executions.set(installed.projection.id, installed.projection)
    for (const listener of [subscriber, ...extraListeners]) {
      turn.listeners.set(listener.id, listener)
    }
    const transition = this.actorFor(ref).restartExecution(state.turn.id, installed.plan)
    if (transition.rejection) {
      this.executionManager.release(ref, state.turn.id, installed.projection.id)
      throw new Error(`Committed execution retry was rejected: ${transition.rejection}`)
    }
    return {
      mode: ConversationOpenMode.Started,
      reservedMessages: [...committed.reservedMessages],
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep },
      activeExecutions: [
        {
          turnId: state.turn.id,
          executionId: installed.projection.id,
          modelId: installed.projection.modelId,
          outputNodeId: installed.projection.outputNodeId,
          ...(installed.projection.seedFromEmpty ? { seedFromEmpty: true } : {})
        }
      ]
    }
  }

  private commitInteractionExecution(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId,
    interactionId: ReturnType<typeof toConversationInteractionId>,
    committed: CommittedConversationIntent,
    admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.InteractionResume }>,
    provider: ConversationHistoryPort,
    subscriber: StreamListener
  ): AiStreamOpenResponse {
    if (
      admission.turnId !== turnId ||
      admission.executionId !== executionId ||
      admission.interactionId !== interactionId
    ) {
      throw new Error('Interaction continuation changed its admission identity')
    }
    this.assertCommittedConversation(ref, committed)
    const turn = this.presentation.turn(ref, turnId)
    const current = turn?.executions.get(executionId)
    const model = committed.executions[0]
    if (!turn || !current) throw new Error('Conversation interaction projection is missing')
    if (!model || committed.executions.length !== 1) {
      throw new Error('Interaction continuation requires one committed execution')
    }
    if (model.outputNodeId !== current.outputNodeId) {
      throw new Error('Interaction continuation changed its committed output identity')
    }

    const executionListeners = new Map(current.listeners)
    turn.listeners.set(subscriber.id, subscriber)
    const boundSubscriber = subscriber.createForExecution?.(executionId) ?? subscriber
    executionListeners.set(boundSubscriber.id, boundSubscriber)
    const projection: ExecutionProjection = {
      ...current,
      modelId: model.modelId,
      seedFromEmpty: model.seedFromEmpty === true,
      listeners: executionListeners
    }
    turn.executions.set(executionId, projection)
    this.bindings.setExecution(ref, turnId, executionId, { history: provider, descriptor: model })
    const transition = this.actorFor(ref).resolveInteraction(
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
      reservedMessages: [...committed.reservedMessages],
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
    committed: CommittedConversationIntent,
    provider: ConversationHistoryPort,
    listenersToAdd: readonly StreamListener[],
    inheritedListeners: ReadonlyMap<string, StreamListener> = new Map(),
    identities: readonly ReservedExecutionIdentity[]
  ): Array<{ plan: ConversationExecutionPlan; projection: ExecutionProjection }> {
    if (committed.executions.length !== identities.length) {
      throw new Error('History adapter changed the execution count after admission preview')
    }
    const listeners = new Map(inheritedListeners)
    for (const listener of listenersToAdd) listeners.set(listener.id, listener)
    return committed.executions.map((model, index) => {
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
        seedFromEmpty: model.seedFromEmpty === true,
        listeners: this.bindExecutionListeners(listeners, executionId)
      }
      this.bindings.setExecution(ref, turnId, executionId, { history: provider, descriptor: model })
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

  private executionResourceDescriptor(effect: StartConversationExecutionEffect) {
    const binding = this.bindings.execution(effect.conversation, effect.turnId, effect.executionId)
    const projection = this.executionProjection(effect.conversation, effect.turnId, effect.executionId)
    if (!binding) throw new Error(`Missing Conversation execution binding ${effect.executionId}`)
    const observers = [...projection.listeners.values()].map((listener) =>
      this.observerForExecution(effect.executionId, projection, listener)
    )
    observers.push(this.controlObserver(effect.conversation, effect.executionId))
    const descriptor = binding.descriptor
    return {
      conversation: effect.conversation,
      turnId: effect.turnId,
      executionId: effect.executionId,
      outputNodeId: projection.outputNodeId,
      modelId: projection.modelId,
      preparation: descriptor.preparation,
      preparationIndex: descriptor.preparationIndex,
      driver: descriptor.driver,
      telemetry: descriptor.telemetry,
      observers,
      runtimeTimingSeed: descriptor.runtimeTimingSeed,
      interactionResumeMode:
        descriptor.driver.kind === ConversationExecutionDriverBindingKind.Chat
          ? ConversationInteractionResumeMode.NewRun
          : ConversationInteractionResumeMode.InPlace
    }
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
      if (this.isWriteQuiesced) throw new Error('Conversation runtime is write-quiesced')
      operation.assertCurrent()
      const state = this.inspect(ref)
      const resource = this.bindings.input(input.id)
      const presentation = this.presentation.inputBinding(input.id)
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
      const { turnId, executions } = this.actorFor(ref).reserveRuntimeTurn(input, suspendEffectId, [intent.modelId])
      const committed = agentChatContextProvider.commitRuntimeIntent(intent)
      const plans = this.installCommittedExecutions(
        ref,
        turnId,
        committed,
        agentChatContextProvider,
        [presentation.subscriber, ...(presentation.extraListeners ?? [])],
        new Map(),
        executions
      )
      const turn: TurnProjection = {
        ref,
        id: turnId,
        inputId: input.id,
        isPersistentConversation: true,
        listeners: new Map(
          [presentation.subscriber, ...(presentation.extraListeners ?? [])].map((listener) => [listener.id, listener])
        ),
        executions: new Map(plans.map(({ projection }) => [projection.id, projection])),
        reservedMessages: [...committed.reservedMessages],
        activeNodeDecision: { move: ConversationActiveNodeMove.Advance }
      }
      this.bindings.setTurn(ref, turnId, {
        history: agentChatContextProvider,
        postCommitTasks: committed.postCommitTasks
      })
      this.presentation.setTurn(turn)
      const transition = this.actorFor(ref).commitRuntimeTurn(
        input,
        suspendEffectId,
        turnId,
        plans.map(({ plan }) => plan)
      )
      if (transition.rejection) {
        this.releaseTurn(turn)
        throw new Error(`Committed autonomous turn was rejected: ${transition.rejection}`)
      }
      this.schedulePostCommitTasks(ref, turnId, committed.postCommitTasks)
      this.deleteCommittedInput(input.id)
    })
  }

  private scheduleCommittedInput(ref: ConversationRef, input: ConversationInput, autonomous: boolean): Promise<void> {
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.RuntimeContinuation, async (operation) => {
      const resource = this.bindings.input(input.id)
      const presentation = this.presentation.inputBinding(input.id)
      if (!resource || !presentation) throw new Error(`Conversation input resource is missing: ${input.id}`)
      if (this.isWriteQuiesced) return
      if (this.inspect(ref).phase !== ConversationPhase.Idle) {
        throw new Error('Conversation successor turn is no longer idle')
      }
      let committed: CommittedConversationIntent | undefined
      let historyProvider: ConversationHistoryPort | undefined
      let admission:
        | Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.FreshTurn }>
        | undefined
      const turnKind =
        autonomous || resource.agentAutonomous ? ConversationTurnKind.RuntimeInitiated : ConversationTurnKind.Submit
      if (autonomous || resource.agentAutonomous) {
        if (ref.kind !== ConversationKind.Agent) throw new Error('Only Agent Conversations support autonomous turns')
        const intent = application
          .get('AgentConnectionManager')
          .describeConversationAutonomous(ref.id, resource.request.headless === true)
        admission = this.actorFor(ref).reserveFreshTurn({
          executionModelIds: [intent.modelId],
          turnKind,
          anchorNodeId: 'parentAnchorId' in resource.request ? (resource.request.parentAnchorId ?? null) : null,
          responder: input.responder,
          input
        })
        historyProvider = agentChatContextProvider
        committed = agentChatContextProvider.commitRuntimeIntent(intent)
      } else {
        const provider = this.providerFor(ref)
        historyProvider = provider
        let validation: ValidatedConversationIntent | undefined
        const commitFailure = (error: unknown, validated?: ValidatedConversationIntent) => {
          operation.assertCurrent()
          if (this.isWriteQuiesced) return false
          if (this.inspect(ref).phase !== ConversationPhase.Idle) throw error
          const failure = provider.validateInputFailure?.(
            resource.request,
            serializeError(error),
            validated ?? resource.validation
          )
          if (!failure || !provider.commitInputFailureIntent) throw error
          admission = this.actorFor(ref).reserveFreshTurn({
            executionModelIds: failure.executionModelIds,
            turnKind,
            anchorNodeId: 'parentAnchorId' in resource.request ? (resource.request.parentAnchorId ?? null) : null,
            responder: input.responder,
            input
          })
          committed = provider.commitInputFailureIntent(failure)
          if (committed.executions.length === 0) throw error
          return true
        }
        try {
          validation =
            resource.validation && provider.revalidateCommittedInput
              ? await provider.revalidateCommittedInput(
                  resource.request,
                  resource.validation,
                  { hasLiveStream: false },
                  operation.signal
                )
              : await provider.validateIntent(resource.request, { hasLiveStream: false }, operation.signal)
        } catch (error) {
          if (!commitFailure(error)) return
        }
        if (validation) {
          operation.assertCurrent()
          if (this.isWriteQuiesced) return
          if (this.inspect(ref).phase !== ConversationPhase.Idle) {
            throw new Error('Conversation successor turn was superseded')
          }
          admission = this.actorFor(ref).reserveFreshTurn({
            executionModelIds: validation.executionModelIds,
            turnKind,
            anchorNodeId: 'parentAnchorId' in resource.request ? (resource.request.parentAnchorId ?? null) : null,
            responder: input.responder,
            input
          })
          try {
            committed = provider.commitIntent(validation, { hasLiveStream: false })
          } catch (error) {
            if (!commitFailure(error, validation)) return
          }
        }
      }
      if (!committed || !admission || !historyProvider) {
        throw new Error('Conversation successor did not produce a committed turn')
      }
      this.commitFreshDispatch(
        ref,
        resource.request,
        presentation.subscriber,
        presentation.extraListeners ?? [],
        committed,
        admission,
        historyProvider,
        input
      )
      this.deleteCommittedInput(input.id)
    })
  }

  private handleScheduledInputFailure(ref: ConversationRef, input: ConversationInput): void {
    const transition = this.actorFor(ref).dropInput(input.id)
    if (!transition.rejection) return
    const state = this.inspect(ref)
    if (
      !state.inbox.nextTurn.some(({ id }) => id === input.id) &&
      !state.inbox.nextStep.some(({ id }) => id === input.id)
    ) {
      this.deleteCommittedInput(input.id)
    }
  }

  private scheduleCommittedStep(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    input: ConversationInput
  ): Promise<void> {
    return this.actorFor(ref).enqueue(ConversationAdmissionOperationKind.RuntimeContinuation, async (operation) => {
      if (this.isWriteQuiesced) return
      const resource = this.bindings.input(input.id)
      const presentation = this.presentation.inputBinding(input.id)
      if (!resource || !presentation) throw new Error(`Conversation step resource is missing: ${input.id}`)
      const initial = this.inspect(ref)
      if (initial.phase !== ConversationPhase.Running || initial.turn.id !== turnId) return
      let committed: CommittedConversationIntent
      let historyProvider: ConversationHistoryPort
      let admission: Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.NextStep }>
      if (resource.agentSegment) {
        if (ref.kind !== ConversationKind.Agent) throw new Error('Only Agent Conversations support native segments')
        const intent = application.get('AgentConnectionManager').describeConversationContinuation(ref.id)
        admission = this.actorFor(ref).reserveStep(turnId, input, [intent.modelId])
        historyProvider = agentChatContextProvider
        committed = agentChatContextProvider.commitRuntimeIntent(intent)
      } else {
        const provider = this.providerFor(ref)
        historyProvider = provider
        const validation = await provider.validateIntent(resource.request, { hasLiveStream: false }, operation.signal)
        operation.assertCurrent()
        if (this.isWriteQuiesced) return
        const current = this.inspect(ref)
        if (current.phase !== ConversationPhase.Running || current.turn.id !== turnId) return
        admission = this.actorFor(ref).reserveStep(turnId, input, validation.executionModelIds)
        committed = provider.commitIntent(validation, { hasLiveStream: false })
      }
      const plans = this.installCommittedExecutions(
        ref,
        turnId,
        committed,
        historyProvider,
        [presentation.subscriber, ...(presentation.extraListeners ?? [])],
        this.presentation.turn(ref, turnId)?.listeners,
        admission.executions
      )
      const turn = this.presentation.turn(ref, turnId)
      if (!turn) throw new Error('Conversation step projection is missing')
      for (const { projection } of plans) turn.executions.set(projection.id, projection)
      for (const listener of [presentation.subscriber, ...(presentation.extraListeners ?? [])]) {
        turn.listeners.set(listener.id, listener)
      }
      const transition = this.actorFor(ref).commitStep(
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
      actor = new ConversationActor(ref, () => this.onActorIdle(ref), {
        ports: { resolve: () => this.ports },
        ids: this.ids,
        isEffectSchedulingPaused: () => this.isWriteQuiesced,
        onTransition: (conversation, command, transition) => this.afterTransition(conversation, command, transition)
      })
      this.actors.set(key, actor)
    }
    return actor
  }

  private onActorIdle(ref: ConversationRef): void {
    const key = conversationRefKey(ref)
    const actor = this.actors.get(key)
    const turnId = actor?.takeDeferredQuiescence()
    if (turnId) {
      this.trackPresentationOperation(ref, `quiescence:${key}:${turnId}`, () => this.finalizeQuiescence(ref, turnId))
    }
    if (
      isConversationQuiescent(this.inspect(ref)) &&
      !actor?.hasPendingOperations &&
      !actor?.hasCommittedInputs &&
      !this.bindings.hasConversation(ref) &&
      !this.latestTurn(ref)
    ) {
      this.actors.delete(key)
    }
  }

  private assertCommittedConversation(ref: ConversationRef, committed: CommittedConversationIntent): void {
    if (!conversationRefsEqual(ref, committed.conversation)) {
      throw new Error('History adapter committed another Conversation')
    }
  }

  private committedInputNodeId(ref: ConversationRef, committed: CommittedConversationIntent): string {
    this.assertCommittedConversation(ref, committed)
    return committed.input.historyNodeId
  }

  private async persistTerminal(
    effect: PersistConversationTerminalEffect
  ): Promise<ConversationTerminalPersistenceResult> {
    const projection = this.executionProjection(effect.conversation, effect.turnId, effect.executionId)
    const binding = this.bindings.execution(effect.conversation, effect.turnId, effect.executionId)
    if (!binding) throw new Error(`Missing Conversation execution binding ${effect.executionId}`)
    const result = this.executionManager.result(effect.conversation, effect.turnId, effect.executionId)
    const common = {
      finalMessage: result?.finalMessage,
      modelId: projection.modelId,
      anchorMessageId: projection.outputNodeId,
      runtimeTiming: result?.runtimeTiming,
      runtimeCheckpoint: result?.checkpoint,
      turnTerminal: false
    }
    try {
      if (effect.outcome.kind === ConversationOutcomeKind.Success) {
        await binding.history.persistTerminal(binding.descriptor.persistence, {
          ...common,
          status: ConversationOutcomeKind.Success
        })
      } else if (effect.outcome.kind === ConversationOutcomeKind.Paused) {
        await binding.history.persistTerminal(binding.descriptor.persistence, {
          ...common,
          status: ConversationOutcomeKind.Paused
        })
      } else {
        await binding.history.persistTerminal(binding.descriptor.persistence, {
          ...common,
          status: ConversationOutcomeKind.Error,
          error: effect.outcome.error
        })
      }
      const finalMessage = result?.finalMessage
      if (effect.outcome.kind === ConversationOutcomeKind.Success && finalMessage && binding.descriptor.afterPersist) {
        const task = binding.descriptor.afterPersist
        this.trackPresentationOperation(
          effect.conversation,
          `after-persist:${conversationRefKey(effect.conversation)}:${effect.turnId}:${effect.executionId}:${task.kind}`,
          () => this.namingTasks.executeAfterPersist(task, finalMessage)
        )
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
          effect.conversation,
          `execution-terminal:${conversationRefKey(effect.conversation)}:${effect.turnId}:${effect.executionId}`,
          () => this.publishExecutionTerminal(effect)
        ),
      publishTurnTerminal: (effect) =>
        this.trackPresentationOperation(
          effect.conversation,
          `turn-terminal:${conversationRefKey(effect.conversation)}:${effect.turnId}`,
          () => this.publishTurnTerminal(effect)
        ),
      publishQuiescence: (ref, turnId) => this.publishQuiescence(ref, turnId)
    }
  }

  private publishStatus(effect: PublishConversationStatusEffect): void {
    this.publishConversationStatus(effect.conversation, effect.turnId)
  }

  private async publishExecutionTerminal(effect: PublishConversationExecutionTerminalEffect): Promise<void> {
    const turn = this.presentation.turn(effect.conversation, effect.turnId)
    const projection = turn?.executions.get(effect.executionId)
    const result = this.executionManager.result(effect.conversation, effect.turnId, effect.executionId)
    if (!turn || !projection) return
    const state = this.inspect(effect.conversation)
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
    const turn = this.presentation.turn(effect.conversation, effect.turnId)
    if (!turn) return
    const isFirstTerminal = turn.terminal === undefined
    const result = turn.terminal ?? this.turnTerminalResult(effect)
    turn.terminal = result
    if (isFirstTerminal) {
      this._onTurnTerminal.fire({
        conversation: effect.conversation,
        turnId: effect.turnId,
        outputNodeIds: [...turn.executions.values()].map((execution) => execution.outputNodeId),
        outcome: effect.outcome,
        durability: effect.durability
      })
    }
    if (!effect.quiescent) {
      if (turn.cleanupTimer) clearTimeout(turn.cleanupTimer)
      turn.cleanupTimer = setTimeout(() => this.releaseTurn(turn), GRACE_PERIOD_MS)
      return
    }
    const actor = this.actors.get(conversationRefKey(effect.conversation))
    if (actor?.hasPendingOperations || actor?.hasCommittedInputs) {
      actor.deferQuiescence(effect.turnId)
      return
    }
    await this.finalizeQuiescence(effect.conversation, effect.turnId)
  }

  private publishQuiescence(ref: ConversationRef, turnId: ConversationTurnId): void {
    const actor = this.actors.get(conversationRefKey(ref))
    if (actor?.hasPendingOperations || actor?.hasCommittedInputs) {
      actor.deferQuiescence(turnId)
      return
    }
    this.trackPresentationOperation(ref, `quiescence:${conversationRefKey(ref)}:${turnId}`, () =>
      this.finalizeQuiescence(ref, turnId)
    )
  }

  private trackPresentationOperation(ref: ConversationRef, id: string, task: () => Promise<void>): void {
    void this.actorFor(ref).trackEffectOperation(id, task)
  }

  private schedulePostCommitTasks(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    tasks: readonly ConversationPostCommitTaskDescriptor[]
  ): void {
    for (const task of tasks) {
      if (task.kind === ConversationPostCommitTaskKind.RegisterTraceFlush) continue
      this.trackPresentationOperation(ref, `post-commit:${conversationRefKey(ref)}:${turnId}:${task.kind}`, () =>
        this.namingTasks.executePostCommit(task)
      )
    }
  }

  private inFlightOperations(): Array<{ id: string; run: Promise<unknown> }> {
    const runs: Array<{ id: string; run: Promise<unknown> }> = []
    for (const actor of this.actors.values()) runs.push(...actor.inFlightOperations())
    for (const operation of this.executionManager.inFlightOperations()) {
      runs.push({ id: `execution:${operation.id}`, run: operation.run })
    }
    if (this.bootRecoveryOperation) runs.push({ id: 'boot-recovery', run: this.bootRecoveryOperation })
    return runs
  }

  private async finalizeQuiescence(ref: ConversationRef, turnId: ConversationTurnId): Promise<void> {
    const turn = this.presentation.turn(ref, turnId)
    if (!turn?.terminal || turn.quiescencePublished) return
    turn.quiescencePublished = true
    const binding = this.bindings.turn(ref, turnId)
    for (const task of binding?.postCommitTasks ?? []) {
      if (task.kind !== ConversationPostCommitTaskKind.RegisterTraceFlush) continue
      try {
        await this.quiescenceTasks.execute(task, turn.terminal)
      } catch (error) {
        logger.warn('Conversation quiescence task failed', { task: task.kind, error })
      }
    }
    const state = this.inspect(ref)
    const stillOwnsPublishedState =
      state.phase === ConversationPhase.Idle ? state.lastTurnId === turnId : state.turn.id === turnId
    if (!stillOwnsPublishedState) {
      if (turn.cleanupTimer) clearTimeout(turn.cleanupTimer)
      turn.cleanupTimer = setTimeout(() => this.releaseTurn(turn), GRACE_PERIOD_MS)
      return
    }
    const completedAt =
      turn.terminal.status === ConversationOutcomeKind.Success && turn.isPersistentConversation ? Date.now() : undefined
    this.publishConversationStatus(
      ref,
      turnId,
      turn.terminal.status === ConversationOutcomeKind.Success
        ? ConversationStatus.Done
        : turn.terminal.status === ConversationOutcomeKind.Paused
          ? ConversationStatus.Aborted
          : ConversationStatus.Error,
      completedAt
    )
    if (ref.kind === ConversationKind.Chat && completedAt !== undefined) {
      this._onConversationCompleted.fire({ conversation: ref, turnId, completedAt })
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
      case ConversationCommandType.ExecutionRestarted:
        this.publishConversationStatus(ref, command.turnId, ConversationStatus.Pending)
        return
      case ConversationCommandType.PersistenceSucceeded:
      case ConversationCommandType.RuntimeOwnershipReleased:
      case ConversationCommandType.RuntimeTurnCommitFailed:
        if (
          transition.state.phase === ConversationPhase.Running &&
          transition.state.runMode === ConversationRunMode.Foreground
        ) {
          this.publishConversationStatus(ref, transition.state.turn.id)
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
    const resource = this.bindings.input(input.id)
    const message = resource?.request.agentDeliveryMessage
    if (!message || resource.request.trigger !== ConversationOpenTrigger.SubmitMessage) return false
    const redirected = application.get('AgentConnectionManager').redirectConversationInput(ref.id, message, {
      headless: resource.request.headless,
      reasoningEffort: resource.request.reasoningEffort,
      fastMode: resource.request.fastMode,
      messageSnapshot:
        resource.validation?.kind === ConversationHistoryAdapterKind.Agent
          ? resource.validation.agent.messageSnapshot
          : undefined
    })
    if (redirected) this.bindings.markAgentSegment(input.id)
    return redirected
  }

  private deleteCommittedInput(inputId: ConversationInput['id']): void {
    const binding = this.bindings.input(inputId)
    this.bindings.deleteInput(inputId)
    this.presentation.deleteInput(inputId)
    if (binding) {
      this.actors.get(conversationRefKey(binding.request.conversation))?.releaseCommittedInput(inputId)
    }
  }

  private deleteCommittedInputsFor(ref: ConversationRef): void {
    for (const [inputId, binding] of this.bindings.inputEntries()) {
      if (conversationRefsEqual(binding.request.conversation, ref)) this.presentation.deleteInput(inputId)
    }
    this.bindings.deleteConversation(ref)
    this.actors.get(conversationRefKey(ref))?.clearCommittedInputs()
  }

  private kickRetainedWork(): void {
    for (const actor of this.actors.values()) actor.kickDeferredEffects()
    for (const ref of this.bindings.conversationRefs()) this.actorFor(ref).kickInbox()
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

  private controlObserver(ref: ConversationRef, executionId: ConversationExecutionId): ConversationExecutionObserver {
    const published = new Set<string>()
    return {
      id: `conversation-control:${executionId}`,
      isAlive: () => true,
      onChunk: ({ chunk, turnId }) => {
        if (chunk.type !== 'tool-approval-request' || published.has(chunk.approvalId)) return
        if (!this.presentation.turn(ref, turnId)?.isPersistentConversation) return
        published.add(chunk.approvalId)
        this._onApprovalRequested.fire({
          conversation: ref,
          approvalId: chunk.approvalId,
          requestedAt: Date.now()
        })
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
    forced?: ConversationStatus,
    completedAt?: number
  ): void {
    const state = this.inspect(ref)
    const turn = this.presentation.turn(ref, turnId)
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
      lastCompletedAt: status === ConversationStatus.Done ? (completedAt ?? Date.now()) : previous?.lastCompletedAt
    })
  }

  private executionProjection(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId
  ): ExecutionProjection {
    const projection = this.presentation.turn(ref, turnId)?.executions.get(executionId)
    if (!projection) throw new Error(`Missing Conversation execution projection ${executionId}`)
    return projection
  }

  private latestTurn(ref: ConversationRef): TurnProjection | undefined {
    const state = this.inspect(ref)
    if (state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping) {
      const current = this.presentation.turn(ref, state.turn.id)
      if (current) return current
    }
    return this.presentation.latestTurn(ref)
  }

  private releaseTurn(turn: TurnProjection): void {
    for (const execution of turn.executions.values()) this.executionManager.release(turn.ref, turn.id, execution.id)
    this.bindings.deleteTurn(turn.ref, turn.id)
    this.presentation.deleteTurn(turn.ref, turn.id)
    this.onActorIdle(turn.ref)
  }

  private activeConversationRefs(): ConversationRef[] {
    const refs = new Map<string, ConversationRef>()
    for (const actor of this.actors.values()) {
      if (actor.hasPendingAdmissions) refs.set(conversationRefKey(actor.conversation), actor.conversation)
    }
    for (const turn of this.presentation.values()) {
      if (this.inspect(turn.ref).phase !== ConversationPhase.Idle) refs.set(conversationRefKey(turn.ref), turn.ref)
    }
    for (const input of this.bindings.values()) {
      refs.set(conversationRefKey(input.request.conversation), input.request.conversation)
    }
    return [...refs.values()]
  }
}
