import { BaseService } from '@main/core/lifecycle'
import { createUniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const streamText = vi.hoisted(() => vi.fn())
vi.mock('@application', () => ({ application: { get: vi.fn(() => ({ streamText })) } }))

import { PromptStreamManager } from '..'

function listener() {
  return {
    id: 'listener-1',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

describe('PromptStreamManager', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    streamText.mockResolvedValue(
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close()
        }
      })
    )
  })

  it('forwards context ownership to AiService.streamText', async () => {
    const manager = new PromptStreamManager()
    manager.streamPrompt({
      streamId: 'gateway-request-1',
      uniqueModelId: createUniqueModelId('provider-a', 'model-a'),
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      listener: listener(),
      contextOwner: 'caller'
    })

    await vi.waitFor(() =>
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: 'gateway-request-1', contextOwner: 'caller' })
      )
    )
  })

  it('keeps stream identity separate from conversation identity', async () => {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>
    streamText.mockResolvedValue(
      new ReadableStream<UIMessageChunk>({
        start(value) {
          controller = value
        }
      })
    )
    const manager = new PromptStreamManager()
    manager.streamPrompt({
      streamId: 'gateway-request-1',
      uniqueModelId: createUniqueModelId('provider-a', 'model-a'),
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      listener: listener(),
      contextOwner: 'caller',
      usageContext: {
        agentSessionId: 'session-1',
        assistantMessageId: 'message-1',
        source: null
      }
    })

    await vi.waitFor(() => expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'session-1' })))
    expect(manager.listActiveWork()).toEqual([{ id: 'gateway-request-1', summary: 'prompt-stream' }])
    controller.close()
    await vi.waitFor(() => expect(manager.hasLiveStreams()).toBe(false))
  })

  it('keeps one-shot prompt persistence ahead of terminal delivery', async () => {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>
    streamText.mockResolvedValue(
      new ReadableStream<UIMessageChunk>({
        start(value) {
          controller = value
        }
      })
    )
    const order: string[] = []
    const manager = new PromptStreamManager()
    manager.streamPrompt({
      streamId: 'prompt-1',
      uniqueModelId: createUniqueModelId('provider', 'model'),
      prompt: 'hello',
      listener: { ...listener(), onDone: () => void order.push('listener') },
      persistencePorts: [
        {
          id: 'persist-1',
          onDone: () => {
            order.push('persist')
          },
          onPaused: vi.fn(),
          onError: vi.fn()
        }
      ]
    })

    controller.enqueue({ type: 'text-start', id: 'text-1' })
    controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' })
    controller.enqueue({ type: 'text-end', id: 'text-1' })
    controller.close()

    await vi.waitFor(() => expect(order).toEqual(['persist', 'listener']))
    expect(manager.hasLiveStreams()).toBe(false)
  })

  it('settles an aborted prompt open as paused instead of reporting a provider error', async () => {
    streamText.mockImplementation(
      ({ requestOptions }: { requestOptions?: { signal?: AbortSignal } }) =>
        new Promise<ReadableStream<UIMessageChunk>>((_, reject) => {
          requestOptions?.signal?.addEventListener('abort', () => reject(requestOptions.signal?.reason), { once: true })
        })
    )
    const subscriber = listener()
    const manager = new PromptStreamManager()
    manager.streamPrompt({
      streamId: 'prompt-abort',
      uniqueModelId: createUniqueModelId('provider', 'model'),
      prompt: 'hello',
      listener: subscriber
    })

    await vi.waitFor(() => expect(streamText).toHaveBeenCalledOnce())
    manager.abort('prompt-abort', 'user-stop')

    await vi.waitFor(() => expect(subscriber.onPaused).toHaveBeenCalledOnce())
    expect(subscriber.onError).not.toHaveBeenCalled()
    expect(manager.hasLiveStreams()).toBe(false)
  })
})
