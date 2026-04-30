import { ChunkType } from '@renderer/types/chunk'
import { describe, expect, it, vi } from 'vitest'

import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      silly: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('AiSdkToChunkAdapter', () => {
  it('accumulates text deltas when requested', async () => {
    const emittedTexts: string[] = []
    const adapter = new AiSdkToChunkAdapter(
      (chunk) => {
        if (chunk.type === ChunkType.TEXT_DELTA) {
          emittedTexts.push(chunk.text)
        }
      },
      [],
      true
    )

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({ type: 'text-delta', id: 'text-1', text: 'Hello ' })
        controller.enqueue({ type: 'text-delta', id: 'text-1', text: 'world!' })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.enqueue({ type: 'finish', finishReason: { unified: 'stop' }, totalUsage: {} })
        controller.close()
      }
    })

    await adapter.processStream({
      fullStream: stream,
      text: Promise.resolve('Hello world!')
    })

    expect(emittedTexts).toEqual(['Hello ', 'Hello world!'])
  })
})
