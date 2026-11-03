import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { codexAdapter } from '../codex'
import type { SessionRef } from '../types'

let root: string
const signal = () => new AbortController().signal
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cherry-codex-import-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const row = (type: string, payload: object, timestamp = '2026-01-01T00:00:00Z') => ({ type, payload, timestamp })
const meta = (id = 'thread', extra = {}) =>
  row('session_meta', { id, session_id: 'shared-root', cli_version: '0.114.0', ...extra })
const message = (text: string, role = 'user') =>
  row('response_item', {
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
  })
async function file(name: string, rows: unknown[]) {
  const p = path.join(root, name)
  await writeFile(p, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n'))
  return p
}
async function discover() {
  const refs: SessionRef[] = []
  for await (const ref of codexAdapter.discover(root, signal())) refs.push(ref)
  return refs
}

describe('Codex raw rollout contract', () => {
  it('uses the latest index name without importing mirrored events or source policy', async () => {
    await file('session_index.jsonl', [
      { id: 'thread', thread_name: 'old' },
      { id: 'thread', thread_name: 'latest' }
    ])
    await file('rollout-a.jsonl', [
      meta(),
      row('turn_context', { model: 'historic-model' }),
      message('source rules', 'developer'),
      row('event_msg', { type: 'user_message', message: 'question' }),
      message('question'),
      message('answer', 'assistant'),
      message('last user')
    ])
    const [ref] = await discover()
    const result = await codexAdapter.read(ref, signal())
    expect(result.title).toBe('latest')
    expect(result.messages.map((m) => m.data.parts)).toEqual(
      ['question', 'answer', 'last user'].map((text) => [{ type: 'text', text }])
    )
    expect(result.messages[1].messageSnapshot?.model.name).toBe('historic-model')
    expect(result.originalSessionId).toBe('thread')
  })
  it('discovers missing-index histories and keeps threads sharing a root separate', async () => {
    await file('rollout-a.jsonl', [meta('a'), message('a')])
    await file('rollout-b.jsonl', [meta('b'), message('b')])
    const results = await Promise.all((await discover()).map((ref) => codexAdapter.read(ref, signal())))
    expect(results.map((r) => r.originalSessionId).sort()).toEqual(['a', 'b'])
    expect(results.every((r) => r.messages.length === 1)).toBe(true)
  })
  it('changes the fingerprint if a missing index appears or a title changes', async () => {
    await file('rollout-a.jsonl', [meta(), message('text')])
    const [ref] = await discover()
    const before = await codexAdapter.read(ref, signal())
    await file('session_index.jsonl', [{ id: 'thread', thread_name: 'new' }])
    const after = await codexAdapter.read(ref, signal())
    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint)
    expect(after.title).toBe('new')
  })
  it.each([
    [meta('thread', { history_mode: 'paginated' }), message('partial')],
    [meta('thread', { history_base: { thread_id: 'parent', end_ordinal_exclusive: 4 } }), message('partial')],
    [meta(), row('compacted', { message: 'summary' }), message('partial')],
    [meta(), row('event_msg', { type: 'thread_rolled_back', num_turns: 1 }), message('partial')],
    [meta(), row('response_item', { type: 'reasoning', encrypted_content: 'secret', summary: [] }), message('partial')]
  ])('rejects history that cannot be reconstructed instead of silently losing context (%#)', async (...rows) => {
    const p = await file('rollout-a.jsonl', rows)
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
  it('rejects conflicting physical rollouts for one thread', async () => {
    await file('rollout-a.jsonl', [meta(), message('a')])
    await file('rollout-b.jsonl', [meta(), message('b')])
    const refs = await discover()
    expect(refs).toHaveLength(1)
    expect((await codexAdapter.read(refs[0], signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_history_layout', severity: 'error' })
    )
  })
  it('keeps tools inert and diagnoses bad lines and missing time', async () => {
    const p = await file('rollout-a.jsonl', [
      meta(),
      message('hi'),
      '{broken',
      row('response_item', {
        type: 'function_call',
        call_id: 'call',
        name: 'shell',
        arguments: '{"command":"do not execute"}'
      }),
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call', output: 'done' } }
    ])
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.messages).toHaveLength(3)
    expect(
      result.messages.slice(1).every((m) => m.role === 'system' && m.data.parts?.every((p) => p.type === 'text'))
    ).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['invalid_json', 'inferred_time']))
  })
})
