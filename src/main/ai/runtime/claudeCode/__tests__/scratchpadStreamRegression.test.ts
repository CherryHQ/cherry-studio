import { describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

const loggerMocks = vi.hoisted(() => ({
  silly: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => loggerMocks)
  }
}))

const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')

function streamEvent(event: Record<string, unknown>) {
  return {
    type: 'stream_event',
    event,
    session_id: 'sdk-1',
    uuid: crypto.randomUUID()
  } as any
}

function createAdapter() {
  const parts: CherryUIMessageChunk[] = []
  const adapter = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    sessionId: 'session-1',
    streamOptions: { prompt: [] },
    sink: { enqueue: (part) => parts.push(part) },
    statusSink: { emit: () => {} },
    onSessionId: () => {}
  })
  adapter.beginTurn()
  return { adapter, parts }
}

function text(parts: CherryUIMessageChunk[]) {
  return parts
    .filter((part) => part.type === 'text-delta')
    .map((part) => (part as any).delta)
    .join('')
}

describe('round-17 reproduction on published head', () => {
  it('inv_75d7101acd63bd94: fragmented list/quote boundary preserves literal code', () => {
    const { adapter, parts } = createAdapter()
    const full = '- A\n  > B\n>     <thinking>literal</thinking>'
    adapter.handleMessage(
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    )
    for (const delta of ['- A\n  > B\n>     ', '<thinking>literal</thinking>'])
      adapter.handleMessage(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } })
      )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: { role: 'assistant', content: [{ type: 'text', text: full }] }
    } as any)
    expect(text(parts)).toBe(full)
  })

  it('inv_269a650fa555da87: long single-line HTML answer streams without quadratic parsing', () => {
    const { adapter, parts } = createAdapter()
    const answer = '<p>' + 'lorem ipsum dolor sit amet '.repeat(Math.ceil(32000 / 27)).slice(0, 32000 - 7) + '</p>'
    const start = performance.now()
    adapter.handleMessage(
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    )
    for (let i = 0; i < answer.length; i += 20)
      adapter.handleMessage(
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: answer.slice(i, i + 20) }
        })
      )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    const elapsed = performance.now() - start
    console.log({ longHtmlCharacters: answer.length, elapsed })
    expect(text(parts)).toBe(answer)
    expect(elapsed).toBeLessThan(1000)
  })
})
