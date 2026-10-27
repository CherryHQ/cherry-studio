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

function deliverWithWork(
  input: string,
  size: number | null
): { out: string; work: number; carry: number; whole: number } {
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
  return {
    out,
    work: adapter.scratchpadScanInputChars as number,
    carry: adapter.scratchpadCarryWorkChars as number,
    whole: adapter.scratchpadWholeSliceChars as number
  }
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
    adapter.ctx.accumulatedText = rule
    adapter.ctx.olSyncLen = -1
    adapter.ctx.textBlockContextStart = 0
    expect(adapter.emittedOpenLinePrefixWithState(undefined, adapter.ctx)).toBe(rule)
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

  it('keeps per-delta work outside the strip scan O(delta) on a long tickless quote line', () => {
    const input = `> ${'word '.repeat(8000)}`
    const r = deliverWithWork(input, 20)
    expect(r.out).toBe(input)
    // Work counters, not timing: head/tail handled by the carry and whole-accumulator
    // slices or rebuilds must stay a small multiple of the input, not quadratic.
    expect(r.work).toBeLessThan(input.length * 20)
    expect(r.carry).toBeLessThan(input.length * 80)
    expect(r.whole).toBeLessThan(input.length)
  })

  it('keeps the same bounds with a tick in the head and past the head, and over many long quote lines', () => {
    const w = 'word '.repeat(3000)
    const shapes = [`> a \`b\` ${w}`, `> ${w}\`c\` ${w}`, `> ${w}\n> > ${w}\n> ${w}\nend\n`]
    for (const input of shapes) {
      const r = deliverWithWork(input, 20)
      expect(r.out).toBe(deliver(input, null))
      expect(r.work).toBeLessThan(input.length * 30)
      expect(r.carry).toBeLessThan(input.length * 80)
      expect(r.whole).toBeLessThan(input.length * 3)
    }
    // doubling ratio: 2x the line must cost at most ~2.3x the scan input
    const mk = (n: number) => `don't use \`open ${'word '.repeat(n)}\` done\n`
    const w1 = deliverWithWork(mk(6000), 20).work
    const w2 = deliverWithWork(mk(12000), 20).work
    expect(w2 / w1).toBeLessThan(2.3)
  })

  it('emits deltas independent of the accumulator (no per-delta parent retention) across tool-protocol hold-back', () => {
    const input = `> ${'word '.repeat(2000)}<tool_use_end`
    for (const size of [1, 3, 20]) expect(deliver(input, size)).toBe(deliver(input, null))
  })

  it('tracks the trailing tag shape like the whole-string /u regex, including astral letters and split surrogate pairs', () => {
    const alphabet = ['<', '/', 'a', 'Z', '7', '_', '|', '\uFF5C', '-', ' ', '>', '\n', '\u{1D49C}', '\u{1F600}']
    let seed = 0x5eed
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let n = 0; n < 1500; n++) {
      const len = 1 + Math.floor(rnd() * 12)
      let text = ''
      for (let i = 0; i < len; i++) text += alphabet[Math.floor(rnd() * alphabet.length)]
      const adapter = makeAdapter([]) as any
      const ctx = adapter.ctx
      ctx.filterParentlessScratchpadText = true
      // code-unit chunking, so surrogate pairs are split across calls
      let at = 0
      while (at < text.length) {
        const step = 1 + Math.floor(rnd() * 3)
        adapter.takeToolProtocolStrippedVisibleDelta(text.slice(at, at + step), ctx)
        at += step
      }
      const acc: string = ctx.toolProtocolStripAccumulator
      const lt = acc.lastIndexOf('<')
      const expected = lt !== -1 && /^<\/?[\p{L}\p{N}_|\uFF5C-]*$/u.test(acc.slice(lt))
      expect(ctx.toolProtocolStripTagState !== 0, JSON.stringify(text)).toBe(expected)
    }
  })

  it('computes the stepped cut from the delta alone exactly like the full scan while the unstepped tail has no line ending', () => {
    // steppedLineEndOffset recognizes only \r\n, \r and \n (/\r\n|\r|\n/g); the fast path's end-of-line flag tests the same set.
    const adapter = makeAdapter([]) as any
    const pick = (alpha: string[], len: number, r: () => number) =>
      Array.from({ length: len }, () => alpha[Math.floor(r() * alpha.length)]).join('')
    let seed = 0xabc123
    const r = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let n = 0; n < 4000; n++) {
      const unstepped = pick(['a', ' ', '`', '>', '-', '\u2028'], Math.floor(r() * 6), r)
      const incoming = pick(['a', '\r', '\n', '`', '>', '~', '\u2029'], Math.floor(r() * 8), r)
      const full = adapter.steppedLineEndOffset(unstepped + incoming)
      const inc = adapter.steppedLineEndOffset(incoming)
      expect(inc > 0 ? unstepped.length + inc : 0, JSON.stringify([unstepped, incoming])).toBe(full)
      const combined = unstepped + incoming
      const tail = combined.slice(Math.max(full, 0))
      const flag = !combined.endsWith('\r')
      if (full > 0) expect(!/[\r\n]/.test(tail)).toBe(flag)
    }
  })

  it('keeps the previous-line verdict work bounded over thousands of indented lines', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `    code line ${i}`).join('\n')
    const input = `- item\n\n${lines}\n`
    const r = deliverWithWork(input, 20)
    expect(r.out).toBe(deliver(input, null))
    expect(r.whole).toBeLessThan(input.length)
    expect(r.carry).toBeLessThan(input.length * 80)
  })

  it('previous-line verdict from the two-line window equals the full-block verdict on random documents', () => {
    // isLeafBlockBoundaryLine reads the previous line and, only for a setext-looking underline, the one line before it;
    // the paragraph-open decision is made from that second line alone, so a two-line window suffices.
    const adapter = makeAdapter([]) as any
    const pool = [
      '',
      '   ',
      'text',
      '# H',
      '#',
      '===',
      '---',
      '- - -',
      '***',
      '___',
      '- item',
      '1. item',
      '> quote',
      '>',
      '> ---',
      '> # h',
      '```',
      '~~~',
      '    code',
      '\tcode',
      '  - nested',
      '-',
      '=',
      'a'.repeat(1500),
      '    ' + 'b'.repeat(1200)
    ]
    let seed = 0x7ee7
    const r = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let n = 0; n < 3000; n++) {
      const count = 2 + Math.floor(r() * 6)
      const lines = Array.from({ length: count }, () => {
        const l = pool[Math.floor(r() * pool.length)]
        return r() < 0.15 ? `${l}\r` : l
      })
      const text = lines.join('\n') + '\n'
      let start = 0
      const starts: number[] = []
      for (const l of lines) {
        starts.push(start)
        start += l.length + 1
      }
      for (let i = 1; i <= lines.length; i++) {
        const lineStart = i === lines.length ? text.length : starts[i]
        const full = adapter.indentCarryAllowedByPreviousLine(text, lineStart)
        const window = (i >= 2 ? `${lines[i - 2]}\n` : '') + `${lines[i - 1]}\n`
        expect(adapter.indentCarryAllowedByPreviousLine(window, window.length), JSON.stringify(lines.slice(0, i))).toBe(
          full
        )
      }
    }
  })

  it('extends a span-deferred remainder without rescanning and matches the full scan (output and ctx state) after every delta', () => {
    const snapshot = (adapter: any, parts: any[]) => {
      const ctx = adapter.ctx
      const picked: Record<string, unknown> = {}
      for (const key of Object.keys(ctx).sort()) {
        if (
          /^(scratchpad|ol[A-Z]|accRecent|accumulatedText|accGen|toolProtocol|streamedTextLength|textStreamedViaContentBlock)/.test(
            key
          )
        ) {
          picked[key] = ctx[key]
        }
      }
      return {
        picked,
        text: parts
          .filter((part) => part.type === 'text-delta')
          .map((part) => part.delta)
          .join('')
      }
    }
    let seed = 0xfa57
    const r = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const words = ['plain ', 'prose ', "don't ", 'use ', 'it, ', 'x', '12 ', '(ok) ', 'caf\u00e9 ', '\u4e2d\u6587 ']
    const specials = [
      '`',
      '``',
      '```',
      '~',
      '~~~',
      '<',
      '>',
      '&',
      '&lt;',
      '\\',
      '\n',
      '\r\n',
      '\n\n',
      '<thinking>q</thinking>',
      '<thinking>',
      '</thinking>',
      '<b>',
      '\uE000',
      '|',
      '> '
    ]
    let fastHits = 0
    for (let n = 0; n < 150; n++) {
      let input = r() < 0.5 ? '> ' : ''
      const pieces = 3 + Math.floor(r() * 7)
      for (let i = 0; i < pieces; i++) {
        input += r() < 0.25 ? '`'.repeat(1 + Math.floor(r() * 3)) : ''
        const runs = 1 + Math.floor(r() * 10)
        for (let k = 0; k < runs; k++) input += words[Math.floor(r() * words.length)]
        input += r() < 0.45 ? specials[Math.floor(r() * specials.length)] : ''
      }
      const sizes = [1, 2, 3, 7, 20]
      const size = sizes[Math.floor(r() * sizes.length)]
      const partsA: any[] = []
      const partsB: any[] = []
      const fast = makeAdapter(partsA) as any
      const slow = makeAdapter(partsB) as any
      slow.scratchpadInlineDeferFastPath = false
      for (let i = 0; i < input.length; i += size) {
        const text = input.slice(i, i + size)
        const before = fast.ctx.scratchpadStreamRemainder.length
        for (const a of [fast, slow]) {
          a.handleMessage(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
        }
        if (fast.scratchpadScanInputChars < slow.scratchpadScanInputChars) fastHits++
        const a = snapshot(fast, partsA)
        const b = snapshot(slow, partsB)
        expect(a.text, JSON.stringify([input, size, i])).toBe(b.text)
        expect(a.picked, JSON.stringify([input, size, i])).toEqual(b.picked)
        void before
      }
      for (const a of [fast, slow]) a.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
      expect(snapshot(fast, partsA).text).toBe(snapshot(slow, partsB).text)
    }
    expect(fastHits).toBeGreaterThan(0)
  }, 100000)

  it('span-deferred fast path: block-marker completion after an open tick line matches the full scan and fast-hits in every category', () => {
    const snapshot = (adapter: any, parts: any[]) => {
      const ctx = adapter.ctx
      const picked: Record<string, unknown> = {}
      for (const key of Object.keys(ctx).sort()) {
        if (
          /^(scratchpad|ol[A-Z]|accRecent|accumulatedText|accGen|toolProtocol|streamedTextLength|textStreamedViaContentBlock)/.test(
            key
          )
        ) {
          picked[key] = ctx[key]
        }
      }
      return {
        picked,
        text: parts
          .filter((p) => p.type === 'text-delta')
          .map((p) => p.delta)
          .join('')
      }
    }
    const hits = new Map<string, number>()
    const markers = [
      '-',
      '+',
      '=',
      '1',
      '1.',
      '1)',
      ' ',
      '\t',
      '    ',
      '- ',
      '-\t',
      '  -',
      '2',
      '10',
      '>',
      '#',
      '*',
      '[',
      '[a](',
      '![a](',
      '[a]',
      '[a](b',
      '<',
      ''
    ]
    const tails = [' x', '. x', ' x y', ') x', ' (z', '', ' \n', '\n']
    for (const lead of ['', '> ']) {
      for (const width of [1, 2, 3]) {
        for (const lineStart of [true, false]) {
          for (const marker of markers) {
            for (const tail of tails) {
              for (const size of [1, 2, 5, 100]) {
                const tick = '`'.repeat(width)
                const input = lineStart
                  ? `${lead}a ${tick}b c\n${lead}${marker}${tail}`
                  : `${lead}a ${tick}b c ${marker}${tail}`
                const partsA: any[] = []
                const partsB: any[] = []
                const fast = makeAdapter(partsA) as any
                const slow = makeAdapter(partsB) as any
                slow.scratchpadInlineDeferFastPath = false
                for (let i = 0; i < input.length; i += size) {
                  const text = input.slice(i, i + size)
                  for (const a of [fast, slow]) {
                    a.handleMessage(
                      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
                    )
                  }
                  if (fast.scratchpadScanInputChars < slow.scratchpadScanInputChars) {
                    for (const k of [
                      `lead:${lead ? 'quote' : 'plain'}`,
                      `width:${width}`,
                      `pos:${lineStart ? 'linestart' : 'midline'}`,
                      `size:${size}`
                    ])
                      hits.set(k, (hits.get(k) ?? 0) + 1)
                  }
                  const a = snapshot(fast, partsA)
                  const b = snapshot(slow, partsB)
                  const label = JSON.stringify([input, size, i])
                  expect(a.text, label).toBe(b.text)
                  expect(a.picked, label).toEqual(b.picked)
                }
                for (const a of [fast, slow]) a.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
                expect(snapshot(fast, partsA).text).toBe(snapshot(slow, partsB).text)
              }
            }
          }
        }
      }
    }
    for (const k of [
      'lead:quote',
      'lead:plain',
      'width:1',
      'width:2',
      'width:3',
      'pos:linestart',
      'pos:midline',
      'size:1',
      'size:2',
      'size:5'
    ])
      expect(hits.get(k) ?? 0, k).toBeGreaterThan(0)
  }, 100000)

  it('does linear scan work on a long quote or plain line with a stray unpaired tick', () => {
    for (const lead of ['> ', '']) {
      const input = `${lead}don't use \`open ${'word '.repeat(12000)}\` done <thinking>x</thinking> end\n`
      const r = deliverWithWork(input, 20)
      expect(r.out).toBe(deliver(input, null))
      expect(r.work).toBeLessThan(input.length * 40)
      expect(r.whole).toBeLessThan(input.length * 3)
    }
  })
})
