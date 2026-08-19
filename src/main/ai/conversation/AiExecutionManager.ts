import { application } from '@application'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { serializeError } from '@main/ai/utils/serializeError'
import { shouldDeferToolOutput } from '@main/utils/messageOutputProjection'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import type { CompactionAnchorData } from '@shared/ai/compaction'
import {
  type ConversationExecutionId,
  ConversationInteractionKind,
  type ConversationInteractionResumeMode,
  ConversationOutcomeKind,
  type ConversationRef,
  conversationRefKey,
  type ConversationTurnId,
  toConversationInteractionId
} from '@shared/ai/conversation'
import type { CherryUIMessage, MessageRuntimeTiming } from '@shared/data/types/message'
import type { MessageRuntimeSpan } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

import { applyTurnOutputAttributes } from '../observability'
import type { AiStreamRequest } from '../types'
import type {
  AbortConversationExecutionEffect,
  ConversationExecutionPort,
  ConversationExecutionSink,
  RedirectConversationInputEffect,
  ResumeConversationExecutionEffect,
  StartConversationExecutionEffect
} from './conversationPorts'
import type { ConversationOutcome } from './conversationState'
import { MessageRuntimeTimingCollector } from './MessageRuntimeTimingCollector'
import { pipeStreamLoop } from './pipeStreamLoop'
import { withReasoningTimingMetadata } from './withReasoningTimingMetadata'

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

export interface ConversationExecutionDescriptor {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly outputNodeId: string
  readonly modelId: UniqueModelId
  readonly request: AiStreamRequest | ((signal: AbortSignal) => Promise<AiStreamRequest>)
  readonly observers: readonly ConversationExecutionObserver[]
  readonly runtimeTimingSeed?: MessageRuntimeTiming
  readonly rootSpan?: Span
  readonly abortController?: AbortController
  readonly maxBufferChunks?: number
  readonly redirect?: (effect: RedirectConversationInputEffect) => boolean
  readonly resume?: (effect: ResumeConversationExecutionEffect) => void
  readonly interactionResumeMode: ConversationInteractionResumeMode
}

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

interface ConversationExecutionResource {
  readonly descriptor: ConversationExecutionDescriptor
  readonly sink: ConversationExecutionSink
  readonly abortController: AbortController
  readonly observers: Map<string, ConversationExecutionObserver>
  readonly buffer: ConversationExecutionChunk[]
  readonly runtimeTiming: MessageRuntimeTimingCollector
  readonly runId: number
  loopPromise: Promise<void>
  nextChunkSeq: number
  firstChunkPublished: boolean
  yieldRequested: boolean
  result?: ConversationExecutionResult
  compactionAnchors?: Array<{ id: string; data: CompactionAnchorData }>
  deferredOutputs?: Map<string, unknown>
}

export type ConversationStreamOpener = (request: AiStreamRequest) => Promise<ReadableStream<UIMessageChunk>>

/** Resource-only provider execution registry; ConversationRuntime owns every control decision. */
export class AiExecutionManager implements ConversationExecutionPort {
  private readonly descriptors = new Map<string, ConversationExecutionDescriptor>()
  private readonly resources = new Map<string, ConversationExecutionResource>()
  private nextRunId = 0

  constructor(
    private readonly openStream: ConversationStreamOpener = (request) =>
      application.get('AiService').streamText(request)
  ) {}

  register(input: ConversationExecutionDescriptor): void {
    const key = this.key(input.conversation, input.turnId, input.executionId)
    if (this.descriptors.has(key) || this.resources.has(key)) {
      throw new Error(`Conversation execution already registered: ${key}`)
    }
    this.descriptors.set(key, input)
  }

  start(effect: StartConversationExecutionEffect, sink: ConversationExecutionSink): void {
    const key = this.key(effect.conversation, effect.turnId, effect.executionId)
    const descriptor = this.descriptors.get(key)
    if (!descriptor) throw new Error(`Conversation execution is not registered: ${key}`)
    this.descriptors.delete(key)
    const resource: ConversationExecutionResource = {
      descriptor,
      sink,
      abortController: descriptor.abortController ?? new AbortController(),
      observers: new Map(descriptor.observers.map((observer) => [observer.id, observer])),
      buffer: [],
      runtimeTiming: new MessageRuntimeTimingCollector(descriptor.runtimeTimingSeed),
      runId: ++this.nextRunId,
      loopPromise: Promise.resolve(),
      nextChunkSeq: 0,
      firstChunkPublished: false,
      yieldRequested: false
    }
    this.resources.set(key, resource)
    resource.loopPromise = this.run(key, resource)
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
    return resource?.descriptor.redirect?.(effect) === true
  }

  resume(effect: ResumeConversationExecutionEffect): void {
    const resource = this.resources.get(this.key(effect.conversation, effect.turnId, effect.executionId))
    resource?.descriptor.resume?.(effect)
  }

  abort(effect: AbortConversationExecutionEffect): void {
    const key = this.key(effect.conversation, effect.turnId, effect.executionId)
    const descriptor = this.descriptors.get(key)
    if (descriptor) {
      this.descriptors.delete(key)
      descriptor.abortController?.abort(effect.reason)
      return
    }
    this.resources.get(key)?.abortController.abort(effect.reason)
  }

  attach(
    conversation: ConversationRef,
    observer: ConversationExecutionObserver
  ): readonly ConversationExecutionChunk[] {
    const replay: ConversationExecutionChunk[] = []
    for (const resource of this.resources.values()) {
      if (conversationRefKey(resource.descriptor.conversation) !== conversationRefKey(conversation)) continue
      resource.observers.set(observer.id, observer)
      replay.push(...resource.buffer)
    }
    return replay.sort((left, right) => left.chunkSeq - right.chunkSeq)
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
    this.descriptors.delete(key)
    this.resources.delete(key)
  }

  deferredOutput(
    conversation: ConversationRef,
    toolCallId: string
  ): { found: true; output: unknown } | { found: false } {
    for (const resource of this.resources.values()) {
      if (conversationRefKey(resource.descriptor.conversation) !== conversationRefKey(conversation)) continue
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
    return [...this.resources.values()].map((resource) => resource.loopPromise)
  }

  private async run(key: string, resource: ConversationExecutionResource): Promise<void> {
    const { descriptor, abortController } = resource
    const signal = abortController.signal
    try {
      const request = typeof descriptor.request === 'function' ? await descriptor.request(signal) : descriptor.request
      const streamRequest = {
        ...request,
        requestOptions: { ...request.requestOptions, signal },
        runtimeTimingSink: resource.runtimeTiming.sink,
        compactionSink: (anchorId: string, data: CompactionAnchorData) => {
          this.onChunk(resource, { type: 'data-compaction-anchor', id: anchorId, data })
          const anchors = (resource.compactionAnchors ??= [])
          const index = anchors.findIndex((anchor) => anchor.id === anchorId)
          if (index >= 0) anchors[index] = { id: anchorId, data }
          else anchors.push({ id: anchorId, data })
        }
      } as AiStreamRequest
      const rawStream = await this.openStream(streamRequest)
      const timeoutMs = request.requestOptions?.timeout ?? DEFAULT_TIMEOUT
      const { stream: idleStream } = withIdleTimeout(rawStream, abortController, timeoutMs)
      const stream = withReasoningTimingMetadata(idleStream)
      const lastIncoming = request.messages?.at(-1)
      const accumulatorSeed: CherryUIMessage | undefined =
        lastIncoming?.role === 'assistant' ? (lastIncoming as CherryUIMessage) : undefined
      const result = await pipeStreamLoop(stream, signal, {
        onChunk: (chunk) => this.onChunk(resource, chunk),
        accumulatorSeed
      })
      let outcome: ConversationOutcome
      if (signal.aborted) {
        outcome = { kind: ConversationOutcomeKind.Paused, reason: String(signal.reason ?? 'aborted') }
      } else if (result.streamErrorText) {
        outcome = {
          kind: ConversationOutcomeKind.Error,
          error: serializeError(new Error(result.streamErrorText))
        }
      } else if (result.threw) {
        outcome = { kind: ConversationOutcomeKind.Error, error: serializeError(result.threw.error) }
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
      this.endRootSpan(descriptor.rootSpan, finalMessage, outcome)
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
      this.endRootSpan(descriptor.rootSpan, undefined, outcome)
      if (this.resources.get(key)?.runId === resource.runId) resource.sink.terminal(outcome)
    }
  }

  private onChunk(resource: ConversationExecutionResource, chunk: UIMessageChunk): void {
    if (!resource.firstChunkPublished) {
      resource.firstChunkPublished = true
      resource.sink.firstChunk()
    }
    if (chunk.type === 'tool-approval-request') {
      resource.sink.interactionOpened({
        id: toConversationInteractionId(chunk.approvalId),
        executionId: resource.descriptor.executionId,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: resource.descriptor.interactionResumeMode
      })
    }
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
    resource.buffer.push(payload)
    const limit = Math.max(1, resource.descriptor.maxBufferChunks ?? 512)
    if (resource.buffer.length > limit) resource.buffer.splice(0, resource.buffer.length - limit)
    const dead: string[] = []
    for (const [id, observer] of resource.observers) {
      if (!observer.isAlive()) dead.push(id)
      else observer.onChunk(payload)
    }
    for (const id of dead) resource.observers.delete(id)
  }

  private key(ref: ConversationRef, turnId: ConversationTurnId, executionId: ConversationExecutionId): string {
    return `${conversationRefKey(ref)}\0${turnId}\0${executionId}`
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
