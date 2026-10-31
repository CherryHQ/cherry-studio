// Regression: mask-state advance must consume the RAW scan-consumed text, not
// the post-strip visible text. Suppressed scratchpad blocks leave blank lines
// in the visible stream; advancing the container machine over those blanks
// loses list/paragraph transitions the raw lines carried, so a later indented
// line was classified against a stale list and its literal tag stripped
// (round-18 independent review, seeded-fuzz introduced cases below).
import { describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

const loggerMocks = vi.hoisted(() => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: vi.fn(() => loggerMocks) } }))
const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')

function deliver(text: string, chunkSize: number | null): string {
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
  const ev = (event: Record<string, unknown>) =>
    ({ type: 'stream_event', event, session_id: 'sdk-1', uuid: crypto.randomUUID() }) as any
  adapter.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
  if (chunkSize === null) {
    adapter.handleMessage(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
  } else {
    for (let i = 0; i < text.length; i += chunkSize) {
      adapter.handleMessage(
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + chunkSize) } })
      )
    }
  }
  adapter.handleMessage(ev({ type: 'content_block_stop', index: 0 }))
  return parts
    .filter((p): p is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => p.type === 'text-delta')
    .map((p) => p.delta)
    .join('')
}

// The eight rebuild-introduced seeded-fuzz cases (seed 0xC0FFEE corpus):
// each failed chunked-vs-whole on the reviewed candidate and passed on the
// public head. Case numbers refer to that corpus.
const cases: Array<[number, string]> = [
  [
    19,
    '- \t tabbed\n- item\n  continuation\n\n```\nx <analysis>HID</analysis> y\n```\n\n- \t tabbed\n\n    code <analysis>HID</analysis> tail\n<thinking>t</thinking>\n\n<textarea>t</textarea>\n\n<analysis>hidden</analysis>\n'
  ],
  [
    56,
    '```\nx <analysis>HID</analysis> y\n```\n\n- item <analysis>HID</analysis> tail\n# heading\n<textarea>t</textarea>\n\n<thinking>t</thinking>\n\n    code <analysis>HID</analysis> tail\n'
  ],
  [
    100,
    '<script>var a = 1</script>\n\n```\ncode line\n```\n```\nx <analysis>HID</analysis> y\n```\n\n    code <analysis>HID</analysis> tail\nplain paragraph\n> quote line\n> quote line\n\n'
  ],
  [
    278,
    'plain paragraph\n<script>var a = 1</script>\n\n- item <analysis>HID</analysis> tail\n\n```\nx <analysis>HID</analysis> y\n```\n<thinking>t</thinking>\n\n    code <analysis>HID</analysis> tail\n\n<textarea>t</textarea>\n'
  ],
  [
    321,
    '# heading\n- item <analysis>HID</analysis> tail\n\n<analysis>hidden</analysis>\n\n```\ncode line\n```\n    code <analysis>HID</analysis> tail\n\n    code <analysis>HID</analysis> tail\n'
  ],
  [
    345,
    'plain paragraph\n\n```\nx <analysis>HID</analysis> y\n```\n    code <analysis>HID</analysis> tail\n\n- item\n  continuation\n\n'
  ],
  [
    355,
    '- \t tabbed\n\n```\nx <analysis>HID</analysis> y\n```\n    code <analysis>HID</analysis> tail\n\n- \t tabbed\n\n<thinking>t</thinking>\n\n```\ncode line\n```\n\n# heading\n\n'
  ],
  [
    393,
    '<script>var a = 1</script>\n\n<textarea>t</textarea>\n    indented code\n```\nx <analysis>HID</analysis> y\n```\n    code <analysis>HID</analysis> tail\n- item alpha\n- item alpha\n> quote line\n\n'
  ]
]

describe('scratchpad raw-advance regression (round-18 introduced fuzz cases)', () => {
  for (const [caseNo, input] of cases) {
    it(`case ${caseNo}: chunked delivery matches whole`, () => {
      const whole = deliver(input, null)
      for (const size of [1, 2, 3, 5, 8]) {
        expect(deliver(input, size)).toBe(whole)
      }
    })
  }
})
