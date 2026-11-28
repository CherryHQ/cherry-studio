import { mkdir, mkdtemp, writeFile, rm, readdir, realpath } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { codexAdapter } from '../codex'
import { queryReadonlyDatabase } from '../readonlySqlite'
import type { SessionRef } from '../types'

let root: string
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, lstat: vi.fn(actual.lstat), copyFile: vi.fn(actual.copyFile) }
})
const signal = () => new AbortController().signal
beforeEach(async () => {
  root = await mkdtemp(path.join(await realpath(tmpdir()), 'cherry-codex-import-'))
  vi.spyOn(application, 'getPath').mockImplementation((_key, filename) => path.join(root, 'scratch', filename ?? ''))
})
afterEach(async () => {
  vi.restoreAllMocks()
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
  it('omits only blank candidates with a blocking identity error', async () => {
    await file('session_index.jsonl', [{ id: 'named', thread_name: 'Named conflict' }])
    await file('rollout-blank.jsonl', [meta('blank'), meta('fork'), message('Ambiguous')])
    await file('rollout-named.jsonl', [meta('named'), meta('fork'), message('Ambiguous')])
    await file('rollout-valid.jsonl', [meta('valid'), message('Recovered title')])
    const refs = await discover()
    expect(refs.map((r) => r.title).sort()).toEqual(['Named conflict', 'Recovered title'])
    const named = refs.find((r) => r.originalSessionId === 'named')!
    expect((await codexAdapter.read(named, signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unstable_identity', severity: 'error' })
    )
  })
  it('keeps rollout candidates when the neighboring history database is unreadable', async () => {
    await writeFile(path.join(root, 'thread_history_1.sqlite'), 'damaged')
    await file('rollout-usable.jsonl', [meta('usable'), message('Keep this')])
    expect((await discover()).map((ref) => ref.originalSessionId)).toEqual(['usable'])
  })
  it('discovers checkpointed SQLite history once and rechecks only the selected thread', async () => {
    const dbPath = path.join(root, 'thread_history_1.sqlite')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(
      'CREATE TABLE thread_items(thread_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT)'
    )
    const insert = db.prepare('INSERT INTO thread_items VALUES(?, ?, ?, ?, ?)')
    const databaseId = '00000000-0000-4000-8000-000000000001'
    for (const thread of ['shared', 'blank-conflict', 'named-conflict', 'fork', databaseId]) {
      insert.run(thread, 'answer', 8, 1000, JSON.stringify({ type: 'agentMessage', text: 'Answer' }))
      insert.run(
        thread,
        'question',
        3,
        2000,
        JSON.stringify({ type: 'userMessage', content: [{ type: 'text', text: 'Question' }] })
      )
    }
    db.close()
    await file('rollout-shared.jsonl', [meta('shared'), message('In both')])
    await file('rollout-ambiguous.jsonl', [meta('blank-conflict'), meta('fork')])
    await file('rollout-named.jsonl', [meta('named-conflict'), meta('fork')])
    await file('session_index.jsonl', [{ id: 'named-conflict', thread_name: 'Ambiguous' }])
    const archive = path.join(root, 'rollout-2026-01-01T00-00-00-' + databaseId + '.jsonl.zst')
    await writeFile(
      archive,
      zstdCompressSync(JSON.stringify({ ...meta(databaseId, { history_mode: 'paginated' }), ordinal: 0 }) + '\n')
    )
    const refs = await discover()
    expect(refs.map((r) => r.originalSessionId).sort()).toEqual([databaseId, 'named-conflict', 'shared'])
    const ref = refs.find((r) => r.originalSessionId === databaseId)!
    expect(refs.filter((r) => r.path === dbPath)).toEqual([ref])
    const session = await codexAdapter.read(ref, signal())
    expect(session.messages.map((m) => [m.role, m.timestamp, m.data.parts])).toEqual([
      ['user', 2000, [{ type: 'text', text: 'Question' }]],
      ['assistant', 1000, [{ type: 'text', text: 'Answer' }]]
    ])
    expect(await readdir(root)).not.toContain('thread_history_1.sqlite-wal')
    const writer = new Database(dbPath)
    try {
      const edit = writer.prepare('UPDATE thread_items SET item_json=? WHERE thread_id=? AND item_id=?')
      const updated = JSON.stringify({ type: 'agentMessage', text: 'Updated' })
      edit.run(updated, 'shared', 'answer')
      expect((await codexAdapter.read(ref, signal())).sourceFingerprint).toBe(session.sourceFingerprint)
      edit.run(updated, databaseId, 'answer')
      expect((await codexAdapter.read(ref, signal())).sourceFingerprint).not.toBe(session.sourceFingerprint)
    } finally {
      writer.close()
    }
  })
  it('imports structured question replies as one user turn followed by the referenced answer', async () => {
    const replies = [
      { questionItemId: 'internal', question: 'Which file?', answer: 'first.md\nsecond.md' },
      { questionItemId: 'next', question: 'When?', answer: 'Now' }
    ]
    const p = await file('rollout-questions.jsonl', [
      meta(),
      message(
        '<send_user_message_question_reply>\n' + JSON.stringify(replies) + '\n</send_user_message_question_reply>'
      ),
      message('Done\n\n[Historical references]\n\nfirst.md:1-2 — files', 'assistant')
    ])
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.messages.map(({ role, data }) => [role, data.parts])).toEqual([
      ['user', [{ type: 'text', text: '> Which file?\n\nfirst.md\nsecond.md\n\n> When?\n\nNow' }]],
      ['assistant', [{ type: 'text', text: 'Done\n\n**References**\n\n- first.md:1-2 — files' }]]
    ])
  })
  it('includes WAL commits made while the main database is being copied', async () => {
    const file = path.join(root, 'active.sqlite')
    const writer = new Database(file)
    try {
      writer.pragma('journal_mode = WAL')
      writer.pragma('wal_autocheckpoint = 0')
      writer.exec('CREATE TABLE items(value); INSERT INTO items VALUES (1)')
      const actual = await vi.importActual<typeof fs>('node:fs/promises')
      vi.spyOn(fs, 'copyFile').mockImplementation(async (src, dest, mode) => {
        await actual.copyFile(src, dest, mode)
        if (src === file) writer.exec('INSERT INTO items VALUES (2)')
      })
      expect(
        await queryReadonlyDatabase(file, (db) => db.prepare('SELECT sum(value) AS total FROM items').get()?.total)
      ).toBe(3)
    } finally {
      writer.close()
    }
  })
  it('never recreates source sidecars if the last Codex writer closes before SQLite opens', async () => {
    const file = path.join(root, 'race.sqlite')
    const writer = new Database(file)
    try {
      writer.pragma('journal_mode = WAL')
      writer.exec('CREATE TABLE items(value); INSERT INTO items VALUES (42)')
      const actual = await vi.importActual<typeof fs>('node:fs/promises')
      const stat = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
        const info = await actual.lstat(...args)
        if (args[0] === file + '-shm' && writer.open) writer.close()
        return info
      })
      const read = () => queryReadonlyDatabase(file, (db) => db.prepare('SELECT value FROM items').get()?.value)
      try {
        expect(await read()).toBe(42)
      } catch (err) {
        expect((err as Error).message).toMatch(/source_changed|unsupported_readonly_wal/)
      }
      expect(writer.open).toBe(false)
      stat.mockRestore()
      expect(await read()).toBe(42)
      expect((await readdir(root)).filter((f) => f === 'race.sqlite-wal' || f === 'race.sqlite-shm')).toEqual([])
    } finally {
      if (writer.open) writer.close()
    }
  })
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
    expect(result.messages[1].messageSnapshot?.model?.name).toBe('historic-model')
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
    [
      meta(),
      row('response_item', { type: 'message', role: 'assistant', encrypted_content: 'secret', content: [] }),
      message('partial')
    ]
  ])('rejects history that cannot be reconstructed instead of silently losing context (%#)', async (...rows) => {
    const p = await file('rollout-a.jsonl', rows)
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
  it('rejects conflicting physical rollouts for one thread', async () => {
    await file('rollout-a.jsonl', [row('event_msg', { type: 'prelude' }), meta(), message('a')])
    await file('rollout-b.jsonl', [meta(), message('b')])
    const refs = await discover()
    expect(refs).toHaveLength(1)
    expect((await codexAdapter.read(refs[0], signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_history_layout', severity: 'error' })
    )
  })
  it('limits automatic scans to active and archived sessions and accepts an unspecified provider', async () => {
    for (const dir of ['sessions', 'archived_sessions', 'tmp']) {
      await mkdir(path.join(root, dir))
      await file(dir + '/rollout-a.jsonl', [
        meta(dir, { model_provider: null }),
        row('turn_context', { model: 'm' }),
        message('Hello', 'assistant')
      ])
    }
    expect(await discover()).toHaveLength(3)
    vi.mocked(application.getPath).mockReturnValue(root)
    const refs = await discover()
    expect(refs.map((r) => r.originalSessionId).sort()).toEqual(['archived_sessions', 'sessions'])
    expect((await codexAdapter.read(refs[0], signal())).messages[0].messageSnapshot?.model?.provider).toBe('openai')
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
    expect(result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.code)).toEqual(
      expect.arrayContaining(['invalid_json', 'inferred_time'])
    )
  })
  it('shows the first user sentence when the title index has no entry', async () => {
    await file('rollout-untitled.jsonl', [meta(), message('Explain this project'), message('answer', 'assistant')])
    const [ref] = await discover()
    expect(ref.title).toBe('Explain this project')
    expect((await codexAdapter.read(ref, signal())).title).toBe('Explain this project')
  })
  it('imports a complete paginated rollout with contiguous source ordinals', async () => {
    const rows = [
      meta('thread', { history_mode: 'paginated', cli_version: '0.154.0-alpha.6.2' }),
      message('question'),
      message('answer', 'assistant')
    ].map((entry, ordinal) => ({ ...entry, ordinal }))
    const p = await file('rollout-paginated.jsonl', rows)
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.messages.map((m) => m.data.parts)).toEqual([
      [{ type: 'text', text: 'question' }],
      [{ type: 'text', text: 'answer' }]
    ])
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false)
  })
  it('rejects a paginated fragment with missing ordinals', async () => {
    const p = await file('rollout-fragment.jsonl', [
      { ...meta('thread', { history_mode: 'paginated' }), ordinal: 0 },
      { ...message('fragment'), ordinal: 2 }
    ])
    expect((await codexAdapter.read({ path: p }, signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_history_order', severity: 'error' })
    )
  })
  it('reports opaque reasoning as a downgrade while preserving visible conversation text', async () => {
    const p = await file('rollout-reasoning.jsonl', [
      meta(),
      message('question'),
      row('response_item', { type: 'reasoning', encrypted_content: 'opaque', summary: [] }),
      message('answer', 'assistant')
    ])
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.messages).toHaveLength(2)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_encrypted_history', severity: 'warning' })
    )
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false)
    expect(result.downgradedParts).toBe(1)
    expect(JSON.stringify(result.messages)).not.toContain('opaque')
  })
  it('does not treat generated environment context as the first user request', async () => {
    const p = await file('rollout-context.jsonl', [
      meta(),
      message('# AGENTS.md instructions\n\n<INSTRUCTIONS>Project notes</INSTRUCTIONS>'),
      message('<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>'),
      message('<environment_context><cwd>D:/project</cwd><shell>powershell</shell></environment_context>'),
      message('Read the handoff'),
      row('response_item', {
        type: 'custom_tool_call_output',
        output: [
          { type: 'input_text', text: JSON.stringify({ chunk_id: 'chunk', exit_code: 0, output: 'first\nsecond' }) }
        ]
      })
    ])
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.title).toBe('Read the handoff')
    expect(result.messages.slice(0, 3).map((message) => message.role)).toEqual(['system', 'system', 'system'])
    expect(result.messages.map((message) => message.provenance.isSetup)).toEqual([
      true,
      true,
      true,
      undefined,
      undefined
    ])
    expect(result.messages[2].data.parts).toEqual([
      { type: 'text', text: expect.stringContaining('[Historical environment]') }
    ])
    expect(result.messages[4].role).toBe('system')
    expect(result.messages[4].data.parts).toEqual([{ type: 'text', text: expect.stringContaining('first\nsecond') }])
  })
  it('preserves a request in the same text block as context before a later user turn', async () => {
    const mixed = '<environment_context><cwd>D:/project</cwd></environment_context>\nPlease fix the login failure.'
    const p = await file('rollout-mixed.jsonl', [
      meta(),
      message(mixed),
      message('First answer', 'assistant'),
      message('Later question')
    ])
    const result = await codexAdapter.read({ path: p }, signal())
    expect(result.diagnostics).toEqual([])
    expect(result.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user'])
    expect(result.messages[0].data.parts).toEqual([{ type: 'text', text: mixed }])
    expect(result.title).toContain('Please fix the login failure.')
  })
  it('filters Guardian by versioned origin even after rename, not by title or ordinary subagent status', async () => {
    const guardian = { cli_version: '0.164.0-alpha.11.1', source: { subagent: { other: 'guardian' } } }
    await file('rollout-guardian.jsonl', [meta('g', guardian), message('synthetic approval request')])
    await file('session_index.jsonl', [{ id: 'g', thread_name: 'Renamed review' }])
    expect((await discover())[0].filteredReason).toBe('codex_guardian_review')
    for (const extra of [
      {},
      { source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } },
      { ...guardian, cli_version: '0.999.0' }
    ]) {
      const p = await file('rollout-normal.jsonl', [meta('normal', extra), message('Guardian review')])
      expect((await codexAdapter.read({ path: p }, signal())).filteredReason).toBeUndefined()
    }
  })
  it('does not hide conflicting Guardian copies or malformed and incomplete rollouts', async () => {
    const guardian = meta('thread', { cli_version: '0.164.0-alpha.11.1', source: { subagent: { other: 'guardian' } } })
    const repeated = row('response_item', { ...message('same').payload, id: 'duplicate' })
    const duplicate = await file('rollout-duplicate.jsonl', [
      { ...guardian, payload: { ...guardian.payload, id: 'duplicate-thread' } },
      repeated,
      repeated
    ])
    const duplicateRef = (await discover()).find((r) => r.path === duplicate)!
    expect(duplicateRef.filteredReason).toBeUndefined()
    expect((await codexAdapter.read(duplicateRef, signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate_message_id', severity: 'error' })
    )
    await file('rollout-a.jsonl', [guardian, message('review')])
    await file('rollout-b.jsonl', [meta(), message('real user task')])
    const ref = (await discover()).find((r) => r.originalSessionId === 'thread')!
    expect(ref.filteredReason).toBeUndefined()
    expect((await codexAdapter.read(ref, signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_history_layout' })
    )
    const p = await file('rollout-malformed.jsonl', [guardian, '{broken'])
    expect((await codexAdapter.read({ path: p }, signal())).filteredReason).toBeUndefined()
    const fragment = await file('rollout-fragment.jsonl', [
      { ...guardian, ordinal: 0, payload: { ...guardian.payload, history_mode: 'paginated' } },
      { ...message('review'), ordinal: 2 }
    ])
    expect((await codexAdapter.read({ path: fragment }, signal())).filteredReason).toBeUndefined()
  })
})
