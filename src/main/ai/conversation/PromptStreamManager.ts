import { application } from '@application'
import { loggerService } from '@logger'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { serializeError } from '@main/ai/utils/serializeError'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { ConversationOutcomeKind } from '@shared/ai/conversation'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import type {
  StreamCleanupPort,
  StreamDoneResult,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult,
  StreamPersistencePort
} from '../streamManager'
import type { AiStreamRequest, CallOverrides, ContextOwner, InProcessUsageContext } from '../types'
import { MessageRuntimeTimingCollector } from './MessageRuntimeTimingCollector'
import { pipeStreamLoop } from './pipeStreamLoop'
import { withReasoningTimingMetadata } from './withReasoningTimingMetadata'

const logger = loggerService.withContext('PromptStreamManager')

interface PromptResource {
  readonly streamId: string
  readonly modelId: UniqueModelId
  readonly abortController: AbortController
  readonly listeners: Set<StreamListener>
  readonly persistencePorts: readonly StreamPersistencePort[]
  readonly cleanupPorts: readonly StreamCleanupPort[]
  readonly request: AiStreamRequest & { usageContext?: InProcessUsageContext }
  readonly timing: MessageRuntimeTimingCollector
  run: Promise<void>
}

export interface PromptStreamInput {
  streamId: string
  uniqueModelId: UniqueModelId
  prompt?: string
  messages?: CherryUIMessage[]
  listener: StreamListener | StreamListener[]
  persistencePorts?: StreamPersistencePort[]
  cleanupPorts?: StreamCleanupPort[]
  callOverrides?: CallOverrides
  contextOwner?: ContextOwner
  reasoningEffort?: ReasoningEffortOption
  idleTimeoutMs?: number
  usageContext?: InProcessUsageContext
}

@Injectable('PromptStreamManager')
@ServicePhase(Phase.WhenReady)
export class PromptStreamManager extends BaseService {
  private readonly resources = new Map<string, PromptResource>()
  private readonly pauseHolds = new Set<symbol>()

  streamPrompt(input: PromptStreamInput): void {
    if (this.isWriteQuiesced) throw new Error('PromptStreamManager is write-quiesced')
    if (this.resources.has(input.streamId)) throw new Error(`Prompt stream already exists: ${input.streamId}`)
    const messages = input.messages?.length
      ? input.messages
      : ([
          { id: 'prompt-user', role: 'user', parts: [{ type: 'text', text: input.prompt ?? '' }] }
        ] as CherryUIMessage[])
    const request: PromptResource['request'] = {
      chatId: input.usageContext?.agentSessionId ?? input.streamId,
      trigger: 'submit-message',
      uniqueModelId: input.uniqueModelId,
      messages,
      callOverrides: input.callOverrides,
      contextOwner: input.contextOwner,
      reasoningEffort: input.reasoningEffort,
      ...(input.usageContext ? { usageContext: input.usageContext } : {}),
      ...(input.idleTimeoutMs !== undefined ? { requestOptions: { timeout: input.idleTimeoutMs } } : {})
    }
    const resource: PromptResource = {
      streamId: input.streamId,
      modelId: input.uniqueModelId,
      abortController: new AbortController(),
      listeners: new Set(Array.isArray(input.listener) ? input.listener : [input.listener]),
      persistencePorts: input.persistencePorts ?? [],
      cleanupPorts: input.cleanupPorts ?? [],
      request,
      timing: new MessageRuntimeTimingCollector(),
      run: Promise.resolve()
    }
    this.resources.set(input.streamId, resource)
    resource.run = this.run(resource).finally(() => this.resources.delete(input.streamId))
  }

  abort(streamId: string, reason: string): void {
    this.resources.get(streamId)?.abortController.abort(reason)
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'prompt-stream-pause')
    this.pauseHolds.add(token)
    return { dispose: () => void this.pauseHolds.delete(token) }
  }

  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  hasLiveStreams(): boolean {
    return this.resources.size > 0
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return [...this.resources.keys()].map((id) => ({ id, summary: 'prompt-stream' }))
  }

  async drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    const current = [...this.resources.values()]
    if (current.length === 0) return { stragglerIds: [] }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), options.timeoutMs)
    })
    const result = await Promise.race([
      Promise.allSettled(current.map(({ run }) => run)).then(() => 'done' as const),
      timeout
    ])
    if (timer) clearTimeout(timer)
    return result === 'done' ? { stragglerIds: [] } : { stragglerIds: current.map(({ streamId }) => streamId) }
  }

  protected async onStop(): Promise<void> {
    const resources = [...this.resources.values()]
    for (const resource of resources) resource.abortController.abort('app-shutdown')
    await Promise.allSettled(resources.map(({ run }) => run))
  }

  private async run(resource: PromptResource): Promise<void> {
    const signal = resource.abortController.signal
    let finalMessage: CherryUIMessage | undefined
    try {
      const raw = await application.get('AiService').streamText({
        ...resource.request,
        requestOptions: { ...resource.request.requestOptions, signal },
        runtimeTimingSink: resource.timing.sink
      })
      const { stream } = withIdleTimeout(
        raw,
        resource.abortController,
        resource.request.requestOptions?.timeout ?? DEFAULT_TIMEOUT
      )
      const result = await pipeStreamLoop(withReasoningTimingMetadata(stream), signal, {
        onChunk: (chunk) => {
          for (const listener of [...resource.listeners]) {
            try {
              if (!listener.isAlive()) {
                resource.listeners.delete(listener)
                continue
              }
              listener.onChunk(chunk)
            } catch (error) {
              resource.listeners.delete(listener)
              logger.warn('Prompt stream chunk observer failed; detaching observer', {
                streamId: resource.streamId,
                listenerId: listener.id,
                error
              })
            }
          }
        },
        onAccumulatedSnapshot: (snapshot) => {
          finalMessage = snapshot
        }
      })
      finalMessage = result.finalMessage ?? finalMessage
      if (signal.aborted) {
        await this.publish(resource, {
          status: ConversationOutcomeKind.Paused,
          finalMessage,
          modelId: resource.modelId,
          runtimeTiming: resource.timing.snapshot(),
          turnTerminal: true
        })
      } else if (result.streamErrorText || result.threw) {
        await this.publish(resource, {
          status: ConversationOutcomeKind.Error,
          error: serializeError(result.threw?.error ?? new Error(result.streamErrorText)),
          finalMessage,
          modelId: resource.modelId,
          runtimeTiming: resource.timing.snapshot(),
          turnTerminal: true
        })
      } else {
        await this.publish(resource, {
          status: ConversationOutcomeKind.Success,
          finalMessage,
          modelId: resource.modelId,
          runtimeTiming: resource.timing.snapshot(),
          turnTerminal: true
        })
      }
    } catch (error) {
      const terminal: StreamPausedResult | StreamErrorResult = signal.aborted
        ? {
            status: ConversationOutcomeKind.Paused,
            finalMessage,
            modelId: resource.modelId,
            runtimeTiming: resource.timing.snapshot(),
            turnTerminal: true
          }
        : {
            status: ConversationOutcomeKind.Error,
            error: serializeError(error),
            finalMessage,
            modelId: resource.modelId,
            runtimeTiming: resource.timing.snapshot(),
            turnTerminal: true
          }
      await this.publish(resource, terminal)
    }
  }

  private async publish(
    resource: PromptResource,
    terminal: StreamDoneResult | StreamPausedResult | StreamErrorResult
  ): Promise<void> {
    try {
      for (const port of resource.persistencePorts) {
        if (terminal.status === ConversationOutcomeKind.Success) await port.onDone(terminal)
        else if (terminal.status === ConversationOutcomeKind.Paused) await port.onPaused(terminal)
        else await port.onError(terminal)
      }
    } catch (error) {
      terminal = {
        status: ConversationOutcomeKind.Error,
        error: serializeError(error),
        modelId: resource.modelId,
        turnTerminal: true
      }
    }
    for (const listener of [...resource.listeners]) {
      try {
        if (!listener.isAlive()) {
          resource.listeners.delete(listener)
          continue
        }
        if (terminal.status === ConversationOutcomeKind.Success) await listener.onDone(terminal)
        else if (terminal.status === ConversationOutcomeKind.Paused) await listener.onPaused(terminal)
        else await listener.onError(terminal)
      } catch (error) {
        resource.listeners.delete(listener)
        logger.warn('Prompt stream listener terminal failed', {
          streamId: resource.streamId,
          listenerId: listener.id,
          error
        })
      }
    }
    for (const port of resource.cleanupPorts) {
      try {
        await port.onTopicQuiesced(terminal)
      } catch (error) {
        logger.warn('Prompt stream cleanup failed', { streamId: resource.streamId, cleanupPortId: port.id, error })
      }
    }
  }
}
