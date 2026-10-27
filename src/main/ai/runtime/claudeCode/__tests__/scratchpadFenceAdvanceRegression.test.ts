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

function deliver(input: string, chunkSize: number | null): string {
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
  return parts
    .filter((part) => part.type === 'text-delta')
    .map((part) => (part as any).delta)
    .join('')
}

/**
 * Retained-fence incremental advance corpus (cherry-pr-review
 * inv_50f4adc875e16a2f): while a fence stays open, the mask advance holds the
 * raw fence as segments and scans only new text for closer, container-boundary,
 * and scratchpad-block events. Every case must deliver identically for whole,
 * 1/2/3/5/7/20-character chunking. Snapshot-compared byte-identical against the
 * pre-fix build during development; the preserve expectations below pin the
 * behavior that exercise the event paths.
 */
const FENCE_CORPUS: Array<[string, string]> = [
  ['plain-closed', 'before\n\n```js\nconst x = 1\n```\n\nafter\n'],
  ['unclosed-end', 'before\n\n```js\nconst x = 1\nmore\n'],
  ['fence-indented-after', 'para\n\n```\ncode\n```\n\n    indented <thinking>kept</thinking>\n'],
  ['quote-fence', '> note\n>\n> ```py\n> print(1)\n> ```\n> tail\n'],
  ['quote-fence-blank-end', '> ```py\n> print(1)\n\noutside <thinking>para</thinking>\n'],
  ['list-fence', '1. item\n\n   ```js\n   const x = 1\n   ```\n\n   after <thinking>content</thinking>\n'],
  ['list-fence-blank', '1. item\n\n   ```js\n   const x = 1\n\n   ```\n   tail\n'],
  ['list-fence-dedent-end', '1. item\n\n   ```js\n   const x = 1\ndedented ends fence\n   ```\n'],
  ['quotelist-fence', '1. item\n\n   > ```js\n   > const x = 1\n   > ```\n   > tail\n'],
  ['fence-in-analysis', '<analysis>\n```\ninternal code\n```\n</analysis>\n\nvisible\n'],
  ['fence-in-analysis-blockclose-inside', '<analysis>\n```\ninternal </analysis> truncated\n```\nvisible tail\n'],
  [
    'analysis-close-split-after-fence',
    '<analysis>\n```\ncode\n```\n</analysis>\nvisible <thinking>stripped?</thinking>\n'
  ],
  ['backticks-in-content', '```\nuse `code` and ``pairs`` here\n```\n'],
  ['four-backtick-with-three-inside', '````\n```\nnot a closer\n````\n'],
  ['tilde-fence', '~~~\ntilde <thinking>content</thinking>\n~~~\n'],
  ['tilde-in-backtick', '```\n~~~\nnot closer\n```\n'],
  ['closer-with-trailing-spaces', '```\ncode\n```   \nafter\n'],
  ['crlf-fence', '```\r\ncode\r\n```\r\nafter\r\n'],
  ['two-fences', '```\nfirst\n```\n\n```\nsecond\n```\n'],
  ['fence-then-list', '```\ncode\n```\n\n1. a\n\n  2. b\n\n    <thinking>literal</thinking>\n'],
  // Closed-fence hold entry: the closer token can land exactly at the span
  // end; following indented/list content must still classify downstream.
  ['closed-then-indented', 'para\n\n```\ncode\n```\n    <thinking>kept</thinking>\n'],
  ['closed-then-indented-crlf', 'para\r\n\r\n```\r\ncode\r\n```\r\n    <thinking>kept</thinking>\r\n'],
  ['closed-then-list', '```\nabc\n```\n1. a\n\n  2. b\n\n    <thinking>literal</thinking>\n'],
  ['closed-at-eof', 'para\n\n```\ncode\n```'],
  ['closed-chunk-exact', 'abcd\n\n```\ncode\n```\n    <thinking>kept</thinking>\n']
]

/** Cases whose visible output must keep the literal tag (code-classified). */
const PRESERVE_CASES = new Set([
  'fence-indented-after',
  'fence-then-list',
  'closed-then-indented',
  'closed-then-indented-crlf',
  'closed-then-list',
  'closed-chunk-exact',
  'tilde-fence'
])

describe('retained-fence incremental advance corpus (cherry-review inv_50f4adc875e16a2f)', () => {
  for (const [id, input] of FENCE_CORPUS) {
    it(`${id}: whole/1/2/3/5/7/20-char delivery`, () => {
      const whole = deliver(input, null)
      if (PRESERVE_CASES.has(id)) expect(whole.includes('<thinking>')).toBe(true)
      for (const size of [1, 2, 3, 5, 7, 20]) {
        expect(deliver(input, size)).toBe(whole)
      }
    })
  }
})
