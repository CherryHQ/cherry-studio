import { ChunkType } from '@renderer/types/chunk'
import { describe, expect, it } from 'vitest'

import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

describe('AiSdkToChunkAdapter', () => {
  it('preserves buffered web-search text in the final response', async () => {
    const chunks: any[] = []
    const adapter = new AiSdkToChunkAdapter(
      (chunk) => {
        chunks.push(chunk)
      },
      [],
      false,
      true
    )

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start' })
        controller.enqueue({ type: 'text-delta', text: 'See [GitHub](' })
        controller.enqueue({
          type: 'finish',
          finishReason: 'stop',
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
        })
        controller.close()
      }
    })

    await adapter.processStream({
      fullStream: stream,
      text: Promise.resolve('See [GitHub](')
    })

    const blockComplete = chunks.find((chunk) => chunk.type === ChunkType.BLOCK_COMPLETE)
    const textDeltas = chunks.filter((chunk) => chunk.type === ChunkType.TEXT_DELTA)

    expect(textDeltas.map((chunk) => chunk.text)).toEqual(['See ', '[GitHub]('])
    expect(blockComplete?.response?.text).toBe('See [GitHub](')
    expect(blockComplete?.response?.usage).toEqual({
      completion_tokens: 1,
      prompt_tokens: 1,
      total_tokens: 2
    })
  })
})
