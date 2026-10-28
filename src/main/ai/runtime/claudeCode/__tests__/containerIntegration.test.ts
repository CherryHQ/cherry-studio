import { expect, it, vi } from 'vitest'

import disputedCases from '../../../../../../../packages/aiCore/src/core/context/__tests__/containerEvents/disputed-cases.json'
import agreedCases from '../../../../../../../packages/aiCore/src/core/context/__tests__/containerEvents/dual-oracle-cases.json'
import transitionCases from '../../../../../../../packages/aiCore/src/core/context/__tests__/containerEvents/transition84.json'
import quoteCases from '../../../../../../packages/aiCore/src/core/context/__tests__/r24QuoteOwnership.json'

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
it('empty item blank literal', () => {
  const raw = '-\n\n    <thinking>literal XML</thinking>\n'
  for (const size of [1, 5, raw.length]) {
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
})
it('sealed fence handoff controls preserve stop and completed snapshots', () => {
  const cases = [
    '- \n  -\n\n    <thinking>SECRET</thinking>\n',
    '```xml\n<item>literal</item>\n```\n<analysis>SECRET</analysis>tail',
    '````xml\n```\n<thinking>literal</thinking>\n````\n<analysis>SECRET</analysis>tail',
    '```\r\n<thinking>literal</thinking>\r\n```\r\n<analysis>SECRET</analysis>tail',
    '```\ncontent\n',
    '```xml\n<item>literal</item>\r\n```\r\n<analysis>SECRET</analysis>tail',
    '```\n<analysis>literal</analysis>\n```\n\n- item <analysis>SECRET</analysis> tail',
    '```\nfirst\n```\n\n````\n<analysis>literal2</analysis>\n````\n<analysis>SECRET</analysis>tail',
    '```<analysis>SECRET</analysis>```',
    '- item alpha\n<script>var a = 1</script>\n\n<script>var a = 1</script>\n\n```\nx <analysis>HID</analysis> y\n```\n\nplain paragraph\n- item <analysis>HID</analysis> tail\n',
    '- ```\n  ```\n    <analysis>SECRET</analysis>\n',
    '- ```\n    ```\n\n    <analysis>SECRET</analysis>\n'
  ]
  for (const raw of cases) {
    const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
    for (const size of [1, 2, 3, 5, 7, 20, raw.length]) {
      const s = setup()
      for (let i = 0; i < raw.length; i += size) {
        s.push(raw.slice(i, i + size))
        expect(expected.startsWith(s.text()), JSON.stringify({ raw, size, i, out: s.text(), expected })).toBe(true)
      }
      s.stop()
      expect(s.text(), JSON.stringify({ raw, size })).toBe(expected)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text(), JSON.stringify({ raw, size, snapshot: true })).toBe(expected)
    }
  }
})

it('quoted bare marker fragmented privacy and literal code', () => {
  for (const { raw, code } of quoteCases) {
    const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
    expect(expected.includes('MARK'), JSON.stringify({ raw, code })).toBe(code)
    for (const size of [1, 2, 3, 5, 7, 20, raw.length]) {
      const s = setup()
      for (let i = 0; i < raw.length; i += size) {
        s.push(raw.slice(i, i + size))
        expect(expected.startsWith(s.text()), JSON.stringify({ raw, size, i, out: s.text(), expected })).toBe(true)
      }
      s.stop()
      expect(s.text(), JSON.stringify({ raw, size })).toBe(expected)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text(), JSON.stringify({ raw, size, snapshot: true })).toBe(expected)
    }
  }
})

it('shared-event actual adapter frozen matrices', () => {
  for (const row of [...agreedCases, ...disputedCases, ...transitionCases]) {
    const { raw } = row
    const want = 'want' in row ? row.want : row.commonmark
    const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
    expect(expected.includes('MARK'), JSON.stringify({ raw, want })).toBe(want)
    for (const size of [1, 3, 20, raw.length]) {
      const s = setup()
      for (let i = 0; i < raw.length; i += size) {
        s.push(raw.slice(i, i + size))
        expect(expected.startsWith(s.text()), JSON.stringify({ raw, size, i, out: s.text(), expected })).toBe(true)
      }
      s.stop()
      expect(s.text(), JSON.stringify({ raw, size })).toBe(expected)
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      expect(s.text(), JSON.stringify({ raw, size, snapshot: true })).toBe(expected)
    }
  }
}, 60000)
it('ordinary fenced XML work', () => {
  const work: number[] = []
  for (const count of [1000, 2000]) {
    const raw = '```xml\n' + '<item>content</item>\n'.repeat(count) + '```'
    const s = setup()
    const t = performance.now()
    for (let i = 0; i < raw.length; i += 20) s.push(raw.slice(i, i + 20))
    s.stop()
    console.log(
      'PERF',
      JSON.stringify({ count, chars: raw.length, ms: performance.now() - t, scan: s.a.scratchpadScanInputChars })
    )
    expect(s.text()).toBe(raw)
    work.push(s.a.scratchpadScanInputChars)
  }
  expect(work[1]).toBeLessThan(work[0] * 2.2)
  expect(work[1]).toBeLessThan(42010 * 4)
})

import { writeFileSync } from 'node:fs'

import residuals from './containerResidual.json'
it('frozen malformed compatibility evidence', () => {
  const rows = []
  for (const raw of residuals) {
    for (const size of [1, 2, 3, 5, 7, raw.length]) {
      const s = setup()
      const seen: string[] = []
      for (let i = 0; i < raw.length; i += size) {
        s.push(raw.slice(i, i + size))
        seen.push(s.text())
      }
      s.stop()
      const stop = s.text()
      s.a.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 's',
        uuid: crypto.randomUUID(),
        message: { role: 'assistant', content: [{ type: 'text', text: raw }] }
      } as any)
      rows.push({
        raw,
        size,
        whole: stripKnownModelScratchpadBlocksPreservingCodeFences(raw),
        stop,
        snapshot: s.text(),
        retract: seen.some((t) => !s.text().startsWith(t)),
        prefixViolation: s.a.scratchpadPrefixViolation
      })
    }
  }
  writeFileSync('/tmp/container-residual-evidence.json', JSON.stringify(rows))
})
it('shape-specific scaling evidence', () => {
  const rows = []
  for (const count of [1000, 2000])
    for (const [shape, raw] of Object.entries({
      crlf: '```xml\r\n' + '<item>content</item>\r\n'.repeat(count) + '```',
      list: '- ```xml\n' + '  <item>content</item>\n'.repeat(count) + '  ```',
      quote: '> ```xml\n' + '> <item>content</item>\n'.repeat(count) + '> ```',
      ownedLong: '-\n    > ' + 'x'.repeat(count * 20) + '\n'
    })) {
      const s = setup()
      const t = performance.now()
      for (let i = 0; i < raw.length; i += 20) s.push(raw.slice(i, i + 20))
      s.stop()
      rows.push({
        shape,
        count,
        chars: raw.length,
        scan: s.a.scratchpadScanInputChars,
        carry: s.a.scratchpadCarryWorkChars,
        whole: s.a.scratchpadWholeSliceChars,
        ms: performance.now() - t,
        exact: s.text() === raw
      })
    }
  writeFileSync('/tmp/container-scaling.json', JSON.stringify(rows))
  console.log('SCALING', JSON.stringify(rows))
}, 60000)
