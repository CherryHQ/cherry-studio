// Seeded whole-vs-chunked delivery fuzz for the scratchpad streaming filter.
// Generator: mulberry32(0xc0ffee) over the PIECES corpus below, 400 cases,
// each delivered whole and at chunk sizes 1/2/3/5/8; outputs must match.
import { describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

const loggerMocks = vi.hoisted(() => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: vi.fn(() => loggerMocks) } }))
const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')

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
function streamEvent(event: Record<string, unknown>) {
  return { type: 'stream_event', event, session_id: 'sdk-1', uuid: crypto.randomUUID() } as any
}
function deliver(text: string, chunkSize: number | null): string {
  const { adapter, parts } = createAdapter()
  adapter.handleMessage(
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  )
  if (chunkSize === null) {
    adapter.handleMessage(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
  } else {
    for (let i = 0; i < text.length; i += chunkSize) {
      adapter.handleMessage(
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: text.slice(i, i + chunkSize) }
        })
      )
    }
  }
  adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
  return parts
    .filter((p): p is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => p.type === 'text-delta')
    .map((p) => p.delta)
    .join('')
}

const fenceCases: Array<[string, string]> = [
  [
    'fence-close-then-indented',
    '- item\n\n  ```\n  code\n  ```\n\n      <analysis>PROBE</analysis>\n\n- next <analysis>X</analysis>\n'
  ],
  [
    'fence-close-then-list-continuation',
    '- item\n\n  continuation\n\n  ```\n  code\n  ```\n\n  cont2 <analysis>W</analysis>\n'
  ],
  ['fence-close-then-indented-code-in-list', '- item\n\n  ```js\n  x\n  ```\n\n      code2 <analysis>Y</analysis>\n'],
  ['fence-unclosed-then-quote', '```\ncode <analysis>HID</analysis>\n\n> quote <analysis>HID2</analysis>\n']
]

describe('fence continuity across advance spans', () => {
  for (const [id, input] of fenceCases) {
    it(id, () => {
      const whole = deliver(input, null)
      const c1 = deliver(input, 1)
      const c5 = deliver(input, 5)
      if (c1 !== whole || c5 !== whole) console.log('FENCE-CONTINUITY-DIFF', id, JSON.stringify({ whole, c1, c5 }))
      expect(c5).toBe(whole)
      expect(c1).toBe(whole)
    })
  }
})

describe('sentinel literal never emitted', () => {
  const inputs = [
    '- alpha beta <analysis>HID</analysis> tail\n',
    '1. alpha beta <analysis>HID</analysis> tail\nnext line\n',
    '> quote alpha <analysis>HID</analysis> beta\n',
    'plain alpha <analysis>HID</analysis> beta\n'
  ]
  for (const input of inputs) {
    it(JSON.stringify(input.slice(0, 24)), () => {
      const whole = deliver(input, null)
      for (const n of [1, 2, 3, 5, 7]) {
        const c = deliver(input, n)
        expect(c).toBe(whole)
      }
    })
  }
})

describe('HTML opener straddling delta boundary', () => {
  const openers = [
    '<script src="abcdef">',
    '<script>',
    '<textarea rows=2>',
    '<title>t</title>',
    '<style>',
    '<!--',
    '<![CDATA['
  ]
  for (const opener of openers) {
    for (let split = 1; split < opener.length && split <= 16; split++) {
      it(`${opener.slice(0, 12)} split@${split}`, () => {
        const input = `pre\n\n${opener}payload <analysis>HID</analysis> inner\n\npost <analysis>HID2</analysis>\n`
        const whole = deliver(input, null)
        const pre = input.slice(0, input.indexOf(opener) + split)
        const rest = input.slice(pre.length)
        const { adapter, parts } = createAdapter()
        adapter.handleMessage(
          streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        )
        adapter.handleMessage(
          streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: pre } })
        )
        adapter.handleMessage(
          streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: rest } })
        )
        adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
        const two = parts
          .filter((p): p is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => p.type === 'text-delta')
          .map((p) => p.delta)
          .join('')
        if (two !== whole) console.log('OPENER-BOUNDARY-DIFF', JSON.stringify({ opener, split, whole, two }))
        expect(two).toBe(whole)
      })
    }
  }
})

// Probe for reviewer finding 2/3: seeded fuzz over mixed markdown + wrapper-tag
// inputs; whole vs chunked delivery must be identical. If a stale-cache or
// context-shift defect exists, small chunk sizes should surface it.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const PIECES = [
  '- item alpha\n',
  '1. item beta\n',
  '- item\n  continuation\n',
  '    indented code\n',
  '```\ncode line\n```\n',
  '> quote line\n',
  'plain paragraph\n',
  '<analysis>hidden</analysis>\n',
  '<analysis>\nhidden block\n</analysis>\n',
  '<thinking>t</thinking>\n',
  '- item <analysis>HID</analysis> tail\n',
  '    code <analysis>HID</analysis> tail\n',
  '```\nx <analysis>HID</analysis> y\n```\n',
  '<script>var a = 1</script>\n',
  '<textarea>t</textarea>\n',
  '# heading\n',
  '- \t tabbed\n'
]
// Inherited known-base leads: these cases fail IDENTICALLY on the public head
// (0d2860cb21, base-80 subset verified case-by-case via comm against the base
// probe log) - they are pre-existing whole-vs-chunked divergences, not
// rebuild-introduced. it.fails keeps each lead gated and reproducible without
// a default CI regression: a future fix turns the case green, which fails
// it.fails and forces this list to shrink (conformance-sweep precedent).
// Case 237 retired: the round-17 stale-sibling-ownership fix made its
// whole-vs-chunked delivery consistent (cherry-pr-review P2, CommonMark ex313).
const KNOWN_INHERITED = new Set([2, 111, 138, 203, 256, 264, 300, 334, 339, 375, 384])

describe('seeded fuzz whole-vs-chunked delivery', () => {
  const rnd = mulberry32(0xc0ffee)
  for (let caseNo = 0; caseNo < 400; caseNo++) {
    const n = 3 + Math.floor(rnd() * 6)
    let input = ''
    for (let i = 0; i < n; i++) {
      input += PIECES[Math.floor(rnd() * PIECES.length)]
      if (rnd() < 0.5) input += '\n'
    }
    const run = KNOWN_INHERITED.has(caseNo) ? it.fails : it
    run(`case ${caseNo}`, () => {
      const whole = deliver(input, null)
      for (const size of [1, 2, 3, 5, 8]) {
        const chunked = deliver(input, size)
        if (chunked !== whole) console.log('FUZZ-DIFF', caseNo, size, JSON.stringify({ input, whole, chunked }))
        expect(chunked).toBe(whole)
      }
    })
  }
})
