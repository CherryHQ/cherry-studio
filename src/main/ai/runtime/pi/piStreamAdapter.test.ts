import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import { readUIMessageStream } from 'ai'
import { describe, expect, it } from 'vitest'

import { PI_TRANSPORT, PiStreamAdapter } from './piStreamAdapter'

function collect(events: AgentSessionEvent[]): CherryUIMessageChunk[] {
  const chunks: CherryUIMessageChunk[] = []
  const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
  for (const event of events) adapter.handleEvent(event)
  return chunks
}

/** Feed the adapter chunks through the real AI SDK accumulator, as the host does. */
async function accumulate(chunks: CherryUIMessageChunk[]): Promise<CherryUIMessage> {
  const stream = new ReadableStream<CherryUIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  let last: CherryUIMessage | undefined
  for await (const snapshot of readUIMessageStream<CherryUIMessage>({ stream })) last = snapshot
  if (!last) throw new Error('no message produced')
  return last
}

const assistantEvent = (inner: Record<string, unknown>): AgentSessionEvent =>
  ({ type: 'message_update', message: {} as never, assistantMessageEvent: inner }) as unknown as AgentSessionEvent

describe('PiStreamAdapter', () => {
  it('maps a text + tool-call turn to the expected chunk sequence', () => {
    const chunks = collect([
      { type: 'message_start', message: {} } as unknown as AgentSessionEvent,
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_delta', contentIndex: 0, delta: 'Hello' }),
      assistantEvent({ type: 'text_delta', contentIndex: 0, delta: ' world' }),
      assistantEvent({ type: 'text_end', contentIndex: 0 }),
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
        args: { command: 'ls' }
      } as AgentSessionEvent,
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: 'file.txt',
        isError: false
      } as AgentSessionEvent,
      {
        type: 'turn_end',
        message: {
          role: 'assistant',
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 3, reasoning: 1, totalTokens: 0 }
        },
        toolResults: []
      } as unknown as AgentSessionEvent
    ])

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'message-metadata'
    ])

    const toolInput = chunks.find((chunk) => chunk.type === 'tool-input-available')
    expect(toolInput).toMatchObject({
      toolCallId: 't1',
      toolName: 'bash',
      input: { command: 'ls' },
      providerMetadata: { cherry: { transport: PI_TRANSPORT } }
    })

    const meta = chunks.find((chunk) => chunk.type === 'message-metadata')
    expect(meta).toMatchObject({
      messageMetadata: { totalTokens: 20, promptTokens: 15, completionTokens: 5, thoughtsTokens: 1 }
    })
  })

  it('stamps the pi transport on tool error output', () => {
    const chunks = collect([
      { type: 'tool_execution_start', toolCallId: 'e1', toolName: 'edit', args: {} } as AgentSessionEvent,
      {
        type: 'tool_execution_end',
        toolCallId: 'e1',
        toolName: 'edit',
        result: { message: 'boom' },
        isError: true
      } as AgentSessionEvent
    ])
    const err = chunks.find((chunk) => chunk.type === 'tool-output-error')
    expect(err).toMatchObject({
      toolCallId: 'e1',
      errorText: JSON.stringify({ message: 'boom' }),
      providerMetadata: { cherry: { transport: PI_TRANSPORT } }
    })
  })

  it('keeps content-part ids unique across multiple assistant messages in one loop', () => {
    const chunks = collect([
      { type: 'message_start', message: {} } as unknown as AgentSessionEvent,
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_end', contentIndex: 0 }),
      { type: 'message_start', message: {} } as unknown as AgentSessionEvent,
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_end', contentIndex: 0 })
    ])
    const ids = chunks.filter((chunk) => chunk.type === 'text-start').map((chunk) => (chunk as { id: string }).id)
    expect(new Set(ids).size).toBe(2)
  })

  it('sums token usage across the multiple turn_ends of one turn', async () => {
    const turnEnd = (usage: Record<string, number>): AgentSessionEvent =>
      ({ type: 'turn_end', message: { role: 'assistant', usage }, toolResults: [] }) as unknown as AgentSessionEvent
    const chunks = collect([
      { type: 'agent_start' } as unknown as AgentSessionEvent,
      turnEnd({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }),
      turnEnd({ input: 120, output: 80, cacheRead: 0, cacheWrite: 0 })
    ])
    // Each turn_end emits a running total; the last-wins chunk carries the whole turn.
    const metas = chunks.filter((chunk) => chunk.type === 'message-metadata')
    expect(metas.at(-1)).toMatchObject({
      messageMetadata: { totalTokens: 350, promptTokens: 220, completionTokens: 130 }
    })
    const message = await accumulate(chunks)
    expect(message.metadata).toMatchObject({ totalTokens: 350, promptTokens: 220, completionTokens: 130 })
  })

  it('resets the token accumulator when a new turn starts (agent_start)', () => {
    const turnEnd = (usage: Record<string, number>): AgentSessionEvent =>
      ({ type: 'turn_end', message: { role: 'assistant', usage }, toolResults: [] }) as unknown as AgentSessionEvent
    const chunks = collect([
      { type: 'agent_start' } as unknown as AgentSessionEvent,
      turnEnd({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }),
      { type: 'agent_start' } as unknown as AgentSessionEvent,
      turnEnd({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 })
    ])
    const metas = chunks.filter((chunk) => chunk.type === 'message-metadata')
    expect(metas.at(-1)).toMatchObject({
      messageMetadata: { totalTokens: 15, promptTokens: 10, completionTokens: 5 }
    })
  })

  it('accumulates into a CherryUIMessage with text and tool parts', async () => {
    const chunks = collect([
      { type: 'message_start', message: {} } as unknown as AgentSessionEvent,
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_delta', contentIndex: 0, delta: 'done' }),
      assistantEvent({ type: 'text_end', contentIndex: 0 }),
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'a' } } as AgentSessionEvent,
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'read',
        result: 'contents',
        isError: false
      } as AgentSessionEvent
    ])
    const message = await accumulate(chunks)
    const text = message.parts.find((part) => part.type === 'text')
    expect(text).toMatchObject({ text: 'done' })
    const tool = message.parts.find((part) => part.type === 'dynamic-tool')
    expect(tool).toMatchObject({ toolName: 'read', state: 'output-available', output: 'contents' })
  })
})
