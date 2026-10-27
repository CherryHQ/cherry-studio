import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')

const streamEvent = (event: Record<string, unknown>) =>
  ({ type: 'stream_event', event, session_id: 'sdk-1', uuid: crypto.randomUUID() }) as any

function makeAdapter(parts: any[]) {
  const adapter = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    sessionId: 'session-1',
    streamOptions: { prompt: [] },
    sink: { enqueue: (part: any) => parts.push(part) },
    statusSink: { emit: () => {} },
    onSessionId: () => {}
  } as any)
  adapter.beginTurn()
  adapter.handleMessage(
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  )
  return adapter
}

function deliverWithWork(input: string, size: number | null): { out: string; work: number } {
  const parts: any[] = []
  const adapter = makeAdapter(parts) as any
  const chunks: string[] = []
  if (size === null) chunks.push(input)
  else for (let i = 0; i < input.length; i += size) chunks.push(input.slice(i, i + size))
  for (const text of chunks) {
    adapter.handleMessage(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
  }
  adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
  const out = parts
    .filter((part) => part.type === 'text-delta')
    .map((part) => part.delta)
    .join('')
  return { out, work: adapter.scratchpadScanInputChars as number }
}

const deliver = (input: string, size: number | null) => deliverWithWork(input, size).out

const SIZES = [null, 1, 2, 5, 20]

describe('scratchpad stream review regressions (cherry-review ce6f904e6b)', () => {
  it('keeps indented code after an unindented heading that follows a list at every delivery', () => {
    const input = '- A\n# H\n    <thinking>literal</thinking>\n'
    for (const size of SIZES) expect(deliver(input, size)).toBe(input)
  })

  it('strips private analysis in a quoted list that starts outside an earlier list at every delivery', () => {
    const input = '- A\n> - A\n>     <analysis>SECRET</analysis>\n\n<summary>Public</summary>'
    const expected = deliver(input, null)
    expect(expected).not.toContain('SECRET')
    for (const size of SIZES) expect(deliver(input, size)).toBe(expected)
  })

  it('preserves literal placeholder tokens at every delivery', () => {
    const tokens = ['\uE000', '\uE002', '\uE004', '\uE006'].map((b) => `${b}INLINE_CODE_0\uE001`).join(' ')
    const input = `${tokens} \`code\` tail`
    for (const size of SIZES) expect(deliver(input, size)).toBe(input)
  })

  const word = 'word '
  const longLine = (kind: string, len: number) => {
    const w = word.repeat(Math.ceil(len / 5))
    const line =
      kind === 'tickless'
        ? `> ${w}`
        : kind === 'tick-in-head'
          ? `> see \`foo\` ${w}`
          : `> ${w.slice(0, 600)}\`foo\` ${w}`
    return line.slice(0, len)
  }

  it('does linear total scan work on long quote-led lines (tickless, tick in head, tick past the head)', () => {
    for (const kind of ['tickless', 'tick-in-head', 'tick-past-head']) {
      const small = longLine(kind, 8000)
      const large = longLine(kind, 32000)
      const ws = deliverWithWork(small, 20)
      const wl = deliverWithWork(large, 20)
      expect(ws.out).toBe(small)
      expect(wl.out).toBe(large)
      // c*n: about 14 chars scanned per input char at 20-char deltas, flat across sizes.
      expect(wl.work).toBeLessThanOrEqual(16 * large.length)
      expect(wl.work / ws.work).toBeLessThanOrEqual(4.2)
    }
  })

  it('still delivers a long open inline-code span correctly (its scan work stays super-linear: documented limit)', () => {
    const input = `> ${word.repeat(60)}\`open ${word.repeat(400)}`
    expect(deliver(input, 20)).toBe(input)
  })

  it('does not splice a nonexistent token when offset 256 falls inside tags, entities or escapes', () => {
    const tails = [
      '<thinking>x</thinking> tail `code <thinking>y</thinking>` more',
      '&amp; &#35; `code` <analysis>z</analysis> end',
      '\\`not code` <thinking>q</thinking> `real <thinking>r</thinking>` end',
      '<b>bold</b> <thinking>x</thinking>`a` b `c` <thinking>y</thinking>',
      '``a`b`` <thinking>x</thinking> `c` <thinking>y</thinking> end',
      'a`b <thinking>x</thinking>`c` d <thinking>y</thinking>'
    ]
    for (const tail of tails) {
      for (let pad = 236; pad <= 262; pad++) {
        const input = `> ${'a'.repeat(pad)}${tail}\n\nafter\n`
        const whole = deliver(input, null)
        for (const size of [1, 3, 7, 20]) expect(deliver(input, size)).toBe(whole)
      }
    }
  })

  it('carries whole when the head has no text character (rule-like line can still change type)', () => {
    const adapter = makeAdapter([]) as any
    const rule = `> ${'-'.repeat(400)}`
    expect(adapter.emittedOpenLinePrefixWithState(rule, undefined, { textBlockContextStart: 0 })).toBe(rule)
  })

  it('keeps span-in-head, mixed tick widths, escapes and multi-line quotes equal to whole delivery', () => {
    const pad = (n: number) => 'a'.repeat(n)
    const inputs: string[] = []
    for (let n = 236; n <= 262; n += 2) {
      // span begins in the head, closes past offset 256, scratchpad tag after it
      inputs.push(`> ${pad(n)}\`span ${'b'.repeat(100)}\` <thinking>x</thinking> end\n\nafter\n`)
      // mixed tick widths 1/2/1 around the cut
      inputs.push(`> ${pad(n)}\`a\` \`\`b\`c\`\` \`d\` <thinking>x</thinking> end\n\nafter\n`)
      // escape split across deltas
      inputs.push(`> ${pad(n)}\\\`e\` <thinking>x</thinking> \`f <thinking>y</thinking>\` end\n\nafter\n`)
    }
    // three long quote lines, one nested, each resetting the carry at its newline
    const long = (t: string) => `${'w '.repeat(200)}${t}`
    inputs.push(
      `> ${long('`k` <thinking>x</thinking>')}\n> > ${long('`m')} n\` <thinking>y</thinking>\n> ${long('z')}\nafter\n`
    )
    // rule-like head carries whole, then text arrives
    inputs.push(`> ${'-'.repeat(400)}x <thinking>x</thinking> end\n\nafter\n`)
    for (const input of inputs) {
      const whole = deliver(input, null)
      for (const size of [1, 3, 7, 20]) expect(deliver(input, size)).toBe(whole)
      // two-delta splits around the 256 cut, including right after a backslash or tick
      for (let k = 250; k <= 270; k++) {
        const adapterParts: any[] = []
        const adapter = makeAdapter(adapterParts)
        for (const text of [input.slice(0, k), input.slice(k)]) {
          adapter.handleMessage(
            streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
          )
        }
        adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
        const out = adapterParts
          .filter((part) => part.type === 'text-delta')
          .map((part) => part.delta)
          .join('')
        expect(out).toBe(whole)
      }
    }
  })
})
