import { describe, expect, it, vi } from 'vitest'
vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))
const { stripKnownModelScratchpadBlocksPreservingCodeFences } = await import('@cherrystudio/ai-core')
const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')
const ev = (event: any) => ({ type: 'stream_event', event, session_id: 's', uuid: crypto.randomUUID() }) as any
function setup() {
  const parts: any[] = []
  const a: any = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    sessionId: 's',
    streamOptions: { prompt: [] },
    sink: { enqueue: (p: any) => parts.push(p) },
    statusSink: { emit: () => {} },
    onSessionId: () => {}
  } as any)
  a.beginTurn()
  a.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
  return {
    a,
    text: () =>
      parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => p.delta)
        .join(''),
    push: (text: string) =>
      a.handleMessage(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    stop: () => a.handleMessage(ev({ type: 'content_block_stop', index: 0 }))
  }
}
describe('append-only scratchpad answer streaming', () => {
  it('normalizes snapshot-only text and reconciled assistant suffixes before emission', () => {
    const payload = 'Public <thinking>secret</thinking> answer'
    for (const streamed of [false, true]) {
      const s = setup()
      if (streamed) s.push('Public ')
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: payload }] }
      } as any)
      s.stop()
      expect(s.text()).toBe('Public  answer')
      expect(s.a.scratchpadPrefixViolation).toBe(false)
    }
  })
  it('retains raw ancestry across the initial deferred probe and later tick/markup splits', () => {
    for (const pieces of [
      ['foo `', '` <thinking>x</thinking>'],
      ['foo `', '<thinking>x</thinking>', '`'],
      ['foo ', '`open ', '<thinking>x</thinking>', '\n\nDone'],
      ['<analysis>secret</analysis> public ', '`open ', '<thinking>x</thinking>', '\n\nDone']
    ]) {
      const s = setup()
      for (const piece of pieces) {
        s.push(piece)
        expect(s.a.scratchpadPrefixViolation).toBe(false)
      }
      s.stop()
      const raw = pieces.join('')
      expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
      expect(s.a.scratchpadPrefixViolation).toBe(false)
    }
  })
  it('flushes a tilde-routed legacy fence without duplicating or stripping its literal wrapper', () => {
    for (const pieces of [
      ['~~~xml\n', '<thinking>literal</thinking>', '\n~~~'],
      ['~~~xml\n', '<thinking>literal</thinking>']
    ]) {
      const s = setup()
      for (const piece of pieces) s.push(piece)
      s.stop()
      expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(pieces.join('')))
      expect(s.a.scratchpadPrefixViolation).toBe(false)
    }
  })
  it('reconciles a snapshot when a raw wrapper suffix is still held by the lane', () => {
    const s = setup()
    const raw = 'Use `open <thinking>hidden</thinking>\n\nPublic'
    s.push('Use `open ')
    s.push('<thinking>hidden</thinking>')
    s.a.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 's',
      uuid: crypto.randomUUID(),
      message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
    } as any)
    s.stop()
    expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
    expect(s.a.scratchpadPrefixViolation).toBe(false)
  })
  it('records and suppresses a prefix violation without throwing or resuming emission', () => {
    const s = setup()
    s.push('Use `open ')
    s.a.ctx.scratchpadAnswerStream.visible = 'unreachable committed prefix'
    expect(() => s.push('<thinking>private</thinking>')).not.toThrow()
    expect(s.a.scratchpadPrefixViolation).toBe(true)
    const before = s.text()
    s.push('more text\n\nDone')
    s.stop()
    expect(s.text()).toBe(before)
  })
  it('uses bounded scan work after an early stray tick followed by repeated wrapper paragraphs', () => {
    const work: number[] = []
    for (const n of [200, 400]) {
      const raw = 'Use `open prose\n\n' + 'Text <thinking>secret</thinking> answer.\n\n'.repeat(n)
      const s = setup()
      for (let i = 0; i < raw.length; i += 20) s.push(raw.slice(i, i + 20))
      s.stop()
      expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
      expect(s.a.scratchpadPrefixViolation).toBe(false)
      expect(s.a.scratchpadScanInputChars).toBeLessThan(raw.length * 10)
      work.push(s.a.scratchpadScanInputChars)
    }
    expect(work[1] / Math.max(1, work[0])).toBeLessThan(2.3)
  })
  it('checks migration after legacy marker-fence forms without throwing or leaking private suffixes', () => {
    for (const marker of ['10. ', '1.\t', '- 1. ']) {
      const raw = `${marker}~~~xml\n    <thinking>literal</thinking>\n    ~~~\n\nUse \`open prose <thinking>private</thinking>\n\nDone`
      const s = setup()
      for (let i = 0; i < raw.length; i += 5) s.push(raw.slice(i, i + 5))
      s.stop()
      expect(s.a.scratchpadPrefixViolation).toBe(false)
      expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
    }
  })
  it('preserves canonical post-fence migration across two-digit/tab markers and delta sizes', () => {
    for (const marker of ['10. ', '1.\t'])
      for (const size of [1, 2, 3, 5, 7, 20, 100]) {
        const before = `${marker}~~~\n    code\n    ~~~\n\n<thinking>strip</thinking>\n`
        const s = setup()
        for (let i = 0; i < before.length; i += size) s.push(before.slice(i, i + size))
        s.push('Use `open prose ')
        s.push('<thinking>private</thinking>\n\nDone')
        s.stop()
        const raw = before + 'Use `open prose <thinking>private</thinking>\n\nDone'
        expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
        expect(s.a.scratchpadPrefixViolation).toBe(false)
      }
  })
  it('streams every delta of ordinary multiline markdown after an unmatched tick', () => {
    for (const width of [1, 2, 3])
      for (const quote of ['', '> ']) {
        const input =
          quote +
          'Use ' +
          '`'.repeat(width) +
          'open text\n\n' +
          'Paragraph **bold** [link](https://example.org).\n\n- one\n- two with `code`\n\n'.repeat(20)
        for (const size of [1, 20, 64]) {
          const s = setup()
          for (let i = 0; i < input.length; i += size) {
            s.push(input.slice(i, i + size))
            expect(s.text()).toBe(input.slice(0, i + size))
          }
          s.stop()
          expect(s.text()).toBe(input)
          expect(s.a.scratchpadScanInputChars).toBe(0)
        }
      }
  })
  it('holds only ambiguous markup, then resolves it at a completed block boundary', () => {
    const s = setup()
    s.push('Use `open prose ')
    expect(s.text()).toBe('Use `open prose ')
    s.push('<thinking>secret</thinking>')
    expect(s.text()).toBe('Use `open prose ')
    s.push('\n\nPublic answer')
    expect(s.text()).toBe('Use `open prose \n\nPublic answer')
    s.stop()
  })
  it('never emits the escaped-tick wrapper whose classification changes with a later span', () => {
    const s = setup()
    s.push('Use \\`e` ')
    s.push('<thinking>x</thinking> ')
    expect(s.text()).not.toContain('x')
    s.push('`f <thinking>y</thinking>`\n\nDone')
    s.stop()
    expect(s.text()).toBe(
      stripKnownModelScratchpadBlocksPreservingCodeFences(
        'Use \\`e` <thinking>x</thinking> `f <thinking>y</thinking>`\n\nDone'
      )
    )
  })
})
