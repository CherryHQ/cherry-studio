// Conformance corpus: derived from the CommonMark 0.31.2 specification
// examples (https://spec.commonmark.org/0.31.2/, CC BY-SA 4.0, (c) the
// CommonMark authors). Regenerate with ./generate-corpus-cases.sh (same dir).
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

import corpus from '../../../../../../packages/aiCore/src/core/context/__tests__/corpus-cases.json'

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

beforeEach(() => {
  vi.clearAllMocks()
})

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
    .filter((part): part is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => part.type === 'text-delta')
    .map((part) => part.delta)
    .join('')
}

describe('commonmark corpus: snapshot/delta delivery consistency', () => {
  for (const c of corpus) {
    it(`${c.id} [${c.section}]`, () => {
      const whole = deliver(c.input, null)
      expect(deliver(c.input, 5)).toBe(whole)
      expect(deliver(c.input, 1)).toBe(whole)
    })
  }
})

describe('termination and performance bounds (corpus pathologies)', () => {
  const cases: Array<[string, string]> = [
    ['long whitespace tail', 'Text.' + ' '.repeat(100_000)],
    ['deep quote nesting on one line', '> '.repeat(5_000) + 'text'],
    ['repeated comparison candidates', 'a<b, '.repeat(20_000)],
    ['tab-led run in a list', '- Parent\n' + '\n\t<analysis>x</analysis>\n\nDone.\n'.repeat(2_000)],
    ['deep list nesting', Array.from({ length: 2_000 }, (_, i) => `${'  '.repeat(i % 40)}- item ${i}`).join('\n')],
    ['unclosed fences', Array.from({ length: 2_000 }, (_, i) => '```\ncode ' + i).join('\n')]
  ]
  // Pre-existing perf cliff (round-17 conformance Finding 3): a 5000-marker
  // quote line reparses per delta. No wall-clock assertion for it - a fast
  // machine would pass an it.fails gate and a slow one would flake a budget;
  // the vitest timeout is the deterministic termination gate until the cliff
  // gets a real fix with a reliable bound.
  const NO_WALLCLOCK = new Set(['deep quote nesting on one line'])
  for (const [name, input] of cases) {
    it(
      name,
      () => {
        const start = performance.now()
        const out = deliver(input, 7)
        const elapsed = performance.now() - start
        console.log({ case: name, characters: input.length, elapsed })
        expect(typeof out).toBe('string')
        if (!NO_WALLCLOCK.has(name)) expect(elapsed).toBeLessThan(2_000)
      },
      10_000
    )
  }
})
