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
  const chunks: string[] = []
  if (chunkSize === null) {
    chunks.push(input)
  } else {
    for (let i = 0; i < input.length; i += chunkSize) {
      chunks.push(input.slice(i, i + chunkSize))
    }
  }
  return deliverChunks(chunks)
}

function deliverChunks(chunks: string[]): string {
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
  for (const text of chunks) {
    adapter.handleMessage(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    )
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
  // Event-dense opener-run hardening: repeated ``` lines inside a ```` fence
  // are content (run shorter than the opener) and must not wake the re-mask;
  // only the real run-4 closer does. Chunkings must still match whole.
  ['four-backtick-event-dense', '````\nconst x = 1\n```\nconst y = 2\n```\nconst z = 3\n```\n````\nafter\n'],
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
  ['closed-chunk-exact', 'abcd\n\n```\ncode\n```\n    <thinking>kept</thinking>\n'],
  // Opener on a list marker line: the opener parse must see past the marker
  // (cherry-review hardening follow-up). A tilde fence here must still fire
  // its closer; a backtick-default fallback would never wake on '~~~'.
  ['list-marker-tilde-fence', '- ~~~\n  tilde\n  ~~~\n\n<thinking>strip</thinking>\n'],
  ['ordered-marker-tilde-fence', '1. ~~~\n   code\n   ~~~\n\n<thinking>strip</thinking>\n'],
  ['list-marker-backtick-fence', '- ```js\n  const x = 1\n  ```\n\n<thinking>strip</thinking>\n'],
  // Ordered marker line with a BACKTICK fence: same recognition path as the
  // tilde variant (the paragraph sentinel must not split marker head and run).
  ['ordered-marker-backtick-fence', '1. ```\n   code\n   ```\n\n<thinking>strip</thinking>\n'],
  // Tag INSIDE the fence on a marker line is fence content: chunked delivery
  // must not strip it (round-19 in-fence content loss regression).
  ['ordered-marker-tilde-tag-in-fence', '1. ~~~\n   <thinking>in-code</thinking>\n   ~~~\n\ntail\n'],
  ['ordered-marker-backtick-tag-in-fence', '1. ```\n   <thinking>in-code</thinking>\n   ```\n\ntail\n'],
  // An inline run after real list text is NOT a fence opener: the own-marker
  // -line parse must reject it so the post-blank-line tag still strips.
  ['ordered-inline-run-not-fence', '1. text ``` inline\n\n<thinking>strip</thinking>\n'],
  // Marker variants at their true container content column: the closer
  // closes the fence inside the item/quote and the tag outside strips.
  ['ordered-2digit-marker-tilde-fence', '10. ~~~\n    code\n    ~~~\n\n<thinking>strip</thinking>\n'],
  ['tab-marker-tilde-fence', '1.\t~~~\n    code\n    ~~~\n\n<thinking>strip</thinking>\n'],
  ['quote-marker-tilde-fence', '> 1. ~~~\n     code\n     ~~~\n\n<thinking>strip</thinking>\n'],
  // A closer dedented past the item content column ends the item first: the
  // unclosed fence auto-closes at the container end and the dedented line
  // RE-OPENS a top-level fence, so the tag stays code (CommonMark).
  ['dedented-closer-reopens-fence', '1. ~~~\n  code\n  ~~~\n\n<thinking>x</thinking>\n'],
  ['col0-closer-reopens-fence', '1. ~~~\n   code\n~~~\n\n<thinking>x</thinking>\n'],
  // Info-string backtick / partial run negatives: not fences at all.
  ['ordered-info-backtick-not-fence', '1. ``` a`b\n\n<thinking>strip</thinking>\n'],
  ['ordered-partial-tilde-not-fence', '1. ~x\n\n<thinking>strip</thinking>\n'],
  // INHERITED (verified): nested marker chain '- 1. ~~~'. Whole delivery
  // strips; EVERY fixed chunking (1/2/3/5/7/20) preserves the tag
  // identically on prior PR head 0d2860cb21, on baee30bc8d and here - a
  // chunk-dependent suppression misclassification that predates this PR's
  // rebuild. Runner is it.fails below; retire when fixed and say why.
  ['nested-marker-tilde-fence', '- 1. ~~~\n   code\n   ~~~\n\n<thinking>strip</thinking>\n']
]

/** Cases whose visible output must keep the literal tag (code-classified). */
const PRESERVE_CASES = new Set([
  'fence-indented-after',
  'fence-then-list',
  'closed-then-indented',
  'closed-then-indented-crlf',
  'closed-then-list',
  'closed-chunk-exact',
  'tilde-fence',
  'ordered-marker-tilde-tag-in-fence',
  'ordered-marker-backtick-tag-in-fence',
  'dedented-closer-reopens-fence',
  'col0-closer-reopens-fence'
])

function deliverAdapter(input: string, chunkSize: number | null, withStop = true) {
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
  if (withStop) adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
  return adapter
}

const CLOSED_FENCE_CASES = [
  'closed-then-indented',
  'closed-then-indented-crlf',
  'closed-then-list',
  'closed-at-eof',
  'closed-chunk-exact',
  'list-marker-tilde-fence',
  'ordered-marker-tilde-fence',
  'list-marker-backtick-fence',
  'ordered-marker-backtick-fence',
  'ordered-marker-tilde-tag-in-fence',
  'ordered-marker-backtick-tag-in-fence',
  'ordered-2digit-marker-tilde-fence',
  'tab-marker-tilde-fence',
  'quote-marker-tilde-fence'
]

describe('retained-fence incremental advance corpus (cherry-review inv_50f4adc875e16a2f)', () => {
  for (const [id, input] of FENCE_CORPUS) {
    // TRIPWIRE RETIRED: 'ordered-marker-tilde-fence' was an expected-fail
    // gate for a chunking-dependent suppression misclassification introduced
    // by this PR's rebuild between 0d2860cb21 and ed1915b1b4 (post-fence tag
    // preserved at 1/3-char chunking; in-fence tag stripped). Root cause:
    // the open-line carry's paragraph sentinel ('1. x') split the marker
    // head from a buffered fence run, so the completed opener scanned as
    // paragraph text and the closer re-read as a new top-level opener. Fixed
    // by suppressing the sentinel when a bare marker line's buffered
    // remainder starts a fence run, plus strict own-marker-line fence
    // recognition in the scan's container guards. The case now runs as a
    // normal assertion at every chunking.
    const runner = id === 'nested-marker-tilde-fence' ? it.fails : it
    runner(`${id}: whole/1/2/3/5/7/20-char delivery`, () => {
      const whole = deliver(input, null)
      if (PRESERVE_CASES.has(id)) expect(whole.includes('<thinking>')).toBe(true)
      for (const size of [1, 2, 3, 5, 7, 20]) {
        expect(deliver(input, size)).toBe(whole)
      }
    })
  }

  // Bare-marker boundary: the marker line is emitted with an EMPTY buffered
  // remainder and the whole fence run arrives as one fresh delta (review
  // probe). The completed opener must still classify as a fence.
  for (const marker of ['1. ', '- ', '10. ', '1.\t', '+ ']) {
    it(`bare-marker split then whole run: ${JSON.stringify(marker)}`, () => {
      const rest = '~~~\n   code\n   ~~~\n\n<thinking>strip</thinking>\n'
      const whole = deliver(marker + rest, null)
      const split = deliverChunks([marker, rest])
      expect(split).toBe(whole)
    })
  }

  // Held-state assertion beyond output sameness (cherry-review closed-entry
  // concern): once the closer completes, the held tracker must be released -
  // stale held state could misclassify following content without changing the
  // output on inputs that never re-enter a fence.
  for (const [id, input] of FENCE_CORPUS.filter(([id]) => CLOSED_FENCE_CASES.includes(id))) {
    it(`${id}: held fence released after closer`, () => {
      for (const size of [null, 1, 2, 3, 5, 7, 20]) {
        const adapter = deliverAdapter(input, size)
        expect((adapter as any).ctx.scratchpadMaskHeldFence).toBeNull()
      }
    })
  }

  // Pre-stop release: for closed cases whose input continues past the closer,
  // the held tracker must already be released BEFORE the stop flush - a closer
  // that only resolves at stop misclassifies the streamed tail (cherry-review
  // marker-line opener gap: '- ~~~' / '1. ~~~' openers).
  for (const [id, input] of FENCE_CORPUS.filter(([id]) => CLOSED_FENCE_CASES.includes(id) && id !== 'closed-at-eof')) {
    // EXPECTED-FAIL TRIPWIRE (inherited, verified): for content-column-4+
    // markers ('10. ', tab), a closer at the item content column is not
    // recognized when the streaming span ends exactly at the closer line -
    // textHasUnclosedCodeFence('10. ~~~\n    code\n    ~~~\n') is true
    // identically on prior PR head 0d2860cb21 and on baee30bc8d, so the
    // recognition gap predates this PR; the held tracker (added by this PR)
    // exposes it as pre-stop stale state. Final output stays correct via the
    // stop flush. A real closer-recognition fix fires this tripwire: retire
    // the it.fails and say why.
    const preStopRunner =
      id === 'ordered-2digit-marker-tilde-fence' || id === 'tab-marker-tilde-fence' ? it.fails : it
    preStopRunner(`${id}: held fence released before stop`, () => {
      for (const size of [null, 1, 5, 20]) {
        const adapter = deliverAdapter(input, size, false)
        expect((adapter as any).ctx.scratchpadMaskHeldFence).toBeNull()
      }
    })
  }
})
