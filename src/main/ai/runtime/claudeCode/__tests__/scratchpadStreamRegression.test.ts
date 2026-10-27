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

function deliver(input: string, chunkSize: number | null) {
  const { adapter, parts } = createAdapter()
  adapter.handleMessage(
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  )
  if (chunkSize === null) {
    adapter.handleMessage(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: input } })
    )
  } else {
    for (let i = 0; i < input.length; i += chunkSize) {
      adapter.handleMessage(
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: input.slice(i, i + chunkSize) }
        })
      )
    }
  }
  adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
  return text(parts)
}

describe('round-17 stale-sibling-ownership (cherry-review P2, CommonMark ex313)', () => {
  // Each case asserts whole delivery plus one- and five-character chunked
  // delivery. Preserve/strip expectations follow the CommonMark 0.31.2 parse
  // (verified against markdown-it commonmark mode): a tag line that parses as
  // top-level indented code is literal content and must survive; a tag line
  // that parses as list paragraph content is scratchpad-suppressed by design.
  const SIBLING_OWNERSHIP_CASES: Array<[string, string, 'preserve' | 'strip']> = [
    // The reviewer's exact reproduction: the sibling marker "  2. b" ends the
    // first item's ownership, so the four-indent line is top-level code.
    ['reviewer-exact', '1. a\n\n  2. b\n\n    <thinking>literal</thinking>\n', 'preserve'],
    // Ordered-marker width: a wider/narrower sibling marker still pops every
    // level above the marker's own column.
    ['ordered-width-9-10', '9. a\n\n 10. b\n\n    <thinking>literal</thinking>\n', 'preserve'],
    ['ordered-width-10-9', '10. a\n\n   9. b\n\n     <thinking>literal</thinking>\n', 'preserve'],
    // Nested then dedent: the four-indent line belongs to the dedented item.
    ['nested-then-dedent', '- a\n\n  - b\n\n - c\n\n    <thinking>literal</thinking>\n', 'strip'],
    // A marker at column 4 still nests under a two-column parent: the
    // four-indent line is the parent's content, not top-level code.
    ['deep-nest-not-popped', '- a\n\n    - b\n\n    <thinking>literal</thinking>\n', 'strip'],
    // A tab-expanded marker measures its expanded column for ownership.
    ['tab-expanded-marker', '- a\n\n\t- b\n\n    <thinking>literal</thinking>\n', 'strip'],
    // A quote inside the item does not leak quote ownership to the line.
    ['quote-inside-list', '- a\n\n  > quoted\n\n    <thinking>literal</thinking>\n', 'strip']
  ]
  for (const [id, input, expected] of SIBLING_OWNERSHIP_CASES) {
    it(`${id}: whole/1-char/5-char delivery`, () => {
      const whole = deliver(input, null)
      expect(whole.includes('<thinking>')).toBe(expected === 'preserve')
      expect(deliver(input, 1)).toBe(whole)
      expect(deliver(input, 5)).toBe(whole)
    })
  }

  it('inv_50f4adc875e16a2f: growing fenced answer advances the mask incrementally', () => {
    // Deterministic work gate (no wall-clock assertion): the total characters
    // the mask-state advance presents to maskCodeFences. Re-masking the held
    // fence per delta would sum to O(fence^2 / chunk) ~ 225M characters here;
    // incremental advance stays within a small multiple of the input (one
    // mask when the fence opens, one when the closer arrives).
    const line = 'const answer = computeValue(input, options)\n'
    let body = ''
    while (body.length < 95020 - 8) body += line
    const fence = '```\n' + body.slice(0, 95020 - 8) + '\n```\n\nafter text\n'
    const { adapter } = createAdapter()
    adapter.handleMessage(
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    )
    for (let i = 0; i < fence.length; i += 20) {
      adapter.handleMessage(
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: fence.slice(i, i + 20) }
        })
      )
    }
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    const work = (adapter as any).scratchpadMaskAdvanceWorkChars as number
    expect(work).toBeGreaterThan(0)
    expect(work).toBeLessThan(fence.length * 3)
  })
})
