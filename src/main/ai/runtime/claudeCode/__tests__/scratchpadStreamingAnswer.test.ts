import { describe, expect, it, vi } from 'vitest'

import freshCorpus from './r16-corpus.json'
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
  })
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
  it('keeps literal markup at the tilde-to-inline transition and streams the next user turn', () => {
    const raw = '~~~\ncode\n~~~\n\n`<thinking>literal</thinking>`\n<thinking>hidden2</thinking>\nDone'
    const s = setup()
    for (let i = 0; i < raw.length; i += 3) s.push(raw.slice(i, i + 3))
    s.stop()
    expect(s.a.scratchpadPrefixViolation).toBe(false)
    expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
    const before = s.text()
    s.a.beginTurn({ userPrompt: true })
    s.a.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
    s.push('Hello world')
    expect(s.text().slice(before.length)).toBe('Hello world')
    s.stop()
  })
  it('preserves balanced protocol-named markup containing literal HTML text bodies in snapshots', () => {
    for (const payload of [
      '<parameter><textarea>Literal </parameter></textarea></parameter>',
      '<parameter><script>const x = "</parameter>"</script></parameter>',
      '<parameter><style>x::after {content:"</parameter>"}</style></parameter>',
      '<parameter><title>Literal </parameter></title></parameter>'
    ]) {
      const s = setup()
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: payload }] }
      } as any)
      s.stop()
      expect(s.text()).toBe(payload)
    }
  })
  it('does not rebuild previous legacy history for tick events without a completed blank boundary', () => {
    const s = setup()
    s.push('<b>heading</b> ')
    const original = s.a.filterScratchpadFromOngoingDelta.bind(s.a)
    // Keep the established scanner's own work separate from migration-attempt instrumentation.
    s.a.filterScratchpadFromOngoingDelta = (text: string, ctx: any) => {
      const n = s.a.scratchpadScanInputChars
      const out = original(text, ctx)
      s.a.scratchpadScanInputChars = n
      return out
    }
    const before = s.a.scratchpadScanInputChars
    for (let i = 0; i < 100; i++) s.push('`code` words ')
    expect(s.a.scratchpadScanInputChars).toBe(before)
    s.stop()
    expect(s.a.scratchpadPrefixViolation).toBe(false)
  })
  it('carries literal HTML ownership after a fragmented tilde fence closer', () => {
    const exact = ['~~~\ncode\n', '~~~\n\n<textarea>\n', '<thinking>literal</thinking>\n</textarea>\nDone']
    const raw = exact.join('')
    for (const pieces of [
      exact,
      ...[1, 2, 3, raw.length].map((size) =>
        Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size))
      )
    ]) {
      const s = setup()
      for (const piece of pieces) s.push(piece)
      s.stop()
      expect(s.text()).toBe(raw)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text()).toBe(raw)
    }
  })
  it('does not retain phantom HTML fence ancestry after ordinary post-close spans', () => {
    for (const middle of ['plain\n', 'ordinary text long enough to move overlap\n']) {
      const pieces = [
        '~~~\ncode\n',
        '~~~\n\n' + middle,
        '<textarea>\n',
        '<thinking>literal</thinking>\n</textarea>\nDone'
      ]
      const raw = pieces.join('')
      const s = setup()
      for (const piece of pieces) s.push(piece)
      s.stop()
      expect(s.text()).toBe(raw)
    }
  })
  it('matches canonical HTML/fence ownership across closer partitions and containers', () => {
    for (const [open, close, html] of [
      ['~~~\ncode\n', '~~~\n', '<textarea>'],
      ['~~~js\ncode\n', '~~~\n', '<textarea>'],
      ['  ~~~\n  code\n', '  ~~~\n', '<textarea>'],
      ['> ~~~\n> code\n', '> ~~~\n', '<textarea>'],
      ['- ~~~\n  code\n', '  ~~~\n', '<textarea>']
    ]) {
      const raw = open + close + '\n' + html + '\n<thinking>literal</thinking>\n</textarea>\nDone'
      const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
      for (const pieces of [
        [open, close, '\n' + html + '\n', '<thinking>literal</thinking>\n</textarea>\nDone'],
        ...[1, 2, 3].map((size) =>
          Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size))
        )
      ]) {
        const s = setup()
        for (const piece of pieces) s.push(piece)
        s.stop()
        expect(s.text(), JSON.stringify({ open, pieces })).toBe(expected)
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text()).toBe(expected)
      }
    }
  })
  it('keeps textarea ownership when body ticks follow a prior fence closer in same delta', () => {
    const exact = ['~~~\na\n', '~~~\n<textarea>\n```\nx\n', '<thinking>lit</thinking>\n```\n</textarea>\nDone']
    const raw = exact.join('')
    for (const pieces of [
      exact,
      ...[1, 2, 3].map((size) =>
        Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size))
      )
    ]) {
      const s = setup()
      for (const piece of pieces) s.push(piece)
      s.stop()
      expect(s.text()).toBe(raw)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text()).toBe(raw)
    }
  })
  it('preserves latest review literal ownership cases through every delivery', () => {
    const cases = [
      ['Use `<textarea>`\n\n~~~xml\n<thinking>LITERAL</thinking>\n~~~', [1000]],
      [
        '~~~xml\n<thinking>LITERAL</thinking>\n~~~\n<textarea><thinking>LITERAL</thinking></textarea>',
        [5, 1, 2, 3, 1000]
      ],
      ['`open <textarea><thinking>LITERAL</thinking></textarea>\n\nDone', [3, 1, 2, 5, 1000]]
    ] as const
    for (const [raw, sizes] of cases)
      for (const size of sizes) {
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        expect(s.text(), JSON.stringify({ raw, size })).toBe(raw)
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text()).toBe(raw)
        expect(s.a.scratchpadPrefixViolation).toBe(false)
      }
  })
  it.each([
    ['code-literal-fence', 'Use `<textarea>`\n\n~~~xml\n<thinking>LITERAL</thinking>\n~~~', 1000],
    [
      'five-char-HTML-overlap',
      '~~~xml\n<thinking>LITERAL</thinking>\n~~~\n<textarea><thinking>LITERAL</thinking></textarea>',
      5
    ],
    ['three-char-literal-prefix', '`open <textarea><thinking>LITERAL</thinking></textarea>\n\nDone', 3]
  ])('pins original sensitivity %s', (_name, raw, size) => {
    const s = setup()
    for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
    s.stop()
    expect(s.text()).toBe(raw)
    s.a.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 's',
      uuid: crypto.randomUUID(),
      message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
    } as any)
    expect(s.text()).toBe(raw)
  })
  it('does not commit revocable text-body ownership across later inline ticks', () => {
    const raw = '`<style>``<thinking>`SECRET<thinking>-->```\n'
    const s = setup()
    for (let i = 0; i < raw.length; i += 2) s.push(raw.slice(i, i + 2))
    s.stop()
    expect(s.text()).toBe(raw)
    s.a.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 's',
      uuid: crypto.randomUUID(),
      message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
    } as any)
    expect(s.text()).toBe(raw)
  })
  it('preserves independent R16 regression corpus across delivery partitions', () => {
    for (const raw of freshCorpus)
      for (const size of [2, 3, 5]) {
        const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text(), JSON.stringify({ raw, size })).toBe(expected)
        expect(s.a.scratchpadPrefixViolation).toBe(false)
      }
  })
  it.each(['1.     <analysis>LITERAL</analysis>\n', '* * *\n\n    <thinking>LITERAL</thinking>\n'])(
    'preserves literal code after marker padding and thematic breaks: %j',
    (raw) => {
      for (const size of [1, 2, 3, 5, raw.length]) {
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        expect(s.text()).toBe(raw)
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text()).toBe(raw)
      }
    }
  )
  it('preserves thematic breaks without blank lines and after prior lists', () => {
    for (const marker of ['* * *', '- - -', '_ _ _'])
      for (const lead of ['', '- x\n', '1. a\n'])
        for (const blank of ['', '\n']) {
          const raw = lead + marker + '\n' + blank + '    <thinking>L</thinking>\n'
          for (const size of [1, 2, 3, 5, raw.length]) {
            const s = setup()
            for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
            s.stop()
            expect(s.text()).toBe(raw)
            s.a.handleMessage({
              type: 'assistant',
              parent_tool_use_id: null,
              session_id: 's',
              uuid: crypto.randomUUID(),
              message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
            } as any)
            expect(s.text()).toBe(raw)
          }
        }
  })
  it('bounds long fragmented marker-only padding', () => {
    for (const count of [8000, 16000]) {
      const raw = '1.' + ' '.repeat(count) + '<analysis>LITERAL</analysis>\n'
      const s = setup()
      const start = performance.now()
      for (let i = 0; i < raw.length; i += 64) s.push(raw.slice(i, i + 64))
      s.stop()
      expect(s.text()).toBe(raw)
      console.log({
        markerPadding: count,
        ms: performance.now() - start,
        scanChars: s.a.scratchpadScanInputChars,
        carryChars: s.a.scratchpadCarryWorkChars
      })
      expect(performance.now() - start).toBeLessThan(1500)
    }
  })
  it('keeps heading carry and outer scratchpad cutoff consistent through snapshots', () => {
    for (const pieces of [
      ['# Heade', 'r\n    <thinking>literal</thinking>\n\n\nDone'],
      ['`x`\n\nAnswer. <analysis>secret<thinking>', '</analysis>after']
    ]) {
      const raw = pieces.join('')
      const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
      for (const chunks of [
        pieces,
        ...[1, 2, 3, 5, raw.length].map((size) =>
          Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size))
        )
      ]) {
        const s = setup()
        for (const chunk of chunks) s.push(chunk)
        s.stop()
        expect(s.text()).toBe(expected)
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text()).toBe(expected)
        expect(s.a.scratchpadPrefixViolation).toBe(false)
      }
    }
  })
  it('pins ancestor-closing wrapper sensitivity separately', () => {
    const raw = '`x`\n\nAnswer. <analysis>secret<thinking></analysis>after'
    const s = setup()
    for (let i = 0; i < raw.length; i += 3) s.push(raw.slice(i, i + 3))
    s.stop()
    expect(s.text()).toBe('`x`\n\nAnswer. after')
  })
  it('holds wrapper markup on an unfinished backtick info line but streams valid code bodies', () => {
    for (const prefix of ['Text\n', '<b>Text</b>\n', '<analysis>hidden</analysis>Text\n'])
      for (const marker of ['```', '````', '~~~'])
        for (const suffix of ['`', '\ncode\n' + marker, '']) {
          const raw = prefix + marker + '<thinking>SECRET</thinking>' + suffix
          const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
          for (const size of [1, 2, 3, 5, 7, raw.length]) {
            const s = setup()
            for (let i = 0; i < raw.length; i += size) {
              s.push(raw.slice(i, i + size))
              if (!expected.includes('SECRET')) expect(s.text()).not.toContain('SECRET')
            }
            s.stop()
            expect(s.text()).toBe(expected)
            expect(s.a.scratchpadPrefixViolation).toBe(false)
            s.a.handleMessage({
              type: 'assistant',
              parent_tool_use_id: null,
              session_id: 's',
              uuid: crypto.randomUUID(),
              message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
            } as any)
            expect(s.text()).toBe(expected)
          }
        }
    const s = setup()
    s.push('Text\n```js\n')
    s.push('const answer = 42\n')
    expect(s.text()).toContain('const answer = 42')
    s.stop()
  })
  it('withholds a closing backtick run that can still grow and revoke inline ownership', () => {
    for (const n of [1, 2, 3, 4, 5])
      for (const extra of [1, 2]) {
        const raw = (n < 3 ? '' : 'Text ') + '`'.repeat(n) + '<thinking>SECRET</thinking>' + '`'.repeat(n + extra)
        for (const size of [1, 2, 3, 5, 7, raw.length]) {
          const s = setup()
          for (let i = 0; i < raw.length; i += size) {
            s.push(raw.slice(i, i + size))
            expect(s.text()).not.toContain('SECRET')
          }
          s.stop()
          expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
          s.a.handleMessage({
            type: 'assistant',
            parent_tool_use_id: null,
            session_id: 's',
            uuid: crypto.randomUUID(),
            message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
          } as any)
          expect(s.text()).not.toContain('SECRET')
        }
      }
  })
  it('keeps both completed triple-backtick inline spans through stop and snapshot', () => {
    const raw = 'Here:\n\n```<thinking>one</thinking>``` and ```<thinking>two</thinking>``` end'
    for (const size of [1, 2, 3, 4, 5, 6, 7, raw.length]) {
      const s = setup()
      for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
      s.stop()
      expect(s.a.scratchpadPrefixViolation).toBe(false)
      expect(s.text(), `size ${size}`).toBe(raw)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text()).toBe(raw)
    }
  })
  it('strips sibling-item paragraph analysis without confusing setext precedence', () => {
    for (const raw of [
      '* star\n-\n    <thinking>SECRET</thinking>\n',
      '- a\n-\n    <thinking>SECRET</thinking>\n',
      '1. item\n-\n    <thinking>SECRET</thinking>\n',
      '* star\n-  \n    <thinking>SECRET</thinking>\n',
      '* star\n -\n    <thinking>SECRET</thinking>\n',
      '- list para\n-\t\n    <thinking>SECRET</thinking>\n'
    ])
      for (const size of [1, 2, 3, 5, 7, 13, raw.length]) {
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        expect(s.text()).not.toContain('SECRET')
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text()).not.toContain('SECRET')
      }
  })
  it('strips the independent cross-container and empty-marker privacy corpus', () => {
    for (const raw of [
      '> quoted para\n-\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n- \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n-  \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n-   \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n-\t\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n - \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -  \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -   \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -\t\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  - \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -  \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -   \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -\t\n    <thinking>SECRET</thinking>\n',
      '-\n- \n    <analysis>SECRET</analysis>\n',
      '# H\n \n-\n- \n    <analysis>SECRET</analysis>\n'
    ]) {
      for (const size of [1, 2, 3, 5, 7, 13, raw.length]) {
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        expect(s.text()).not.toContain('SECRET')
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text()).not.toContain('SECRET')
      }
    }
  })
  it('preserves setext and consecutive-fence code through fragmented stop and snapshot', () => {
    for (const raw of [
      ...['-', '- ', '-  ', '-   ', '--', '-- ', '==='].map(
        (underline) => `Title\n${underline}\n    <thinking>literal example</thinking>\n`
      ),
      '~~~\nx\n~~~\n~~~xml\ny\n~~~\n    <thinking>CODE</thinking>\n'
    ]) {
      for (const size of [1, 2, 3, 5, 7, 13, raw.length]) {
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        expect(s.text(), `size ${size}`).toBe(raw)
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        expect(s.text(), `snapshot size ${size}`).toBe(raw)
      }
    }
  })
  it('finalizes malformed nesting with the one-pass whole-text remainder', () => {
    const raw = '<thinking><thinking>1. - <analysis>#x``x`SECRET`1. </thinking><analysis></assessment>> > 1. '
    for (const size of [1, 3, 7, raw.length]) {
      const s = setup()
      for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
      s.stop()
      expect(s.text()).toBe(stripKnownModelScratchpadBlocksPreservingCodeFences(raw))
      expect(s.text()).not.toContain('SECRET')
    }
  })
  it('strips a private wrapper after a leading stray closing tag', () => {
    const raw = '</analysis><thinking>SECRET</thinking>done'
    const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
    for (const size of [1, 2, 3, 5, raw.length]) {
      const s = setup()
      for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
      s.stop()
      expect(s.text()).toBe(expected)
    }
  })
  it('keeps quoted greater-than attributes opaque through fragments and snapshot', () => {
    const exact = ['`x`\n\n', '<div title="> <analysis>literal</analysis>"', '>PUBLIC</div>']
    const raw = exact.join('')
    for (const prefix of ['<b>x</b> ', '</b> ', '<br/> ']) {
      const prefixed = ['`x`\n\n', `${prefix}<div title="> `, '<analysis>literal</analysis>"', '>PUBLIC</div>']
      const full = prefixed.join('')
      for (const pieces of [
        prefixed,
        ...[1, 2, 3].map((size) =>
          Array.from({ length: Math.ceil(full.length / size) }, (_, i) => full.slice(i * size, (i + 1) * size))
        )
      ]) {
        const ps = setup()
        for (const piece of pieces) ps.push(piece)
        ps.stop()
        expect(ps.text()).toBe(full)
        ps.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: full }] }
        } as any)
        expect(ps.text()).toBe(full)
        expect(ps.a.scratchpadPrefixViolation).toBe(false)
      }
    }
    for (const pieces of [
      exact,
      ['`x`\n\n', '<div title="> ', '<analysis>literal</analysis>"', '>PUBLIC</div>'],
      ['`x`\n\n', '<div title="', '> ', '<analysis>literal</analysis>"', '>PUBLIC</div>'],
      ['`x`\n\n', '<div title=">', ' <analysis>literal</analysis>"', '>PUBLIC</div>'],
      ...[1, 2, 3, raw.length].map((size) =>
        Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size))
      )
    ]) {
      const s = setup()
      for (const piece of pieces) s.push(piece)
      s.stop()
      expect(s.text(), JSON.stringify(pieces)).toBe(raw)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text()).toBe(raw)
      expect(s.a.scratchpadPrefixViolation).toBe(false)
    }
  })
  it('preserves unfinished nested marker fence partitions and matching snapshots', () => {
    const pieces = ['- item\n\n- 1.', ' ~~~\n     <thinking>x</thinking>\n     ~~~\n']
    const raw = pieces.join('')
    const s = setup()
    for (const piece of pieces) s.push(piece)
    s.stop()
    expect(s.text()).toBe(raw)
    s.a.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 's',
      uuid: crypto.randomUUID(),
      message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
    } as any)
    expect(s.text()).toBe(raw)
  })
  it('matches whole normalization for nested marker, quote, and CRLF split matrices', () => {
    for (const nl of ['\n', '\r\n']) {
      for (const [marker, indent] of [
        ['- 1.', '     '],
        ['- 1)', '     '],
        ['+ 1.', '     '],
        ['- - 1.', '       '],
        ['> - 1.', '>      ']
      ]) {
        const raw = ['- item', '', `${marker} ~~~`, `${indent}<thinking>x</thinking>`, `${indent}~~~`, ''].join(nl)
        const canonical = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
        for (const size of [1, 2, 3, raw.length]) {
          const s = setup()
          for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
          s.stop()
          expect(s.text(), JSON.stringify({ nl, marker, size, phase: 'stop' })).toBe(canonical)
          s.a.handleMessage({
            type: 'assistant',
            parent_tool_use_id: null,
            session_id: 's',
            uuid: crypto.randomUUID(),
            message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
          } as any)
          expect(s.text(), JSON.stringify({ nl, marker, size, phase: 'snapshot' })).toBe(canonical)
        }
      }
    }
  })
  it('preserves trailing protocol-shaped literals inside unclosed HTML text bodies in every delivery', () => {
    for (const name of ['textarea', 'script', 'style', 'title'])
      for (const size of [1, 3, 1000]) {
        const raw = `<${name}>Literal </parameter>`
        const s = setup()
        for (let i = 0; i < raw.length; i += size) s.push(raw.slice(i, i + size))
        s.stop()
        expect(s.text()).toBe(raw)
        const snap = setup()
        snap.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
        } as any)
        snap.stop()
        expect(snap.text()).toBe(raw)
      }
  })
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
