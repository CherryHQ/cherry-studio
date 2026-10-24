import { createAnthropic } from '@ai-sdk/anthropic'
import { stepCountIs, tool, ToolLoopAgent, type UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import type { AgentLoopParams } from '../types'

const mockCreateAgent = vi.fn()
const BOUNDARY_MARKERS = '\u2050\u2051\u2052\u2053\u2054\u2055\u2056\u2057\u2063'

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

function event(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

function messageStart(id: string): string {
  return event('message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 }
    }
  })
}

function messageEnd(stopReason: 'tool_use' | 'end_turn', outputTokens: number): string {
  return (
    event('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens }
    }) + event('message_stop', { type: 'message_stop' })
  )
}

async function makeAgent(overrides: Partial<AgentLoopParams> = {}) {
  const { Agent } = await import('../../Agent')
  return new Agent({
    providerId: 'anthropic',
    providerSettings: {},
    modelId: 'claude-test',
    ...overrides
  })
}

describe('Agent tool-boundary text', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides leaked marker runs at tool boundaries without changing the same Unicode in prose', async () => {
    const firstResponse =
      messageStart('msg-1') +
      event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: `Before tool.${BOUNDARY_MARKERS.slice(0, 4)}` }
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: BOUNDARY_MARKERS.slice(4) }
      }) +
      event('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      event('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu-1', name: 'inspect', input: {} }
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"value":"ok"}' }
      }) +
      event('content_block_stop', { type: 'content_block_stop', index: 1 }) +
      messageEnd('tool_use', 12)
    const secondResponse =
      messageStart('msg-2') +
      event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: BOUNDARY_MARKERS.slice(0, 4) }
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: `${BOUNDARY_MARKERS.slice(4)}After tool. Keep ${BOUNDARY_MARKERS} here.`
        }
      }) +
      event('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      messageEnd('end_turn', 14)

    let requestCount = 0
    let toolExecutions = 0
    const fetch = async (): Promise<Response> => {
      const body = [firstResponse, secondResponse][requestCount++]
      if (body === undefined) throw new Error(`Unexpected request ${requestCount}`)
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }
    const sdkAgent = new ToolLoopAgent({
      model: createAnthropic({ apiKey: 'test-key', fetch })('claude-test'),
      stopWhen: stepCountIs(3),
      tools: {
        inspect: tool({
          description: 'Inspect a value',
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => {
            toolExecutions += 1
            return { inspected: value }
          }
        })
      }
    })
    mockCreateAgent.mockResolvedValue(sdkAgent)

    const agent = await makeAgent()
    const chunks: UIMessageChunk[] = []
    const messages = [{ id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Inspect ok.' }] }]
    for await (const chunk of agent.stream(messages, new AbortController().signal)) chunks.push(chunk)

    const visibleText = chunks
      .filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map((chunk) => chunk.delta)
      .join('')
    const toolChunkTypes = chunks.filter((chunk) => chunk.type.startsWith('tool-')).map((chunk) => chunk.type)

    expect(requestCount).toBe(2)
    expect(toolExecutions).toBe(1)
    expect(toolChunkTypes).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-available'
    ])
    expect(visibleText).toBe(`Before tool.After tool. Keep ${BOUNDARY_MARKERS} here.`)
  })

  it('preserves a trailing marker run when the response ends without a tool call', async () => {
    const sourceChunks: UIMessageChunk[] = [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: `Keep this ${BOUNDARY_MARKERS.slice(0, 4)}` },
      { type: 'text-delta', id: 'text-1', delta: BOUNDARY_MARKERS.slice(4) },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: 'stop' }
    ]
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              for (const chunk of sourceChunks) controller.enqueue(chunk)
              controller.close()
            }
          }),
        steps: Promise.resolve([])
      })
    })

    const agent = await makeAgent()
    const messages = [{ id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Continue.' }] }]
    const chunks: UIMessageChunk[] = []
    for await (const chunk of agent.stream(messages, new AbortController().signal)) chunks.push(chunk)

    const visibleText = chunks
      .filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map((chunk) => chunk.delta)
      .join('')
    expect(visibleText).toBe(`Keep this ${BOUNDARY_MARKERS}`)
  })

  it('preserves text-part ordering when marker runs continue after structural chunks', async () => {
    const sourceChunks: UIMessageChunk[] = [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'First part' },
      { type: 'text-delta', id: 'text-1', delta: BOUNDARY_MARKERS },
      { type: 'text-end', id: 'text-1' },
      { type: 'text-start', id: 'text-2' },
      { type: 'text-delta', id: 'text-2', delta: BOUNDARY_MARKERS },
      { type: 'text-end', id: 'text-2' },
      { type: 'finish', finishReason: 'stop' }
    ]
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              for (const chunk of sourceChunks) controller.enqueue(chunk)
              controller.close()
            }
          }),
        steps: Promise.resolve([])
      })
    })

    const agent = await makeAgent()
    const messages = [{ id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Continue.' }] }]
    const chunks: UIMessageChunk[] = []
    for await (const chunk of agent.stream(messages, new AbortController().signal)) chunks.push(chunk)

    expect(chunks).toEqual(sourceChunks)
  })

  it('flushes buffered chunks before propagating a UI stream error', async () => {
    const streamError = new Error('UI stream failed')
    const sourceChunks: UIMessageChunk[] = [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: `Keep this ${BOUNDARY_MARKERS}` },
      { type: 'text-end', id: 'text-1' }
    ]
    let sourceIndex = 0
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            pull(controller) {
              const chunk = sourceChunks[sourceIndex++]
              if (chunk) controller.enqueue(chunk)
              else controller.error(streamError)
            }
          }),
        steps: Promise.resolve([])
      })
    })

    const agent = await makeAgent()
    const messages = [{ id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Continue.' }] }]
    const reader = agent.stream(messages, new AbortController().signal).getReader()
    const chunks: UIMessageChunk[] = []

    await expect(
      (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return
          chunks.push(value)
        }
      })()
    ).rejects.toBe(streamError)
    expect(chunks.map((chunk) => chunk.type)).toEqual(['text-start', 'text-delta', 'text-delta', 'text-end'])
    expect(
      chunks
        .filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
        .map((chunk) => chunk.delta)
        .join('')
    ).toBe(`Keep this ${BOUNDARY_MARKERS}`)
  })
})
