import { it, expect, vi } from 'vitest'

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

it('preserves CR ownership through pending carry, held fences and previous lines', () => {
  const documents = [
    'a **b\n~~~\n~~~\n<analysis>SECRET</analysis>tail',
    '\n~~~\n- \n<analysis>SECRET</analysis>tail',
    'text\ntext\na **b\n~~~\n>\n<analysis>SECRET</analysis>tail',
    '-\n\t\n---\n---\na **b\n~~~\n<analysis>SECRET</analysis>tail',
    '~~~\n===\n===\ntext\n~~~\n---\n<analysis>SECRET</analysis>tail',
    '# heading\n    <analysis>LITERAL</analysis>\n<analysis>SECRET</analysis>tail',
    'text\n===\n    <analysis>LITERAL</analysis>\n<analysis>SECRET</analysis>tail'
  ]
  for (const document of documents) {
    const lf = stripKnownModelScratchpadBlocksPreservingCodeFences(document)
    for (const endings of [['\r'], ['\r\n'], ['\n'], ['\r','\n','\r\n']]) {
      let i = 0
      const raw = document.replace(/\n/g, () => endings[i++ % endings.length])
      const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
      expect(expected.replace(/\r\n|\r/g, '\n')).toBe(lf)
      for (let split = 0; split <= raw.length; split++) checkDelivery(raw, [raw.slice(0, split), raw.slice(split)], expected)
      for (const size of [1, 2, 3, 5, 7, 20, raw.length])
        checkDelivery(
          raw,
          Array.from({ length: Math.ceil(raw.length / size) }, (_, k) => raw.slice(k * size, (k + 1) * size)),
          expected
        )
    }
  }
}, 60000)
