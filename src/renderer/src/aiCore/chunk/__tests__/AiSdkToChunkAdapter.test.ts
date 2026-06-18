import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { FinishReasonError } from '@renderer/types/finish-reason-error'
import type { TextStreamPart, ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'

// The real ToolCallChunkHandler pulls in MCP/@agentic/core; these tests never exercise
// tool calls, so stub it to keep the import graph light.
vi.mock('../handleToolCallChunk', () => ({
  ToolCallChunkHandler: class {
    handleToolInputStart() {}
    handleToolInputDelta() {}
    handleToolInputEnd() {}
    handleToolCall() {}
    handleToolError() {}
    handleToolResult() {}
  }
}))

import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

type Part = TextStreamPart<ToolSet>

const usage = { inputTokens: 5, outputTokens: 3, totalTokens: 8 }

function streamOf(parts: Part[]): ReadableStream<Part> {
  return new ReadableStream<Part>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })
}

async function run(parts: Part[]): Promise<Chunk[]> {
  const chunks: Chunk[] = []
  const adapter = new AiSdkToChunkAdapter((chunk) => chunks.push(chunk))
  await adapter.processStream({ fullStream: streamOf(parts), text: Promise.resolve('') })
  return chunks
}

function finish(finishReason: string, rawFinishReason?: string): Part {
  return { type: 'finish', finishReason, rawFinishReason, totalUsage: usage } as unknown as Part
}

describe('AiSdkToChunkAdapter finish reason handling (#16072)', () => {
  it('emits an error chunk for a content-filter finish reason and skips completion', async () => {
    const chunks = await run([finish('content-filter', 'refusal')])

    const errorChunks = chunks.filter((c) => c.type === ChunkType.ERROR)
    expect(errorChunks).toHaveLength(1)
    const error = (errorChunks[0] as { error: unknown }).error
    expect(FinishReasonError.isInstance(error)).toBe(true)
    expect((error as FinishReasonError).finishReason).toBe('content-filter')
    expect((error as FinishReasonError).rawFinishReason).toBe('refusal')

    expect(chunks.some((c) => c.type === ChunkType.LLM_RESPONSE_COMPLETE)).toBe(false)
    expect(chunks.some((c) => c.type === ChunkType.BLOCK_COMPLETE)).toBe(false)
  })

  it.each(['length', 'error', 'other'])('emits an error chunk for the %s finish reason', async (reason) => {
    const chunks = await run([finish(reason)])

    const errorChunks = chunks.filter((c) => c.type === ChunkType.ERROR)
    expect(errorChunks).toHaveLength(1)
    const error = (errorChunks[0] as { error: unknown }).error
    expect(error).toBeInstanceOf(FinishReasonError)
    expect((error as FinishReasonError).finishReason).toBe(reason)
    expect(chunks.some((c) => c.type === ChunkType.LLM_RESPONSE_COMPLETE)).toBe(false)
  })

  it.each(['stop', 'tool-calls'])('completes normally for the %s finish reason', async (reason) => {
    const chunks = await run([finish(reason)])

    expect(chunks.some((c) => c.type === ChunkType.ERROR)).toBe(false)
    expect(chunks.some((c) => c.type === ChunkType.LLM_RESPONSE_COMPLETE)).toBe(true)
    expect(chunks.some((c) => c.type === ChunkType.BLOCK_COMPLETE)).toBe(true)
  })

  it('preserves streamed text blocks emitted before an abnormal finish', async () => {
    const chunks = await run([
      { type: 'text-start', id: 't1' } as Part,
      { type: 'text-delta', id: 't1', text: 'partial answer' } as Part,
      { type: 'text-end', id: 't1' } as Part,
      finish('content-filter')
    ])

    expect(chunks.some((c) => c.type === ChunkType.TEXT_COMPLETE)).toBe(true)
    expect(chunks.filter((c) => c.type === ChunkType.ERROR)).toHaveLength(1)
  })

  it('does not emit a duplicate error or a completion when an error part precedes finish', async () => {
    const chunks = await run([{ type: 'error', error: new Error('boom') } as Part, finish('error')])

    // Exactly one error chunk — from the 'error' part, not a second FinishReasonError.
    const errorChunks = chunks.filter((c) => c.type === ChunkType.ERROR)
    expect(errorChunks).toHaveLength(1)
    expect((errorChunks[0] as { error: unknown }).error).not.toBeInstanceOf(FinishReasonError)
    expect(chunks.some((c) => c.type === ChunkType.LLM_RESPONSE_COMPLETE)).toBe(false)
  })
})
