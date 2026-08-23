import { application } from '@application'
import { loggerService } from '@logger'
import { APPROVAL_IDLE_TIMEOUT, DEFAULT_TIMEOUT } from '@main/ai/constants'
import { serializeError } from '@main/ai/utils/serializeError'
import type { IdleTimeoutHandle } from '@main/utils/IdleTimeoutController'
import { shouldDeferToolOutput } from '@main/utils/messageOutputProjection'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import type { CompactionAnchorData, CompactionSink } from '@shared/ai/compaction'
import {
  type ConversationEffectId,
  type ConversationExecutionId,
  type ConversationInteractionId,
  ConversationInteractionKind,
  type ConversationInteractionResumeMode,
  ConversationOutcomeKind,
  type ConversationRef,
  conversationRefKey,
  type ConversationTurnId,
  toConversationInteractionId
} from '@shared/ai/conversation'
import type {
  ConversationExecutionProjection,
  ExecutionReplayCursor,
  ReplayWindow,
  StreamChunkPayload
} from '@shared/ai/transport'
import type { CherryUIMessage, MessageRuntimeTiming } from '@shared/data/types/message'
import type { MessageRuntimeSpan } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { applyTurnOutputAttributes } from '../observability'
import type {
  ConversationExecutionContext,
  ConversationExecutionDriverBinding,
  ConversationExecutionPreparationDescriptor,
  ConversationTelemetryDescriptor
} from '../streamManager'
import type { AiStreamRequest } from '../types'
import { buildCompactReplay, splitDeltaPayload } from './buildCompactReplay'
import {
  type ConversationExecutionDriver,
  type ConversationExecutionDriverControl,
  ConversationExecutionDriverRegistry
} from './ConversationExecutionDriverRegistry'
import type {
  AbortConversationExecutionEffect,
  ConversationExecutionPort,
  ConversationExecutionSink,
  DiscardConversationRuntimeBufferEffect,
  RedirectConversationInputEffect,
  ResumeConversationExecutionEffect,
  ResumeSuspendedConversationExecutionEffect,
  StartConversationExecutionEffect,
  SuspendConversationExecutionEffect
} from './conversationPorts'
import type { ConversationOutcome } from './conversationState'
import { MessageRuntimeTimingCollector } from './MessageRuntimeTimingCollector'
import { pipeStreamLoop } from './pipeStreamLoop'
import { withReasoningTimingMetadata } from './withReasoningTimingMetadata'

const logger = loggerService.withContext('AiExecutionManager')

export interface ConversationExecutionChunk {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly modelId: UniqueModelId
  readonly outputNodeId: string
  readonly chunkSeq: number
  readonly chunk: UIMessageChunk
}

export interface ConversationExecutionObserver {
  readonly id: string
  onChunk(chunk: ConversationExecutionChunk): void
  isAlive(): boolean
}

export interface AiExecutionResourceDescriptor {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly outputNodeId: string
  readonly modelId: UniqueModelId
  readonly preparation: ConversationExecutionPreparationDescriptor
  readonly preparationIndex: number
  readonly driver: ConversationExecutionDriverBinding
  readonly telemetry?: ConversationTelemetryDescriptor
  readonly observers: readonly ConversationExecutionObserver[]
  readonly runtimeTimingSeed?: MessageRuntimeTiming
  readonly maxBufferChunks?: number
  readonly interactionResumeMode: ConversationInteractionResumeMode
}

export type ConversationExecutionDescriptor = AiExecutionResourceDescriptor

export interface ConversationExecutionResult {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly outputNodeId: string
  readonly modelId: UniqueModelId
  readonly outcome: ConversationOutcome
  readonly finalMessage?: CherryUIMessage
  readonly runtimeTiming: MessageRuntimeTiming
}

export interface ConversationExecutionResourceSnapshot {
  readonly projection: ConversationExecutionProjection
  readonly replay: ReplayWindow
  readonly result?: ConversationExecutionResult
}

interface ConversationExecutionResource {
  readonly descriptor: AiExecutionResourceDescriptor
  readonly sink: ConversationExecutionSink
  readonly abortController: AbortController
  readonly runEffectId: ConversationEffectId
  readonly rootSpan?: Span
  readonly observers: Map<string, ConversationExecutionObserver>
  readonly buffer: StreamChunkPayload[]
  readonly runtimeTiming: MessageRuntimeTimingCollector
  readonly runId: number
  readonly pendingInteractionIds: Set<ConversationInteractionId>
  readonly pendingInteractionsByToolCallId: Map<string, ConversationInteractionId>
  readonly suspendedBy?: ConversationEffectId
  nextChunkSeq: number
  firstChunkPublished: boolean
  yieldRequested: boolean
  result?: ConversationExecutionResult
  compactionAnchors?: Array<{ id: string; data: CompactionAnchorData }>
  deferredOutputs?: Map<string, unknown>
  idleTimeout?: IdleTimeoutHandle
}

export type ConversationStreamOpener = (request: AiStreamRequest) => Promise<ReadableStream<UIMessageChunk>>

const MAX_REPLAY_ENTRIES = 10_000
const MAX_REPLAY_DELTA_BYTES = 16 * 1024

function errorFromStreamChunk(errorText: string): SerializedError {
  return { name: 'StreamError', message: errorText, stack: null }
}

function hasHttpMetadata(error: SerializedError): boolean {
  return error.statusCode != null || error.responseBody != null
}

/** Resource-only provider execution registry; each ConversationActor owns control decisions. */
export class AiExecutionManager implements ConversationExecutionPort {
  private readonly descriptors = new Map<
    string,
    { readonly descriptor: AiExecutionResourceDescriptor; readonly abortController: AbortController }
  >()
  private readonly resources = new Map<string, ConversationExecutionResource>()
  private readonly runs = new Map<string, Promise<void>>()
  private readonly preparations = new WeakMap<object, Promise<ConversationExecutionContext>>()
  private nextRunId = 0

  constructor(
    private readonly openStream: ConversationStreamOpener = (request) =>
      application.get('AiService').streamText(request),
    private readonly drivers: ConversationExecutionDriver = new ConversationExecutionDriverRegistry()
  ) {}

  setDriverControl(control: ConversationExecutionDriverControl): void {
    this.drivers.setControl(control)
  }

  register(input: AiExecutionResourceDescriptor): void {
    const key = this.key(input.conversation, input.turnId, input.executionId)
    if (this.descriptors.has(key) || this.resources.has(key)) {
      throw new Error(`Conversation execution already registered: ${key}`)
    }
    this.descriptors.set(key, { descriptor: input, abortController: new AbortController() })
  }

  start(effect: StartConversationExecutionEffect, sink: ConversationExecutionSink): void {
    const key = this.key(effect.conversation, effect.turnId, effect.executionId)
    const registration = this.descriptors.get(key)
    if (!registration) throw new Error(`Conversation execution is not registered: ${key}`)
    this.descriptors.delete(key)
    const { descriptor, abortController } = registration
    const resource: ConversationExecutionResource = {
      descriptor,
      sink,
      abortController,
      runEffectId: effect.effectId,
      rootSpan: this.drivers.openTelemetry(descriptor.telemetry),
      observers: new Map(descriptor.observers.map((observer) => [observer.id, observer])),
      buffer: [],
      runtimeTiming: new MessageRuntimeTimingCollector(descriptor.runtimeTimingSeed),
      runId: ++this.nextRunId,
      pendingInteractionIds: new Set(),
      pendingInteractionsByToolCallId: new Map(),
      nextChunkSeq: 0,
      firstChunkPublished: false,
      yieldRequested: false
    }
    this.resources.set(key, resource)
    this.startRun(key, resource)
  }

  private startRun(key: string, resource: ConversationExecutionResource): void {
    const run = Promise.resolve().then(() => this.run(key, resource))
    this.runs.set(key, run)
    const release = () => {
      if (this.runs.get(key) === run) this.runs.delete(key)
    }
    void run.then(release, release)
  }

  requestYield(conversation: ConversationRef, turnId: ConversationTurnId): void {
    for (const resource of this.resources.values()) {
      if (
        resource.descriptor.turnId === turnId &&
        conversationRefKey(resource.descriptor.conversation) === conversationRefKey(conversation)
      ) {
        resource.yieldRequested = true
      }
    }
  }

  hasYieldRequest(conversation: ConversationRef): boolean {
    return [...this.resources.values()].some(
      (resource) =>
        conversationRefKey(resource.descriptor.conversation) === conversationRefKey(conversation) &&
        resource.yieldRequested
    )
  }

  redirect(effect: RedirectConversationInputEffect): boolean {
    const resource = this.resources.get(this.key(effect.conversation, effect.turnId, effect.executionId))
    return resource ? this.drivers.redirect(effect) : false
  }

  resume(effect: ResumeConversationExecutionEffect): void {
    const resource = this.resources.get(this.key(effect.conversation, effect.turnId, effect.executionId))
    if (resource && this.forgetPendingInteraction(resource, effect.interactionId)) {
      this.trimReplayBuffer(resource)
    }
    resource?.idleTimeout?.reset(resource.pendingInteractionIds.size > 0 ? APPROVAL_IDLE_TIMEOUT : undefined)
  }

  suspend(effect: SuspendConversationExecutionEffect): boolean {
    const key = this.key(effect.conversation, effect.turnId, effect.executionId)
    const resource = this.resources.get(key)
    if (!resource || resource.firstChunkPublished || resource.result || resource.suspendedBy) return false
    const suspended: ConversationExecutionResource = {
      ...resource,
      runId: ++this.nextRunId,
      suspendedBy: effect.effectId,
      idleTimeout: undefined
    }
    this.resources.set(key, suspended)
    if (!this.drivers.suspend(resource.descriptor.driver, effect)) {
      this.resources.set(key, resource)
      return false
    }
    return true
  }

  resumeSuspended(effect: ResumeSuspendedConversationExecutionEffect): void {
    const key = this.key(effect.conversation, effect.turnId, effect.executionId)
    const resource = this.resources.get(key)
    if (
      !resource ||
      resource.runEffectId !== effect.runEffectId ||
      resource.suspendedBy !== effect.suspendEffectId ||
      resource.result
    ) {
      throw new Error(`Conversation execution is not suspended by ${effect.suspendEffectId}`)
    }
    this.drivers.resumeSuspended(resource.descriptor.driver, effect)
    const resumed: ConversationExecutionResource = {
      ...resource,
      runId: ++this.nextRunId,
      suspendedBy: undefined,
      idleTimeout: undefined
    }
    this.resources.set(key, resumed)
    this.startRun(key, resumed)
  }

  discardRuntimeBuffer(effect: DiscardConversationRuntimeBufferEffect): void {
    for (const resource of this.resources.values()) {
      if (
        conversationRefKey(resource.descriptor.conversation) === conversationRefKey(effect.conversation) &&
        resource.descriptor.turnId === effect.turnId
      ) {
        this.drivers.discardRuntimeBuffer(resource.descriptor.driver, effect)
      }
    }
  }

  abort(effect: AbortConversationExecutionEffect): void {
    const key = this.key(effect.conversation, effect.turnId, effect.executionId)
    const descriptor = this.descriptors.get(key)
    if (descriptor) {
      this.descriptors.delete(key)
      descriptor.abortController.abort(effect.reason)
      return
    }
    const resource = this.resources.get(key)
    if (!resource) return
    resource.abortController.abort(effect.reason)
    if (resource.suspendedBy && !resource.result) {
      const outcome: ConversationOutcome = { kind: ConversationOutcomeKind.Paused, reason: effect.reason }
      resource.runtimeTiming.closeOpenToolSpans()
      resource.runtimeTiming.closeOpenSpans()
      resource.runtimeTiming.complete()
      resource.result = {
        conversation: resource.descriptor.conversation,
        turnId: resource.descriptor.turnId,
        executionId: resource.descriptor.executionId,
        outputNodeId: resource.descriptor.outputNodeId,
        modelId: resource.descriptor.modelId,
        outcome,
        runtimeTiming: resource.runtimeTiming.snapshot()
      }
      resource.sink.terminal(outcome)
    }
  }

  attachSnapshot(
    conversation: ConversationRef,
    turnId: ConversationTurnId,
    observer: ConversationExecutionObserver,
    cursors: readonly ExecutionReplayCursor[] = []
  ): readonly ConversationExecutionResourceSnapshot[] {
    const cursorByExecution = new Map(
      cursors
        .filter((cursor) => cursor.turnId === turnId)
        .map((cursor) => [cursor.executionId, cursor.throughChunkSeq] as const)
    )
    const snapshots: ConversationExecutionResourceSnapshot[] = []
    for (const resource of this.resources.values()) {
      if (
        conversationRefKey(resource.descriptor.conversation) !== conversationRefKey(conversation) ||
        resource.descriptor.turnId !== turnId
      ) {
        continue
      }
      resource.observers.set(observer.id, observer)
      snapshots.push({
        projection: {
          turnId: resource.descriptor.turnId,
          executionId: resource.descriptor.executionId,
          modelId: resource.descriptor.modelId,
          outputNodeId: resource.descriptor.outputNodeId
        },
        replay: this.replayWindow(resource, cursorByExecution.get(resource.descriptor.executionId) ?? 0),
        ...(resource.result ? { result: resource.result } : {})
      })
    }
    return snapshots
  }

  observe(conversation: ConversationRef, turnId: ConversationTurnId, observer: ConversationExecutionObserver): void {
    for (const resource of this.resources.values()) {
      if (
        conversationRefKey(resource.descriptor.conversation) === conversationRefKey(conversation) &&
        resource.descriptor.turnId === turnId
      ) {
        resource.observers.set(observer.id, observer)
      }
    }
  }

  detach(conversation: ConversationRef, observerId: string): void {
    for (const resource of this.resources.values()) {
      if (conversationRefKey(resource.descriptor.conversation) === conversationRefKey(conversation)) {
        resource.observers.delete(observerId)
      }
    }
  }

  result(
    conversation: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId
  ): ConversationExecutionResult | undefined {
    return this.resources.get(this.key(conversation, turnId, executionId))?.result
  }

  release(conversation: ConversationRef, turnId: ConversationTurnId, executionId: ConversationExecutionId): void {
    const key = this.key(conversation, turnId, executionId)
    this.descriptors.get(key)?.abortController.abort('execution released')
    this.descriptors.delete(key)
    this.resources.get(key)?.abortController.abort('execution released')
    this.resources.delete(key)
  }

  deferredOutput(
    conversation: ConversationRef,
    outputNodeId: string,
    toolCallId: string
  ): { found: true; output: unknown } | { found: false } {
    for (const resource of this.resources.values()) {
      if (conversationRefKey(resource.descriptor.conversation) !== conversationRefKey(conversation)) continue
      if (resource.descriptor.outputNodeId !== outputNodeId) continue
      if (resource.deferredOutputs?.has(toolCallId)) {
        return { found: true, output: resource.deferredOutputs.get(toolCallId) }
      }
    }
    return { found: false }
  }

  addCompletedRuntimeSpan(conversation: ConversationRef, outputNodeId: string, span: MessageRuntimeSpan): boolean {
    for (const resource of this.resources.values()) {
      if (
        conversationRefKey(resource.descriptor.conversation) === conversationRefKey(conversation) &&
        resource.descriptor.outputNodeId === outputNodeId
      ) {
        resource.runtimeTiming.addCompletedSpan(span)
        return true
      }
    }
    return false
  }

  inFlightRuns(): Promise<void>[] {
    return [...this.runs.values()]
  }

  inFlightOperations(): ReadonlyArray<{ id: string; run: Promise<void> }> {
    return [...this.runs].map(([id, run]) => ({ id: id.replaceAll('\0', '/'), run }))
  }

  private async run(key: string, resource: ConversationExecutionResource): Promise<void> {
    const { descriptor, abortController } = resource
    const signal = abortController.signal
    try {
      const compactionSink: CompactionSink = (anchorId, data) => {
        this.onChunk(key, resource, { type: 'data-compaction-anchor', id: anchorId, data })
        if (!this.isCurrentResource(key, resource)) return
        const anchors = (resource.compactionAnchors ??= [])
        const index = anchors.findIndex((anchor) => anchor.id === anchorId)
        if (index >= 0) anchors[index] = { id: anchorId, data }
        else anchors.push({ id: anchorId, data })
      }
      let preparation = this.preparations.get(descriptor.preparation)
      if (!preparation) {
        preparation = this.drivers.prepare(descriptor.preparation, descriptor.driver, signal, compactionSink)
        this.preparations.set(descriptor.preparation, preparation)
      }
      const context = await preparation
      if (conversationRefKey(context.conversation) !== conversationRefKey(descriptor.conversation)) {
        throw new Error('Execution driver prepared another Conversation')
      }
      const prepared = context.models[descriptor.preparationIndex]
      if (
        !prepared ||
        prepared.modelId !== descriptor.modelId ||
        prepared.request.messageId !== descriptor.outputNodeId
      ) {
        throw new Error('Execution driver changed a committed execution identity')
      }
      const request = prepared.request
      this.drivers.annotateTelemetry(descriptor.telemetry, resource.rootSpan, request.messages ?? [])
      signal.throwIfAborted()
      if (!this.isCurrentResource(key, resource)) return
      const streamRequest = {
        ...request,
        requestOptions: { ...request.requestOptions, signal },
        runtimeTimingSink: resource.runtimeTiming.sink,
        compactionSink
      } as AiStreamRequest
      const rawStream = await this.openStream(streamRequest)
      if (!this.isCurrentResource(key, resource)) {
        await rawStream.cancel(signal.reason).catch(() => {})
        return
      }
      const timeoutMs = request.requestOptions?.timeout ?? DEFAULT_TIMEOUT
      const { stream: idleStream, idle } = withIdleTimeout(rawStream, abortController, timeoutMs)
      resource.idleTimeout = idle
      const stream = withReasoningTimingMetadata(idleStream)
      const lastIncoming = request.messages?.at(-1)
      const accumulatorSeed: CherryUIMessage | undefined =
        lastIncoming?.role === 'assistant' ? (lastIncoming as CherryUIMessage) : undefined
      const result = await pipeStreamLoop(stream, signal, {
        onChunk: (chunk) => this.onChunk(key, resource, chunk),
        accumulatorSeed
      })
      if (!this.isCurrentResource(key, resource)) return
      let outcome: ConversationOutcome
      if (signal.aborted) {
        outcome = { kind: ConversationOutcomeKind.Paused, reason: String(signal.reason ?? 'aborted') }
      } else if (result.threw) {
        const thrown = serializeError(result.threw.error)
        outcome = {
          kind: ConversationOutcomeKind.Error,
          error:
            result.streamErrorText && !hasHttpMetadata(thrown) ? errorFromStreamChunk(result.streamErrorText) : thrown
        }
      } else if (result.streamErrorText) {
        outcome = {
          kind: ConversationOutcomeKind.Error,
          error: errorFromStreamChunk(result.streamErrorText)
        }
      } else {
        outcome = { kind: ConversationOutcomeKind.Success }
      }
      const finalMessage = result.finalMessage
        ? this.withCompactionAnchors(result.finalMessage, resource.compactionAnchors)
        : undefined
      resource.runtimeTiming.closeOpenToolSpans()
      resource.runtimeTiming.closeOpenSpans()
      resource.runtimeTiming.complete()
      resource.result = {
        conversation: descriptor.conversation,
        turnId: descriptor.turnId,
        executionId: descriptor.executionId,
        outputNodeId: descriptor.outputNodeId,
        modelId: descriptor.modelId,
        outcome,
        finalMessage,
        runtimeTiming: resource.runtimeTiming.snapshot()
      }
      this.endRootSpan(resource.rootSpan, finalMessage, outcome)
      resource.sink.terminal(outcome)
    } catch (error) {
      const outcome: ConversationOutcome = signal.aborted
        ? { kind: ConversationOutcomeKind.Paused, reason: String(signal.reason ?? 'aborted') }
        : { kind: ConversationOutcomeKind.Error, error: serializeError(error) }
      resource.runtimeTiming.closeOpenToolSpans()
      resource.runtimeTiming.closeOpenSpans()
      resource.runtimeTiming.complete()
      resource.result = {
        conversation: descriptor.conversation,
        turnId: descriptor.turnId,
        executionId: descriptor.executionId,
        outputNodeId: descriptor.outputNodeId,
        modelId: descriptor.modelId,
        outcome,
        runtimeTiming: resource.runtimeTiming.snapshot()
      }
      this.endRootSpan(resource.rootSpan, undefined, outcome)
      if (this.resources.get(key)?.runId === resource.runId) resource.sink.terminal(outcome)
    }
  }

  private onChunk(key: string, resource: ConversationExecutionResource, chunk: UIMessageChunk): void {
    if (!this.isCurrentResource(key, resource)) return
    if (!resource.firstChunkPublished) {
      resource.firstChunkPublished = true
      resource.sink.firstChunk()
    }
    if (chunk.type === 'tool-approval-request') {
      const interactionId = toConversationInteractionId(chunk.approvalId)
      resource.pendingInteractionIds.add(interactionId)
      resource.pendingInteractionsByToolCallId.set(chunk.toolCallId, interactionId)
      resource.sink.interactionOpened({
        id: interactionId,
        executionId: resource.descriptor.executionId,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: resource.descriptor.interactionResumeMode
      })
    }
    if (chunk.type === 'tool-output-available') {
      const interactionId = resource.pendingInteractionsByToolCallId.get(chunk.toolCallId)
      if (interactionId && this.forgetPendingInteraction(resource, interactionId)) {
        resource.sink.interactionCompleted(interactionId)
      }
    }
    resource.idleTimeout?.reset(resource.pendingInteractionIds.size > 0 ? APPROVAL_IDLE_TIMEOUT : undefined)
    if (chunk.type === 'tool-output-available' && shouldDeferToolOutput(chunk.output)) {
      const outputs = (resource.deferredOutputs ??= new Map())
      outputs.set(chunk.toolCallId, chunk.output)
      if (outputs.size > 16) outputs.delete(outputs.keys().next().value as string)
    }
    const payload: ConversationExecutionChunk = {
      conversation: resource.descriptor.conversation,
      turnId: resource.descriptor.turnId,
      executionId: resource.descriptor.executionId,
      modelId: resource.descriptor.modelId,
      outputNodeId: resource.descriptor.outputNodeId,
      chunkSeq: ++resource.nextChunkSeq,
      chunk
    }
    resource.buffer.push({ ...payload, throughChunkSeq: payload.chunkSeq })
    this.trimReplayBuffer(resource)
    const dead: string[] = []
    for (const [id, observer] of resource.observers) {
      if (!observer.isAlive()) dead.push(id)
      else {
        try {
          observer.onChunk(payload)
        } catch (error) {
          dead.push(id)
          logger.warn('Conversation execution observer rejected a chunk', {
            conversation: conversationRefKey(resource.descriptor.conversation),
            turnId: resource.descriptor.turnId,
            executionId: resource.descriptor.executionId,
            observerId: id,
            error
          })
        }
      }
    }
    for (const id of dead) resource.observers.delete(id)
  }

  private isCurrentResource(key: string, resource: ConversationExecutionResource): boolean {
    return this.resources.get(key)?.runId === resource.runId
  }

  private key(ref: ConversationRef, turnId: ConversationTurnId, executionId: ConversationExecutionId): string {
    return `${conversationRefKey(ref)}\0${turnId}\0${executionId}`
  }

  private replayWindow(resource: ConversationExecutionResource, cursor: number): ReplayWindow {
    const suffix = resource.buffer.filter((payload) => payload.chunkSeq > cursor)
    const chunks = buildCompactReplay(
      suffix.flatMap((payload) => splitDeltaPayload(payload, MAX_REPLAY_DELTA_BYTES)),
      MAX_REPLAY_DELTA_BYTES
    )
    const firstAvailableChunkSeq = resource.buffer[0]?.chunkSeq ?? resource.nextChunkSeq + 1
    let nextCoveredChunkSeq = cursor + 1
    let truncated = firstAvailableChunkSeq > cursor + 1
    for (const payload of suffix) {
      if (payload.chunkSeq > nextCoveredChunkSeq) truncated = true
      nextCoveredChunkSeq = Math.max(nextCoveredChunkSeq, payload.chunkSeq + 1)
    }
    if (nextCoveredChunkSeq <= resource.nextChunkSeq) truncated = true
    return {
      chunks,
      throughChunkSeq: resource.nextChunkSeq,
      firstAvailableChunkSeq,
      truncated
    }
  }

  private trimReplayBuffer(resource: ConversationExecutionResource): void {
    const limit = Math.max(1, Math.min(MAX_REPLAY_ENTRIES, resource.descriptor.maxBufferChunks ?? MAX_REPLAY_ENTRIES))
    while (resource.buffer.length > limit) {
      const pendingToolCallIds = new Set(resource.pendingInteractionsByToolCallId.keys())
      const evictable = resource.buffer.findIndex(({ chunk }) => {
        if (
          chunk.type === 'tool-approval-request' &&
          resource.pendingInteractionIds.has(toConversationInteractionId(chunk.approvalId))
        ) {
          return false
        }
        if (
          (chunk.type === 'tool-input-start' ||
            chunk.type === 'tool-input-delta' ||
            chunk.type === 'tool-input-available') &&
          pendingToolCallIds.has(chunk.toolCallId)
        ) {
          return false
        }
        return true
      })
      if (evictable < 0) return
      this.evictReplayEntry(resource.buffer, evictable)
    }
  }

  private forgetPendingInteraction(
    resource: ConversationExecutionResource,
    interactionId: ConversationInteractionId
  ): boolean {
    if (!resource.pendingInteractionIds.delete(interactionId)) return false
    for (const [toolCallId, pendingInteractionId] of resource.pendingInteractionsByToolCallId) {
      if (pendingInteractionId === interactionId) resource.pendingInteractionsByToolCallId.delete(toolCallId)
    }
    const approvalIndex = resource.buffer.findIndex(
      ({ chunk }) =>
        chunk.type === 'tool-approval-request' && toConversationInteractionId(chunk.approvalId) === interactionId
    )
    if (approvalIndex >= 0) resource.buffer.splice(approvalIndex, 1)
    return true
  }

  private evictReplayEntry(buffer: StreamChunkPayload[], index: number): void {
    const [removed] = buffer.splice(index, 1)
    if (!removed) return
    const chunk = removed.chunk
    if (chunk.type === 'text-start' || chunk.type === 'reasoning-start') {
      return
    }
    if (chunk.type !== 'tool-input-start') return
    for (let cursor = index; cursor < buffer.length; ) {
      const candidate = buffer[cursor].chunk
      if (candidate.type === 'tool-input-start' && candidate.toolCallId === chunk.toolCallId) return
      if (candidate.type === 'tool-input-available' && candidate.toolCallId === chunk.toolCallId) return
      if (candidate.type === 'tool-input-delta' && candidate.toolCallId === chunk.toolCallId) {
        buffer.splice(cursor, 1)
      } else cursor += 1
    }
  }

  private withCompactionAnchors(
    message: CherryUIMessage,
    anchors: readonly { id: string; data: CompactionAnchorData }[] | undefined
  ): CherryUIMessage {
    if (!anchors?.length) return message
    const parts = [...message.parts]
    for (const anchor of anchors) {
      const index = parts.findIndex((part) => part.type === 'data-compaction-anchor' && part.id === anchor.id)
      if (anchor.data.status === 'skipped') {
        if (index >= 0) parts.splice(index, 1)
        continue
      }
      const part = { type: 'data-compaction-anchor' as const, id: anchor.id, data: anchor.data }
      if (index >= 0) parts[index] = part
      else parts.push(part)
    }
    return { ...message, parts }
  }

  private endRootSpan(
    span: Span | undefined,
    message: CherryUIMessage | undefined,
    outcome: ConversationOutcome
  ): void {
    if (!span) return
    try {
      if (message) applyTurnOutputAttributes(span, message)
      if (outcome.kind === ConversationOutcomeKind.Success) {
        span.setStatus({ code: SpanStatusCode.OK })
      } else {
        const errorMessage = outcome.kind === ConversationOutcomeKind.Error ? outcome.error.message : outcome.reason
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage ?? undefined })
        if (outcome.kind === ConversationOutcomeKind.Error) {
          span.recordException({
            name: outcome.error.name ?? 'StreamError',
            message: outcome.error.message ?? undefined,
            stack: outcome.error.stack ?? undefined
          })
        }
      }
      span.end()
    } catch {
      // Trace finalization is observational and must not change the execution outcome.
    }
  }
}
