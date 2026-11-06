import { it, expect, vi } from 'vitest'

import {
  containerLine,
  initialContainerState
} from '../../../../../../packages/aiCore/src/core/context/containerEvents'
import { summarizeHistory } from '../../../../../../packages/aiCore/src/core/context/janitor'
import { ContextPrompts } from '../../../../../../packages/aiCore/src/core/context/prompts'
import boundaryCases from './r26BoundaryCases.json'
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

it('container boundary ownership matches both independent parsers', async () => {
  for (const { raw, code, markdownIt } of boundaryCases) {
    const state = initialContainerState()
    let verdict = false
    for (const line of raw.split('\n')) {
      const result = containerLine(state, line)
      if (line.includes('MARK')) verdict = result.code
    }
    expect(verdict, raw).toBe(code)
    expect(code).toBe(markdownIt)
    const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
    expect(expected.includes('MARK'), raw).toBe(code)
    expect(ContextPrompts.formatCompactSummary(raw).includes('MARK'), raw).toBe(code)
    expect((await summarizeHistory([{ role: 'user', content: 'hello' }], async () => raw)).includes('MARK'), raw).toBe(
      code
    )
    for (const size of [1, 2, 3, 5, 7, 20, raw.length])
      checkDelivery(
        raw,
        Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size)),
        expected
      )
  }
}, 60000)
it('line ownership commits consistently around provisional CR and all fence boundaries', () => {
  for (const prefix of ['', '- ', '> ', '> > ', '- > ', '> - '])
    for (const char of ['```', '~~~', '````', '~~~~'])
      for (const nl of ['\n', '\r\n', '\r']) {
        const cont = prefix.replace('-', ' ')
        const raw =
          prefix +
          char +
          'xml' +
          nl +
          cont +
          '<thinking>LIT</thinking>' +
          nl +
          cont +
          char +
          nl +
          '<analysis>SECRET</analysis>tail'
        const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
        for (const size of [1, 2, 3, 5, 7, 20, raw.length])
          checkDelivery(
            raw,
            Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size)),
            expected
          )
        for (let i = 1; i < raw.length; i++) checkDelivery(raw, [raw.slice(0, i), raw.slice(i)], expected)
        for (const suffix of ['\r', '\rX', '\r\n', '\r\n<analysis>SECRET</analysis>']) {
          const t = prefix + char + 'xml' + nl + cont + 'LIT' + nl + cont + char + suffix
          checkDelivery(t, Array.from(t), stripKnownModelScratchpadBlocksPreservingCodeFences(t))
        }
      }
}, 60000)
