import type { serializeError } from '@main/ai/utils/serializeError'
import {
  type ConversationActivityId,
  ConversationAdmissionReason,
  type ConversationEffectId,
  type ConversationExecutionId,
  ConversationExecutionPhase,
  type ConversationInputId,
  type ConversationInteractionId,
  ConversationKind,
  ConversationPhase,
  type ConversationRef,
  type ConversationTurnId,
  ConversationTurnKind,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { UniqueModelId } from '@shared/data/types/model'

import type { AgentRuntimeRedirectId, AgentRuntimeSegmentId } from '../runtime/types'
import { ConversationAdmissionError } from './ConversationAdmissionError'
import { ConversationEffectExecutor } from './ConversationEffectExecutor'
import type { ConversationPortResolver, ConversationRuntimeIdFactory } from './conversationPorts'
import type {
  ConversationActivity,
  ConversationCommand,
  ConversationExecutionPlan,
  ConversationInput,
  ConversationState,
  ConversationTransition
} from './conversationState'
import {
  ConversationCommandType,
  type ConversationEffect,
  type ConversationEffectType,
  ConversationExecutionDriverKind,
  ConversationInputProvenance,
  type ConversationResponderKind,
  ConversationRunMode,
  createConversationState,
  isConversationQuiescent,
  transitionConversation
} from './conversationState'

export enum ConversationAdmissionOperationKind {
  Dispatch = 'dispatch',
  InboxMutation = 'inbox-mutation',
  Interaction = 'interaction',
  RuntimeContinuation = 'runtime-continuation'
}

export enum ConversationHistoryCommitKind {
  FreshTurn = 'fresh-turn',
  NextInput = 'next-input',
  ExecutionAppend = 'execution-append',
  ExecutionRetry = 'execution-retry',
  NextStep = 'next-step',
  InteractionResume = 'interaction-resume'
}

export enum ConversationExecutionAdmissionKind {
  Append = 'append',
  Retry = 'retry'
}

export interface ReservedExecutionIdentity {
  readonly executionId: ConversationExecutionId
  readonly startEffectId: ConversationEffectId
  readonly modelId: UniqueModelId
}

export type ConversationHistoryCommitReservation =
  | {
      readonly kind: ConversationHistoryCommitKind.FreshTurn
      readonly inputId: ConversationInput['id']
      readonly inputIds: readonly ConversationInput['id'][]
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
      readonly kind: ConversationHistoryCommitKind.ExecutionRetry
      readonly turnId: ConversationTurnId
      readonly execution: ReservedExecutionIdentity
    }
  | {
      readonly kind: ConversationHistoryCommitKind.NextStep
      readonly turnId: ConversationTurnId
      readonly inputIds: readonly ConversationInput['id'][]
      readonly executions: readonly ReservedExecutionIdentity[]
    }
  | {
      readonly kind: ConversationHistoryCommitKind.InteractionResume
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly interactionId: ConversationInteractionId
      readonly resumeEffectId: ConversationEffectId
      readonly statusEffectId: ConversationEffectId
    }

export type ConversationDispatchCommitReservation = Extract<
  ConversationHistoryCommitReservation,
  {
    kind:
      | ConversationHistoryCommitKind.FreshTurn
      | ConversationHistoryCommitKind.NextInput
      | ConversationHistoryCommitKind.ExecutionAppend
      | ConversationHistoryCommitKind.ExecutionRetry
  }
>

export interface ConversationDispatchAdmission {
  readonly turnKind: ConversationTurnKind
  readonly anchorNodeId: string | null
  readonly responder: ConversationResponderKind
  readonly executionModelIds: readonly UniqueModelId[]
  readonly executionMutation?: {
    readonly kind: ConversationExecutionAdmissionKind
    readonly outputNodeId: string
    readonly persistedSiblingsGroupId: number
  }
  readonly runtimeCanRedirect: boolean
}

export interface ConversationRuntimeTurnReservation {
  readonly turnId: ConversationTurnId
  readonly executions: readonly ReservedExecutionIdentity[]
}

export type ConversationAdmissionOperationId = string & {
  readonly __conversationAdmissionOperationId: unique symbol
}

export type ConversationStopOperationId = string & {
  readonly __conversationStopOperationId: unique symbol
}

export enum ConversationStopOperationPhase {
  Draining = 'draining',
  Completed = 'completed',
  Failed = 'failed'
}

export interface ConversationStopHandle {
  readonly accepted: boolean
  readonly operationId?: ConversationStopOperationId
  readonly completed: Promise<void>
}

export interface ConversationAdmissionContext {
  readonly id: ConversationAdmissionOperationId
  readonly sequence: number
  readonly signal: AbortSignal
  assertCurrent(): void
}

export class StaleConversationAdmissionError extends Error {
  constructor(readonly conversation: ConversationRef) {
    super(`Conversation admission was superseded: ${conversation.kind}:${conversation.id}`)
    this.name = 'StaleConversationAdmissionError'
  }
}

interface ConversationAdmissionOperation {
  readonly id: ConversationAdmissionOperationId
  readonly kind: ConversationAdmissionOperationKind
  readonly sequence: number
  readonly epoch: number
  controller?: AbortController
}

interface ConversationStopOperation {
  readonly id: ConversationStopOperationId
  readonly turnId?: ConversationTurnId
  readonly epoch: number
  readonly abortEffectIds: ReadonlySet<ConversationEffectId>
  readonly completed: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  phase: ConversationStopOperationPhase
}

export interface ConversationActorControl {
  readonly ports: ConversationPortResolver
  readonly ids: ConversationRuntimeIdFactory
  readonly isEffectSchedulingPaused?: () => boolean
  readonly onTransition?: (
    ref: ConversationRef,
    command: ConversationCommand,
    transition: ConversationTransition
  ) => void
}

/** Owns the FIFO and cancellation boundary for one Conversation's pre-commit work. */
export class ConversationActor {
  private tail: Promise<void> = Promise.resolve()
  private readonly operations = new Map<ConversationAdmissionOperationId, ConversationAdmissionOperation>()
  private readonly effectOperations = new Map<string, Promise<void>>()
  private readonly committedInputIds = new Set<ConversationInputId>()
  private readonly effectExecutor?: ConversationEffectExecutor
  private state: ConversationState
  private deferredQuiescenceTurnId?: ConversationTurnId
  private stopOperation?: ConversationStopOperation
  private epoch = 0
  private nextSequence = 0
  private inboxRevisionValue = 0
  private inboxPausedValue = false

  constructor(
    readonly conversation: ConversationRef,
    private readonly onIdle: () => void,
    private readonly control?: ConversationActorControl
  ) {
    this.state = createConversationState(conversation)
    if (control) {
      this.effectExecutor = new ConversationEffectExecutor(
        conversation,
        control.ports,
        control.ids,
        (command) => {
          this.commit(command)
        },
        {
          shouldDeferResume: () => control.isEffectSchedulingPaused?.() === true,
          isResumeApplicable: (effect) => this.isDeferredResumeApplicable(effect),
          trackOperation: (id, task) => this.trackEffectOperation(id, task)
        }
      )
    }
  }

  enqueue<T>(
    kind: ConversationAdmissionOperationKind,
    task: (context: ConversationAdmissionContext) => Promise<T> | T
  ): Promise<T> {
    const stopBarrier = this.stopOperation?.completed
    const operation: ConversationAdmissionOperation = {
      id: crypto.randomUUID() as ConversationAdmissionOperationId,
      kind,
      sequence: ++this.nextSequence,
      epoch: this.epoch
    }
    this.operations.set(operation.id, operation)
    const run = this.tail.then(async () => {
      try {
        await stopBarrier
        this.assertCurrent(operation)
        const controller = new AbortController()
        operation.controller = controller
        const context: ConversationAdmissionContext = {
          id: operation.id,
          sequence: operation.sequence,
          signal: controller.signal,
          assertCurrent: () => this.assertCurrent(operation)
        }
        const result = await task(context)
        context.assertCurrent()
        return result
      } finally {
        this.operations.delete(operation.id)
        this.completeStopOperationIfReady()
        if (!this.hasPendingOperations) this.onIdle()
      }
    })
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private interrupt(reason: string): void {
    this.epoch += 1
    for (const operation of this.operations.values()) operation.controller?.abort(reason)
  }

  get hasPendingAdmissions(): boolean {
    return this.operations.size > 0
  }

  get hasCommittedInputs(): boolean {
    return this.committedInputIds.size > 0
  }

  get hasPendingOperations(): boolean {
    return (
      this.hasPendingAdmissions ||
      this.effectOperations.size > 0 ||
      this.inFlightPersistenceOperations().length > 0 ||
      this.stopOperation !== undefined
    )
  }

  get inFlightAdmission(): Promise<void> {
    return this.tail
  }

  inspect(): ConversationState {
    return this.state
  }

  get inboxRevision(): number {
    return this.inboxRevisionValue
  }

  get inboxPaused(): boolean {
    return this.inboxPausedValue
  }

  reserveDispatch(admission: ConversationDispatchAdmission): ConversationDispatchCommitReservation {
    if (this.state.phase === ConversationPhase.Idle) {
      return this.reserveFreshTurn({
        executionModelIds: admission.executionModelIds,
        turnKind: admission.turnKind,
        anchorNodeId: admission.anchorNodeId,
        responder: admission.responder
      })
    }
    if (this.state.phase !== ConversationPhase.Running) throw new Error('Conversation is stopping')
    if (admission.turnKind === ConversationTurnKind.Regenerate) {
      return this.reserveExecutionMutation(admission)
    }
    if (admission.executionModelIds.length !== 0) throw new Error('Active input cannot commit execution skeletons')
    const inputId = this.ids().input()
    const input: ConversationInput = {
      id: inputId,
      historyNodeId: `admission:${inputId}`,
      provenance: ConversationInputProvenance.Renderer,
      responder: admission.responder,
      batchKey: null
    }
    const reservation = {
      kind: ConversationHistoryCommitKind.NextInput,
      inputId,
      yieldEffectId: this.ids().effect(),
      redirectEffectId: this.ids().effect()
    } as const
    this.assertPreview({
      type: ConversationCommandType.InputCommitted,
      input,
      yieldEffectId: reservation.yieldEffectId,
      redirectEffectId: reservation.redirectEffectId,
      runtimeCanRedirect: admission.runtimeCanRedirect
    })
    return reservation
  }

  reserveFreshTurn(options: {
    readonly executionModelIds: readonly UniqueModelId[]
    readonly turnKind: ConversationTurnKind
    readonly anchorNodeId: string | null
    readonly responder: ConversationResponderKind
    readonly inputs?: readonly ConversationInput[]
  }): Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.FreshTurn }> {
    if (options.executionModelIds.length < 1) throw new Error('Conversation turn must reserve at least one execution')
    const turnId = this.ids().turn()
    const inputs = options.inputs ?? []
    const inputId = inputs[0]?.id ?? this.ids().input()
    const inputIds = inputs.length > 0 ? inputs.map((input) => input.id) : [inputId]
    const executions = this.reserveExecutionIdentities(options.executionModelIds)
    this.assertPreview({
      type: ConversationCommandType.TurnCommitted,
      inputId,
      inputIds,
      turnId,
      turnKind: options.turnKind,
      anchorNodeId: options.anchorNodeId,
      responder: inputs[0]?.responder ?? options.responder,
      executions: this.provisionalExecutionPlans(executions)
    })
    return {
      kind: ConversationHistoryCommitKind.FreshTurn,
      inputId,
      inputIds,
      turnId,
      turnKind: options.turnKind,
      executions
    }
  }

  reserveStep(
    turnId: ConversationTurnId,
    inputs: readonly ConversationInput[],
    executionModelIds: readonly UniqueModelId[]
  ): Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.NextStep }> {
    const executions = this.reserveExecutionIdentities(executionModelIds)
    this.assertPreview({
      type: ConversationCommandType.StepCommitted,
      turnId,
      inputIds: inputs.map(({ id }) => id),
      executions: this.provisionalExecutionPlans(executions)
    })
    return { kind: ConversationHistoryCommitKind.NextStep, turnId, inputIds: inputs.map(({ id }) => id), executions }
  }

  reserveInteraction(
    turnId: ConversationTurnId,
    interactionId: ConversationInteractionId,
    executionId: ConversationExecutionId
  ): Extract<ConversationHistoryCommitReservation, { kind: ConversationHistoryCommitKind.InteractionResume }> {
    const reservation = {
      kind: ConversationHistoryCommitKind.InteractionResume,
      turnId,
      executionId,
      interactionId,
      resumeEffectId: this.ids().effect(),
      statusEffectId: this.ids().effect()
    } as const
    this.assertPreview({
      type: ConversationCommandType.InteractionResolved,
      turnId,
      interactionId,
      resumeEffectId: reservation.resumeEffectId,
      statusEffectId: reservation.statusEffectId
    })
    return reservation
  }

  reserveRuntimeTurn(
    input: ConversationInput,
    suspendEffectId: ConversationEffectId,
    executionModelIds: readonly UniqueModelId[]
  ): ConversationRuntimeTurnReservation {
    const turnId = this.ids().turn()
    const executions = this.reserveExecutionIdentities(executionModelIds)
    this.assertPreview({
      type: ConversationCommandType.RuntimeTurnCommitted,
      inputId: input.id,
      suspendEffectId,
      turnId,
      anchorNodeId: null,
      responder: input.responder,
      executions: this.provisionalExecutionPlans(executions)
    })
    return { turnId, executions }
  }

  rememberCommittedInput(inputId: ConversationInputId): void {
    this.committedInputIds.add(inputId)
  }

  releaseCommittedInput(inputId: ConversationInputId): void {
    if (this.committedInputIds.delete(inputId) && !this.hasPendingOperations) this.onIdle()
  }

  clearCommittedInputs(): void {
    this.committedInputIds.clear()
  }

  trackEffectOperation(id: string, task: () => Promise<void>): Promise<void> {
    const operation = Promise.resolve().then(task)
    this.effectOperations.set(id, operation)
    const release = (error?: unknown) => {
      if (this.effectOperations.get(id) !== operation) return
      this.effectOperations.delete(id)
      if (error !== undefined) this.failStopOperation(id, error)
      else this.completeStopOperationIfReady()
      if (!this.hasPendingOperations) this.onIdle()
    }
    void operation.then(
      () => release(),
      (error) => release(error)
    )
    return operation
  }

  inFlightOperations(): Array<{ id: string; run: Promise<unknown> }> {
    const runs: Array<{ id: string; run: Promise<unknown> }> = []
    if (this.hasPendingAdmissions) {
      runs.push({ id: `admission:${this.conversation.kind}:${this.conversation.id}`, run: this.inFlightAdmission })
    }
    for (const [id, run] of this.effectOperations) runs.push({ id, run })
    for (const operation of this.inFlightPersistenceOperations()) {
      runs.push({ id: `persistence:${operation.id}`, run: operation.run })
    }
    if (this.stopOperation) {
      runs.push({
        id: `stop:${this.stopOperation.id}`,
        run: this.stopOperation.completed
      })
    }
    return runs
  }

  preview(command: ConversationCommand): ConversationTransition {
    return transitionConversation(this.state, command)
  }

  commit(command: ConversationCommand): ConversationTransition {
    const previousInbox = this.state.inbox
    const transition = transitionConversation(this.state, command)
    this.state = transition.state
    if (transition.state.inbox !== previousInbox) this.inboxRevisionValue += 1
    this.effectExecutor?.reconcileDeferredEffects()
    if (
      !transition.rejection &&
      (command.type === ConversationCommandType.TurnCommitted ||
        command.type === ConversationCommandType.RuntimeTurnCommitted ||
        command.type === ConversationCommandType.StepCommitted ||
        command.type === ConversationCommandType.ExecutionsAdded ||
        command.type === ConversationCommandType.ExecutionRestarted)
    ) {
      this.deferredQuiescenceTurnId = undefined
    }
    this.control?.onTransition?.(this.conversation, command, transition)
    for (const effect of transition.effects) this.effectExecutor?.execute(effect)
    this.completeStopOperationIfReady()
    if (!this.hasPendingOperations) this.onIdle()
    return transition
  }

  deferQuiescence(turnId: ConversationTurnId): void {
    this.deferredQuiescenceTurnId = turnId
  }

  takeDeferredQuiescence(): ConversationTurnId | undefined {
    if (!isConversationQuiescent(this.state) || this.hasPendingOperations || this.hasCommittedInputs) return undefined
    const turnId = this.deferredQuiescenceTurnId
    this.deferredQuiescenceTurnId = undefined
    return turnId
  }

  openTurn(
    inputs: readonly ConversationInput[],
    executions: readonly ConversationExecutionPlan[],
    options: { turnId?: ConversationTurnId; turnKind?: ConversationTurnKind; anchorNodeId?: string | null } = {}
  ): ConversationTransition {
    const ids = this.ids()
    const first = inputs[0]
    if (!first) throw new Error('Conversation turn requires an input')
    return this.commit({
      type: ConversationCommandType.TurnCommitted,
      inputId: first.id,
      inputIds: inputs.map((entry) => entry.id),
      turnId: options.turnId ?? ids.turn(),
      turnKind: options.turnKind ?? ConversationTurnKind.Submit,
      anchorNodeId: options.anchorNodeId ?? null,
      responder: first.responder,
      executions
    })
  }

  commitInput(
    input: ConversationInput,
    options: {
      runtimeCanRedirect?: boolean
      yieldEffectId?: ConversationEffectId
      redirectEffectId?: ConversationEffectId
    } = {}
  ): ConversationTransition {
    const ids = this.ids()
    return this.commit({
      type: ConversationCommandType.InputCommitted,
      input,
      yieldEffectId: options.yieldEffectId ?? ids.effect(),
      redirectEffectId: options.redirectEffectId ?? ids.effect(),
      runtimeCanRedirect: options.runtimeCanRedirect
    })
  }

  dropInput(inputId: ConversationInputId): ConversationTransition {
    const ids = this.ids()
    return this.commit({
      type: ConversationCommandType.InputDropped,
      turnId: this.state.lastTurnId ?? toConversationTurnId('stale-input-drop'),
      inputId,
      dropEffectId: ids.effect(),
      scheduleEffectId: ids.effect(),
      quiescenceEffectId: ids.effect()
    })
  }

  removeInput(inputId: ConversationInputId): ConversationTransition {
    const ids = this.ids()
    return this.commit({
      type: ConversationCommandType.InputRemoved,
      inputId,
      dropEffectId: ids.effect(),
      scheduleEffectId: ids.effect(),
      quiescenceEffectId: ids.effect()
    })
  }

  reorderInputs(inputIds: readonly ConversationInputId[]): ConversationTransition {
    return this.commit({ type: ConversationCommandType.InboxReordered, inputIds })
  }

  setInboxPaused(paused: boolean): void {
    if (this.inboxPausedValue === paused) return
    this.inboxPausedValue = paused
    this.inboxRevisionValue += 1
    if (!paused) this.kickInbox()
  }

  requestRuntimePreemption(input: ConversationInput, runtimeSegmentId: AgentRuntimeSegmentId): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.RuntimePreemptionRequested,
      input,
      runtimeSegmentId,
      suspendEffectId: this.ids().effect()
    })
  }

  commitRuntimeTurn(
    input: ConversationInput,
    suspendEffectId: ConversationEffectId,
    turnId: ConversationTurnId,
    executions: readonly ConversationExecutionPlan[]
  ): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.RuntimeTurnCommitted,
      inputId: input.id,
      suspendEffectId,
      turnId,
      anchorNodeId: null,
      responder: input.responder,
      executions
    })
  }

  failRuntimeTurnCommit(suspendEffectId: ConversationEffectId): ConversationTransition {
    const ids = this.ids()
    return this.commit({
      type: ConversationCommandType.RuntimeTurnCommitFailed,
      suspendEffectId,
      resumeEffectId: ids.effect(),
      discardEffectId: ids.effect()
    })
  }

  releaseRuntimeOwnership(suspendEffectId: ConversationEffectId): ConversationTransition {
    const ids = this.ids()
    return this.commit({
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId,
      resumeEffectId: ids.effect(),
      quiescenceEffectId: ids.effect()
    })
  }

  commitStep(
    turnId: ConversationTurnId,
    inputIds: readonly ConversationInputId[],
    executions: readonly ConversationExecutionPlan[]
  ): ConversationTransition {
    return this.commit({ type: ConversationCommandType.StepCommitted, turnId, inputIds, executions })
  }

  failStep(
    turnId: ConversationTurnId,
    inputIds: readonly ConversationInputId[],
    error: ReturnType<typeof serializeError>
  ) {
    const ids = this.ids()
    return this.commit({
      type: ConversationCommandType.StepFailed,
      turnId,
      inputIds,
      error,
      turnTerminalEffectId: ids.effect(),
      quiescenceEffectId: ids.effect(),
      scheduleEffectId: ids.effect()
    })
  }

  stop(reason: string): ConversationStopHandle {
    if (this.stopOperation) {
      return {
        accepted: true,
        operationId: this.stopOperation.id,
        completed: this.stopOperation.completed
      }
    }
    if (
      this.state.phase === ConversationPhase.Idle &&
      this.state.inbox.nextTurn.length === 0 &&
      this.state.inbox.nextStep.length === 0 &&
      !this.hasPendingAdmissions
    ) {
      return { accepted: false, completed: Promise.resolve() }
    }
    this.interrupt(reason)
    const ids = this.ids()
    const abortEffectIds = new Map<ConversationExecutionId, ConversationEffectId>()
    const persistenceEffectIds = new Map<ConversationExecutionId, ConversationEffectId>()
    if (this.state.phase === ConversationPhase.Running || this.state.phase === ConversationPhase.Stopping) {
      const turns = [
        this.state.turn,
        ...(this.state.runMode === ConversationRunMode.RuntimePreempted ? [this.state.suspendedTurn] : [])
      ]
      for (const execution of turns.flatMap((turn) => [...turn.executions.values()])) {
        abortEffectIds.set(execution.id, ids.effect())
        persistenceEffectIds.set(execution.id, ids.effect())
      }
    }
    const operationId = crypto.randomUUID() as ConversationStopOperationId
    const turnId =
      this.state.phase === ConversationPhase.Running || this.state.phase === ConversationPhase.Stopping
        ? this.state.turn.id
        : this.state.lastTurnId
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const completed = new Promise<void>((success, failure) => {
      resolve = success
      reject = failure
    })
    const operation: ConversationStopOperation = {
      id: operationId,
      turnId,
      epoch: this.epoch,
      abortEffectIds: new Set(abortEffectIds.values()),
      completed,
      resolve,
      reject,
      phase: ConversationStopOperationPhase.Draining
    }
    this.stopOperation = operation
    void completed.catch(() => {})
    const transition = this.commit({
      type: ConversationCommandType.Stop,
      reason,
      abortEffectIds,
      persistenceEffectIds,
      turnTerminalEffectId: ids.effect(),
      quiescenceEffectId: ids.effect(),
      discardEffectId: ids.effect(),
      dropEffectId: ids.effect()
    })
    if (transition.rejection) {
      this.failStopOperation(operationId, new Error(`Conversation Stop was rejected: ${transition.rejection}`))
    }
    this.completeStopOperationIfReady()
    return { accepted: transition.rejection === undefined, operationId, completed }
  }

  resolveInteraction(
    interactionId: ConversationInteractionId,
    resumeEffectId: ConversationEffectId = this.ids().effect(),
    statusEffectId: ConversationEffectId = this.ids().effect()
  ): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.InteractionResolved,
      turnId: this.state.phase === ConversationPhase.Running ? this.state.turn.id : toConversationTurnId('stale'),
      interactionId,
      resumeEffectId,
      statusEffectId
    })
  }

  rejectRedirectedInput(inputId: ConversationInputId): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.RedirectRejected,
      turnId:
        this.state.phase === ConversationPhase.Running
          ? this.state.turn.id
          : toConversationTurnId('stale-redirect-result'),
      inputId
    })
  }

  acceptRedirects(
    redirectIds: readonly AgentRuntimeRedirectId[],
    segmentId: AgentRuntimeSegmentId
  ): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.RedirectDelivered,
      turnId:
        this.state.phase === ConversationPhase.Running
          ? this.state.turn.id
          : toConversationTurnId('stale-redirect-delivery'),
      redirectIds,
      segmentId
    })
  }

  rejectUndeliveredRedirects(redirectIds: readonly AgentRuntimeRedirectId[]): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.RedirectUndelivered,
      turnId:
        this.state.phase === ConversationPhase.Running
          ? this.state.turn.id
          : toConversationTurnId('stale-redirect-undelivered'),
      redirectIds
    })
  }

  addExecutions(turnId: ConversationTurnId, executions: readonly ConversationExecutionPlan[]): ConversationTransition {
    return this.commit({ type: ConversationCommandType.ExecutionsAdded, turnId, executions })
  }

  restartExecution(turnId: ConversationTurnId, execution: ConversationExecutionPlan): ConversationTransition {
    return this.commit({ type: ConversationCommandType.ExecutionRestarted, turnId, execution })
  }

  openActivity(activity: ConversationActivity): ConversationTransition {
    return this.commit({ type: ConversationCommandType.ActivityOpened, activity })
  }

  closeActivity(activityId: ConversationActivityId): ConversationTransition {
    return this.commit({
      type: ConversationCommandType.ActivityClosed,
      activityId,
      quiescenceEffectId: this.ids().effect()
    })
  }

  kickInbox(): ConversationTransition {
    if (this.inboxPausedValue) return { state: this.state, events: [], effects: [] }
    return this.commit({ type: ConversationCommandType.KickInbox, scheduleEffectId: this.ids().effect() })
  }

  retryBlockedPersistence(): void {
    this.effectExecutor?.retryBlockedPersistence()
  }

  kickDeferredEffects(): void {
    this.effectExecutor?.flushDeferredEffects()
  }

  inFlightPersistenceOperations() {
    return this.effectExecutor?.inFlightPersistenceOperations() ?? []
  }

  private assertCurrent(operation: ConversationAdmissionOperation): void {
    if (operation.epoch !== this.epoch || !this.operations.has(operation.id) || operation.controller?.signal.aborted) {
      this.operations.delete(operation.id)
      if (!this.hasPendingOperations) this.onIdle()
      throw new StaleConversationAdmissionError(this.conversation)
    }
  }

  private completeStopOperationIfReady(): void {
    const operation = this.stopOperation
    if (!operation || operation.phase !== ConversationStopOperationPhase.Draining) return
    if (this.state.phase !== ConversationPhase.Idle) return
    if (operation.turnId && this.state.lastTurnId !== operation.turnId) return
    if ([...this.operations.values()].some(({ epoch }) => epoch < operation.epoch)) return
    if (this.effectOperations.size > 0) return
    operation.phase = ConversationStopOperationPhase.Completed
    operation.resolve()
    this.stopOperation = undefined
  }

  private failStopOperation(id: string, error: unknown): void {
    const operation = this.stopOperation
    if (!operation || operation.phase !== ConversationStopOperationPhase.Draining) return
    const effectId = id.startsWith('abort:') ? id.slice('abort:'.length) : id
    if (id !== operation.id && !operation.abortEffectIds.has(effectId as ConversationEffectId)) return
    operation.phase = ConversationStopOperationPhase.Failed
    operation.reject(error)
    if (this.stopOperation === operation) this.stopOperation = undefined
  }

  private isDeferredResumeApplicable(
    effect: Extract<ConversationEffect, { readonly type: ConversationEffectType.ResumeSuspendedExecution }>
  ): boolean {
    if (
      this.state.phase !== ConversationPhase.Running ||
      this.state.runMode !== ConversationRunMode.Foreground ||
      this.state.turn.id !== effect.turnId
    ) {
      return false
    }
    const execution = this.state.turn.executions.get(effect.executionId)
    return execution?.phase === ConversationExecutionPhase.Starting && execution.runEffectId === effect.runEffectId
  }

  private ids(): ConversationRuntimeIdFactory {
    if (!this.control) throw new Error('ConversationActor control ports are not configured')
    return this.control.ids
  }

  private reserveExecutionMutation(admission: ConversationDispatchAdmission): ConversationDispatchCommitReservation {
    if (admission.executionModelIds.length < 1) throw new Error('Live execution append must reserve an execution')
    const mutation = admission.executionMutation
    if (!mutation) throw new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy)
    if (this.state.phase !== ConversationPhase.Running) throw new Error('Conversation is not running')
    const current = [...this.state.turn.executions.values()].find(
      (execution) => execution.outputNodeId === mutation.outputNodeId
    )
    if (mutation.persistedSiblingsGroupId === 0 && !current) {
      throw new ConversationAdmissionError(ConversationAdmissionReason.TargetNotInLiveGroup)
    }
    if (mutation.kind === ConversationExecutionAdmissionKind.Retry && current) {
      if (current.phase !== ConversationExecutionPhase.Settled) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ExecutionNotReady)
      }
      if (admission.executionModelIds.length !== 1 || current.modelId !== admission.executionModelIds[0]) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ExecutionChanged)
      }
      const execution = {
        executionId: current.id,
        startEffectId: this.ids().effect(),
        modelId: admission.executionModelIds[0]
      }
      this.assertPreview({
        type: ConversationCommandType.ExecutionRestarted,
        turnId: this.state.turn.id,
        execution: {
          id: current.id,
          outputNodeId: current.outputNodeId,
          driver: current.driver,
          modelId: current.modelId,
          startEffectId: execution.startEffectId
        }
      })
      return { kind: ConversationHistoryCommitKind.ExecutionRetry, turnId: this.state.turn.id, execution }
    }
    if ([...this.state.turn.executions.values()].some(({ modelId }) => modelId === admission.executionModelIds[0])) {
      throw new ConversationAdmissionError(ConversationAdmissionReason.ModelAlreadyInLiveGroup)
    }
    const executions = this.reserveExecutionIdentities(admission.executionModelIds)
    this.assertPreview({
      type: ConversationCommandType.ExecutionsAdded,
      turnId: this.state.turn.id,
      executions: this.provisionalExecutionPlans(executions)
    })
    return { kind: ConversationHistoryCommitKind.ExecutionAppend, turnId: this.state.turn.id, executions }
  }

  private reserveExecutionIdentities(modelIds: readonly UniqueModelId[]): readonly ReservedExecutionIdentity[] {
    return modelIds.map((modelId) => ({
      executionId: this.ids().execution(),
      startEffectId: this.ids().effect(),
      modelId
    }))
  }

  private provisionalExecutionPlans(
    identities: readonly ReservedExecutionIdentity[]
  ): readonly ConversationExecutionPlan[] {
    return identities.map((identity) => ({
      id: identity.executionId,
      outputNodeId: `admission:${identity.executionId}`,
      driver:
        this.conversation.kind === ConversationKind.Agent
          ? ConversationExecutionDriverKind.Agent
          : ConversationExecutionDriverKind.Chat,
      modelId: identity.modelId,
      startEffectId: identity.startEffectId
    }))
  }

  private assertPreview(command: ConversationCommand): void {
    const preview = this.preview(command)
    if (preview.rejection) throw new Error(`Conversation admission was rejected: ${preview.rejection}`)
  }
}
