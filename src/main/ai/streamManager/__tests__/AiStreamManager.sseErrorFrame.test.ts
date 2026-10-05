/**
 * End-to-end through `AiStreamManager`: a provider whose mid-stream failure arrives
 * as a raw SSE frame must surface as a structured error carrying the provider's own
 * message — not the protocol scaffolding.
 *
 * 55 of 57 observed quota failures already surfaced structurally (their thrown
 * error carried `statusCode`/`responseBody`); the 2 that did not went through
 * `errorFromStreamChunk`, which stored the AI SDK chunk's `errorText` verbatim.
 */

import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamErrorResult, StreamListener } from '@main/ai/streamManager/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { toExecutionFailure } from '@shared/ai/executionFailure'

import type { AiStreamManagerConfig } from '../types'

const SSE_QUOTA_FRAME =
  'API Error: Request rejected (429) · event:error data:{"type":"error","error":{"type":"rate_limit_error","message":"You exceeded your current quota."}}'

const mockStreamText = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: { streamText: mockStreamText }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@main/data/services/MessageService', () => ({
  messageService: { getById: () => undefined }
}))

const { AiStreamManager } = await import('../AiStreamManager')

type ManagerInstance = InstanceType<typeof AiStreamManager>

function createManager(config?: Partial<AiStreamManagerConfig>): ManagerInstance {
  BaseService.resetInstances()
  const Ctor = AiStreamManager as unknown as new (config?: Partial<AiStreamManagerConfig>) => ManagerInstance
  return new Ctor(config)
}

/** Streams real content, then fails mid-stream carrying the SSE frame. */
function quotaFramedStream(): ReadableStream<UIMessageChunk> {
  const chunks = [
    { type: 'start' },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Partial answer' },
    { type: 'error', errorText: SSE_QUOTA_FRAME }
  ] as UIMessageChunk[]
  let index = 0
  return new ReadableStream<UIMessageChunk>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
        return
      }
      controller.close()
    }
  })
}

class ErrorCapturingListener implements StreamListener {
  readonly id = 'test:errors'
  readonly chunks: UIMessageChunk[] = []
  errors: StreamErrorResult[] = []

  onChunk(): void {
    // Only the terminal error matters here.
  }

  onDone(): void {
    // Only the terminal error matters here.
  }

  onPaused(): void {
    // Only the terminal error matters here.
  }

  onError(result: StreamErrorResult): void {
    this.errors.push(result)
  }

  isAlive(): boolean {
    return true
  }
}

/** Wait for the execution loop to reach its terminal error. */
async function flushUntil(predicate: () => boolean, maxTicks = 500): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return true
    await new Promise((resolve) => setImmediate(resolve))
  }
  return predicate()
}

describe('AiStreamManager — mid-stream SSE error frame', () => {
  let mgr: ManagerInstance

  beforeEach(() => {
    vi.clearAllMocks()
    mockStreamText.mockResolvedValue(quotaFramedStream())
    mgr = createManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('surfaces the provider message instead of the raw frame', async () => {
    const listener = new ErrorCapturingListener()
    mgr.send({
      topicId: 'topic-sse',
      models: [
        {
          modelId: 'deepseek::deepseek-chat',
          request: { conversation: { id: 'c', topicId: 'topic-sse' }, trigger: 'submit-message', messages: [] }
        }
      ],
      listeners: [listener]
    })

    expect(await flushUntil(() => listener.errors.length > 0)).toBe(true)

    const error = listener.errors[0].error
    expect(error.message).toBe('You exceeded your current quota.')
    // Protocol scaffolding must never reach the user.
    expect(JSON.stringify(error)).not.toMatch(/event:|data:\s*\{/)
  })

  it('keeps the structured status so the failure still classifies as quota', async () => {
    const listener = new ErrorCapturingListener()
    mgr.send({
      topicId: 'topic-sse-2',
      models: [
        {
          modelId: 'deepseek::deepseek-chat',
          request: { conversation: { id: 'c', topicId: 'topic-sse-2' }, trigger: 'submit-message', messages: [] }
        }
      ],
      listeners: [listener]
    })

    expect(await flushUntil(() => listener.errors.length > 0)).toBe(true)

    expect(listener.errors[0].error.statusCode).toBe(429)
    expect(listener.errors[0].error.failureStage).toBe('stream')
    // The projection the persistence layer attaches must name a stage and a reason
    // rather than degrading to a bare string the user cannot act on.
    const failure = toExecutionFailure(listener.errors[0].error, 'deepseek::deepseek-chat')
    expect(failure.failure.stage).toBe('stream')
    expect(failure.failure.reasonCode).toBe('quota')
    expect(failure.message).toBe('You exceeded your current quota.')
  })

  it('retains the content streamed before the failure', async () => {
    const listener = new ErrorCapturingListener()
    mgr.send({
      topicId: 'topic-sse-3',
      models: [
        {
          modelId: 'deepseek::deepseek-chat',
          request: { conversation: { id: 'c', topicId: 'topic-sse-3' }, trigger: 'submit-message', messages: [] }
        }
      ],
      listeners: [listener]
    })

    expect(await flushUntil(() => listener.errors.length > 0)).toBe(true)

    const text = (listener.errors[0].finalMessage?.parts ?? []).find((part) => part.type === 'text') as
      | { text?: string }
      | undefined
    expect(text?.text).toBe('Partial answer')
  })
})
