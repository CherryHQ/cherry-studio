import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messageArtifactRetentionService } from '@data/services/MessageArtifactRetentionService'

import { storeNativeImageOutput, withNativeImageOutput } from '../nativeImageOutput'

const { createImageEntry, releaseEntry } = vi.hoisted(() => ({ createImageEntry: vi.fn(), releaseEntry: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: { createInternalEntry: createImageEntry, retainEntry: () => releaseEntry }
  })
})

describe('native image message output', () => {
  beforeEach(() => vi.clearAllMocks())
  // Regression: terminal cleanup must release a file created after its message has stopped.
  it('releases a late-created artifact after terminal cleanup', async () => {
    let complete!: (entry: { id: string; name: string }) => void
    let started!: () => void
    const creationStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    createImageEntry.mockImplementation(() => {
      started()
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const output = storeNativeImageOutput(
      {
        result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1e0AAAAASUVORK5CYII='
      },
      'stopped-message'
    )
    await creationStarted
    messageArtifactRetentionService.releaseMessageArtifacts('stopped-message')
    complete({ id: 'late-image', name: 'Grok image' })
    await output
    expect(releaseEntry).toHaveBeenCalledTimes(1)
    messageArtifactRetentionService.releaseMessageArtifacts('stopped-message')
    expect(releaseEntry).toHaveBeenCalledTimes(1)
  })

  // Regression: repeated terminal provider chunks must store one image and never publish raw base64.
  it('persists a native image once before forwarding the tool result', async () => {
    createImageEntry.mockResolvedValue({ id: 'image-file', name: 'Grok image' })
    const input: UIMessageChunk[] = [
      { type: 'start', messageId: 'a1' },
      {
        type: 'tool-input-available',
        toolCallId: 'image-call',
        toolName: 'imageGeneration',
        input: {},
        providerExecuted: true
      },
      {
        type: 'tool-output-available',
        toolCallId: 'image-call',
        output: {
          result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1e0AAAAASUVORK5CYII=',
          prompt: 'A square'
        },
        providerExecuted: true
      },
      {
        type: 'tool-output-available',
        toolCallId: 'image-call',
        output: {
          result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1e0AAAAASUVORK5CYII=',
          prompt: 'A square'
        },
        providerExecuted: true
      },
      { type: 'finish', finishReason: 'stop' }
    ]
    const chunks: UIMessageChunk[] = []
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of input) controller.enqueue(chunk)
        controller.close()
      }
    })
    const reader = withNativeImageOutput(stream).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    expect(createImageEntry).toHaveBeenCalledTimes(1)
    expect(createImageEntry).toHaveBeenCalledWith({
      source: 'bytes',
      data: expect.any(Buffer),
      ext: 'png',
      name: 'Grok image',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(chunks.filter((chunk) => chunk.type === 'tool-output-available')).toEqual([
      expect.objectContaining({
        output: { nativeImage: true, files: [{ id: 'image-file', name: 'Grok image' }], prompt: 'A square' }
      }),
      expect.objectContaining({
        output: { nativeImage: true, files: [{ id: 'image-file', name: 'Grok image' }], prompt: 'A square' }
      })
    ])
    expect(JSON.stringify(chunks)).not.toContain('iVBOR')
  }, 60000)
})
