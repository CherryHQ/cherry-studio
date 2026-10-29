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

import { summarizeHistory } from '../../../../../../packages/aiCore/src/core/context/janitor'
import { ContextPrompts } from '../../../../../../packages/aiCore/src/core/context/prompts'
import paddingCases from './r28PaddingCases.json'
it('preserves exact surplus padding ownership through formatter, janitor and stream', async () => {
  for (const { raw: lf, code } of paddingCases) {
    for (const nl of ['\n', '\r\n', '\r']) {
      const raw = lf.replace(/\n/g, nl)
      const expected = stripKnownModelScratchpadBlocksPreservingCodeFences(raw)
      expect(expected.includes('SECRET'), raw).toBe(code)
      expect(ContextPrompts.formatCompactSummary(raw).includes('SECRET'), raw).toBe(code)
      expect(
        (await summarizeHistory([{ role: 'user', content: 'hello' }], async () => raw)).includes('SECRET'),
        raw
      ).toBe(code)
      for (const size of [1, 3, raw.length])
        checkDelivery(
          raw,
          Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size)),
          expected
        )
    }
  }
}, 60000)
it('only a genuine main prompt changes main compaction provenance', () => {
  const artifact =
    '<analysis>Internal review.</analysis>\n<summary>\n1. Task Overview:\n   Maintain the team wiki.\n\n2. Current State:\n   - Drafted three pages\n</summary>'
  for (const control of ['none', 'child', 'main', 'syntheticChild', 'childToolResult'])
    for (const streamed of [false, true]) {
      const s = setup()
      const assistant = (text: string, parent: string | null = null) =>
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: parent,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text }] }
        })
      assistant('Answered.')
      s.a.handleMessage({
        type: 'system',
        subtype: 'status',
        session_id: 's',
        uuid: crypto.randomUUID(),
        status: 'compacting'
      })
      s.a.handleMessage({
        type: 'system',
        subtype: 'status',
        session_id: 's',
        uuid: crypto.randomUUID(),
        compact_result: 'success'
      })
      if (control !== 'none')
        s.a.handleMessage({
          type: 'user',
          parent_tool_use_id: control === 'main' ? null : 'child-tool',
          isSynthetic: control === 'syntheticChild',
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: {
            role: 'user',
            content:
              control === 'childToolResult'
                ? [{ type: 'tool_result', tool_use_id: 'inner-tool', content: 'result' }]
                : [
                    {
                      type: 'text',
                      text:
                        control === 'syntheticChild'
                          ? '<system-reminder>Child reminder</system-reminder>'
                          : 'Summarize where we are.'
                    }
                  ]
          }
        })
      const start = s.text().length
      if (streamed) {
        s.a.handleMessage(ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
        for (let i = 0; i < artifact.length; i += 3)
          s.a.handleMessage(
            ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: artifact.slice(i, i + 3) } })
          )
        s.a.handleMessage(ev({ type: 'content_block_stop', index: 1 }))
      } else assistant(artifact)
      s.a.finalizeOpenTextParts()
      expect(s.text().slice(start).includes('Task Overview'), control + streamed).toBe(control === 'main')
      expect(s.text().slice(start)).not.toContain('Internal review.')
      if (control === 'syntheticChild')
        expect(s.a.flowContexts[0].stream.systemReminderBodies.has('Child reminder')).toBe(true)
      if (control === 'childToolResult')
        expect(s.a.flowContexts[0].stream.toolResultsEmitted.has('inner-tool')).toBe(true)
      const beforeChild = s.text().length
      assistant('Child visible answer.', 'child-tool')
      expect(s.text().slice(beforeChild)).toContain('Child visible answer.')
    }
})

it('child assistant emissions cannot end main compaction grace', () => {
  const artifact =
    '<analysis>INTERNAL</analysis>\n<summary>\n1. Task Overview:\nWiki\n\n2. Current State:\npages\n</summary>'
  for (const child of ['none', 'snapshot', 'stream', 'deferredStop', 'empty', 'summary'])
    for (const main of ['snapshot', 'stream']) {
      const s = setup()
      const assistant = (text: string, parent: string | null = null) =>
        s.a.handleMessage({
          type: 'assistant',
          parent_tool_use_id: parent,
          session_id: 's',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [{ type: 'text', text }] }
        })
      assistant('Answered.')
      s.a.handleMessage({
        type: 'system',
        subtype: 'status',
        session_id: 's',
        uuid: crypto.randomUUID(),
        status: 'compacting'
      })
      s.a.handleMessage({
        type: 'system',
        subtype: 'status',
        session_id: 's',
        uuid: crypto.randomUUID(),
        compact_result: 'success'
      })
      const childStart = s.text().length
      if (child === 'snapshot' || child === 'empty' || child === 'summary')
        assistant(child === 'empty' ? '' : child === 'summary' ? artifact : 'Child healthy.', 'c1')
      if (child === 'stream' || child === 'deferredStop') {
        const send = (event: any) => s.a.handleMessage({ ...ev(event), parent_tool_use_id: 'c1' })
        send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        send({
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: child === 'stream' ? 'Child healthy.' : '<analysis>Child literal</analysis>'
          }
        })
        send({ type: 'content_block_stop', index: 0 })
      }
      if (child === 'summary') expect(s.text().slice(childStart)).toBe(artifact)
      if (child === 'deferredStop') expect(s.text().slice(childStart)).toBe('<analysis>Child literal</analysis>')
      if (child === 'snapshot' || child === 'stream') expect(s.text().slice(childStart)).toBe('Child healthy.')
      expect(s.a.compactionArtifactGrace, child + main).toBe(true)
      const start = s.text().length
      if (main === 'snapshot') assistant(artifact)
      else {
        s.a.handleMessage(ev({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }))
        for (let i = 0; i < artifact.length; i += 3)
          s.a.handleMessage(
            ev({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: artifact.slice(i, i + 3) } })
          )
        s.a.handleMessage(ev({ type: 'content_block_stop', index: 2 }))
      }
      s.a.finalizeOpenTextParts()
      expect(s.text().slice(start), child + main).toBe('')
    }
})
