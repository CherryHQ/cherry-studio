import { BaseService } from '@main/core/lifecycle'
import { createUniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const streamText = vi.hoisted(() => vi.fn())
vi.mock('@application', () => ({ application: { get: vi.fn(() => ({ streamText })) } }))

import { PromptStreamManager } from '..'

describe('PromptStreamManager', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
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
      listener: {
        id: 'listener-1',
        onChunk: vi.fn(),
        onDone: () => {
          order.push('listener')
        },
        onPaused: vi.fn(),
        onError: vi.fn(),
        isAlive: () => true
      },
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
})
