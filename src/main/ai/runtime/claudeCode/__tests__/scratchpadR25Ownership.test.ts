import { it, expect, vi } from 'vitest'

import {
  containerLine,
  initialContainerState
} from '../../../../../../packages/aiCore/src/core/context/containerEvents'
import { summarizeHistory } from '../../../../../../packages/aiCore/src/core/context/janitor'
import { ContextPrompts } from '../../../../../../packages/aiCore/src/core/context/prompts'
import siblings from './r25SiblingCases.json'
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

function snapshot(s: ReturnType<typeof setup>, raw: string) {
  s.a.handleMessage({
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: 's',
    uuid: crypto.randomUUID(),
    message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
  } as any)
}
function checkDelivery(raw: string, chunks: string[], expected: string) {
  const s = setup()
  for (const chunk of chunks) {
    s.push(chunk)
    expect(expected.startsWith(s.text()), JSON.stringify({ raw, chunks, out: s.text() })).toBe(true)
  }
  s.stop()
  expect(s.text(), JSON.stringify({ raw, chunks, stop: true })).toBe(expected)
  snapshot(s, raw)
  expect(s.text(), JSON.stringify({ raw, chunks, snapshot: true })).toBe(expected)
}
it('existing-item sibling transition follows two independent oracles without changing paragraph interruptions', () => {
  for (const { raw, code } of siblings) {
    const state = initialContainerState()
    let verdict = false
    for (const line of raw.split('\n')) {
      const c = containerLine(state, line)
      if (line.includes('MARK')) verdict = c.code
    }
    expect(verdict, raw).toBe(code)
    const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
    expect(expected.includes('MARK'), raw).toBe(code)
    expect(ContextPrompts.formatCompactSummary(raw).includes('MARK'), raw).toBe(code)
    for (const size of [1, 3, 20, raw.length])
      checkDelivery(
        raw,
        Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size)),
        expected
      )
  }
  for (const raw of ['paragraph\n*\n    <thinking>MARK</thinking>', 'paragraph\n2.\n    <thinking>MARK</thinking>']) {
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(raw)).not.toContain('MARK')
  }
  expect(stripKnownModelScratchpadBlocksPreservingCodeFences('paragraph\n-\n    <thinking>MARK</thinking>')).toContain(
    'MARK'
  )
}, 60000)
it('unfinished quote prefixes remain pending until sealed, with identical stop and snapshot output', () => {
  for (const q of ['> ', '> > ', '> > > ', '  > > '])
    for (const fence of ['~~~', '```', '~~~~'])
      for (const ending of ['\n', '\r\n']) {
        const raw =
          q +
          fence +
          'xml' +
          ending +
          q +
          '<thinking>literal</thinking>' +
          ending +
          q +
          fence +
          ending +
          '<analysis>SECRET</analysis>tail'
        const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
        expect(expected).toContain('literal')
        expect(expected).not.toContain('SECRET')
        for (let i = 1; i < raw.length; i++) checkDelivery(raw, [raw.slice(0, i), raw.slice(i)], expected)
        for (const tail of [
          '>',
          '> ',
          '>  ',
          '>   ',
          '>\n',
          '> \n',
          '> x\n<analysis>SECRET</analysis>',
          '>    x\n<analysis>SECRET</analysis>'
        ]) {
          const probe = q + fence + 'xml' + ending + q + 'literal' + ending + tail
          const want = stripKnownModelScratchpadBlocksPreservingCodeFences(probe)
          checkDelivery(probe, Array.from(probe), want)
        }
      }
}, 60000)
it('missing-closer summary recovery skips complete and unclosed opaque HTML text-element bodies', async () => {
  for (const tag of ['textarea', 'script', 'style', 'title', 'TEXTAREA', 'ScRiPt'])
    for (const attr of ['', ' data-x="a>b"', " data-x='<summary>attribute</summary>'"]) {
      const raw = `<analysis>Private <${tag}${attr}><summary>literal</summary></${tag}> SECRET <summary>Public</summary>`
      expect(ContextPrompts.formatCompactSummary(raw)).toBe('Public')
      expect(await summarizeHistory([{ role: 'user', content: 'hello' }], async () => raw)).toBe('Public')
      const open = `<analysis>Private <${tag}${attr}><summary>literal</summary> SECRET <summary>Public</summary>`
      expect(ContextPrompts.formatCompactSummary(open)).toBe(open) // No public boundary outside the unclosed body: preserve legacy malformed result, do not recover a literal boundary.
    }
  for (const opaque of ['<!-- <summary>literal</summary> -->', '<![CDATA[<summary>literal</summary>]]>'])
    expect(ContextPrompts.formatCompactSummary(`<analysis>Private ${opaque} SECRET <summary>Public</summary>`)).toBe(
      'Public'
    )
})
