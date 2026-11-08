import { describe, it, expect, vi } from 'vitest'
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))
const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')
const { ContextPrompts } = await import('@cherrystudio/ai-core')
const ev = (event: any) => ({ type: 'stream_event', event, session_id: 's', uuid: crypto.randomUUID() }) as any
function run(parts: string[]) {
  const out: any[] = []
  const a: any = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    sessionId: 's',
    streamOptions: { prompt: [] },
    sink: { enqueue: (p: any) => out.push(p) },
    statusSink: { emit: () => {} },
    onSessionId: () => {}
  })
  a.beginTurn()
  a.handleMessage(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
  for (const text of parts)
    a.handleMessage(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
  a.handleMessage(ev({ type: 'content_block_stop', index: 0 }))
  return {
    text: out
      .filter((p) => p.type === 'text-delta')
      .map((p) => p.delta)
      .join(''),
    violation: a.scratchpadPrefixViolation
  }
}
describe('mixed-container raw paragraph ownership', () => {
  for (const width of [1, 2]) {
    const tick = '`'.repeat(width),
      s = `> - x\n${tick}\n> <analysis>MARK</analysis>\n${tick}\n`
    it(`formatter width ${width}`, () => expect(ContextPrompts.formatCompactSummary(s)).toBe(s.trim()))
    it(`adapter every split width ${width}`, () => {
      for (let i = 0; i <= s.length; i++) {
        const result = run([s.slice(0, i), s.slice(i)])
        expect(result.text, `split ${i}`).toBe(s)
        expect(result.violation).toBe(false)
      }
    })
    it(`adapter char width ${width}`, () => expect(run([...s]).text).toBe(s))
  }
})

describe('keep initial paragraph ownership while tags are incomplete', () => {
  for (const raw of [
    '  <analysis>MARK_1_</analysis>\n        y\n\t<analysis>MARK_0_</analysis>\n> ---\n>  1. /url\n',
    '  <analysis>MARK_1_</analysis>\n    /url\n\t<analysis>MARK_0_</analysis>\n- > ---\n>  1. ``\n'
  ]) {
    it('removes nonliteral scratchpad content at every two-part split', () => {
      for (let i = 0; i <= raw.length; i++) {
        const result = run([raw.slice(0, i), raw.slice(i)])
        expect(result.text, `split ${i}`).not.toContain('MARK_')
        expect(result.violation).toBe(false)
      }
    })
    it('removes nonliteral scratchpad content in character delivery', () =>
      expect(run([...raw]).text).not.toContain('MARK_'))
  }
})
