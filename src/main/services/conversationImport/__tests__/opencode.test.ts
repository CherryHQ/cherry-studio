import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { opencodeAdapter } from '../opencode'
import { IMPORT_LIMITS, type SessionRef } from '../types'

let root: string
let db: Database.Database
let file: string
const signal = () => new AbortController().signal
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cherry-opencode-import-'))
  file = path.join(root, 'opencode.db')
  db = new Database(file)
})
afterEach(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})
// These are external source tables, not a replacement for Cherry's production migrations.
function schema(v2 = true, parts = true) {
  if (v2) {
    db.exec(`CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT, directory TEXT, version TEXT, revert TEXT, fork_session_id TEXT, fork_boundary TEXT);
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT);`)
    if (parts)
      db.exec('CREATE TABLE session_part (session_id TEXT, message_id TEXT, ordinal INTEGER, type TEXT, data TEXT)')
    db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, NULL, NULL, NULL)').run('ses_a', 'History', '', '2.2.5')
  } else {
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, version TEXT, revert TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);`)
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, NULL)').run('ses_a', 'Legacy', '', '1.2.0')
  }
}
function message(id: string, seq: number, type: string, data: object, time = 1767225600000) {
  db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    'ses_a',
    type,
    seq,
    time,
    JSON.stringify(data)
  )
}
async function read() {
  return opencodeAdapter.read({ path: file, originalSessionId: 'ses_a' }, signal())
}
async function fingerprintFiles() {
  return Promise.all(
    [file, file + '-wal'].map(async (p) =>
      createHash('sha256')
        .update(await readFile(p))
        .digest('hex')
    )
  )
}

describe('OpenCode read-only source snapshots', () => {
  it('reads committed WAL data and leaves source DB/WAL bytes unchanged', async () => {
    db.pragma('journal_mode = WAL')
    db.pragma('wal_autocheckpoint = 0')
    schema()
    message('msg_z', 0, 'user', { text: 'question' })
    message('msg_a', 1, 'assistant', {
      content: [],
      model: { id: 'historic', providerID: 'provider' },
      time: { completed: 1767225600000 }
    })
    db.prepare('INSERT INTO session_part VALUES (?, ?, ?, ?, ?)').run(
      'ses_a',
      'msg_a',
      1,
      'text',
      JSON.stringify({ type: 'text', text: 'second' })
    )
    db.prepare('INSERT INTO session_part VALUES (?, ?, ?, ?, ?)').run(
      'ses_a',
      'msg_a',
      0,
      'text',
      JSON.stringify({ type: 'text', text: 'first' })
    )
    const before = await fingerprintFiles()
    const result = await read()
    expect(result.messages.map((m) => m.provenance.originalMessageId)).toEqual(['msg_z', 'msg_a'])
    expect(result.messages[1].data.parts).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' }
    ])
    expect(result.messages[1].messageSnapshot?.model.name).toBe('historic')
    expect(await fingerprintFiles()).toEqual(before)
    message('msg_tail', 2, 'user', { text: 'new committed message' })
    expect((await read()).sourceFingerprint).not.toBe(result.sourceFingerprint)
  })
  it('reads legacy message and part rows without inventing a directory', async () => {
    schema(false)
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
      'msg_user',
      'ses_a',
      1767225600000,
      JSON.stringify({ role: 'user' })
    )
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run(
      'part_a',
      'msg_user',
      'ses_a',
      JSON.stringify({ type: 'text', text: 'legacy' })
    )
    const result = await read()
    expect(result.workingDirectory).toBeUndefined()
    expect(result.messages[0].data.parts).toEqual([{ type: 'text', text: 'legacy' }])
    expect(result.diagnostics).toEqual([])
  })
  it('reads inline v2 bodies and never joins duplicate part bodies', async () => {
    schema()
    message('msg_a', 0, 'assistant', { content: [{ type: 'text', text: 'stale inline' }] })
    db.prepare('INSERT INTO session_part VALUES (?, ?, ?, ?, ?)').run(
      'ses_a',
      'msg_a',
      0,
      'text',
      JSON.stringify({ type: 'text', text: 'current part' })
    )
    expect((await read()).messages[0].data.parts).toEqual([{ type: 'text', text: 'current part' }])
  })
  it('supports v2 inline layout without the optional parts table', async () => {
    schema(true, false)
    message('msg_a', 0, 'assistant', { content: [{ type: 'text', text: 'inline' }] })
    expect((await read()).messages[0].data.parts).toEqual([{ type: 'text', text: 'inline' }])
  })
  it('discovers independent source sessions', async () => {
    schema()
    db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, NULL, NULL, NULL)').run('ses_b', 'Second', '', '2.2.5')
    const refs: SessionRef[] = []
    for await (const ref of opencodeAdapter.discover(root, signal())) refs.push(ref)
    expect(refs.map((r) => r.originalSessionId)).toEqual(['ses_a', 'ses_b'])
  })
  it('rejects unknown database structures and never creates an absent source', async () => {
    db.exec('CREATE TABLE session_v2 (id TEXT)')
    await expect(read()).rejects.toThrow('unsupported_database_layout')
    await expect(
      opencodeAdapter.read({ path: path.join(root, 'absent.db'), originalSessionId: 'a' }, signal())
    ).rejects.toThrow()
  })
  it('rejects ambiguous source ordering, revert and inherited forks', async () => {
    schema()
    message('a', 0, 'user', { text: 'first' })
    message('b', 1, 'user', { text: 'backwards' }, 1767225599000)
    db.prepare('UPDATE session_v2 SET revert = ?, fork_session_id = ?').run('{}', 'parent')
    expect((await read()).diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['unsupported_history_layout', 'timestamp_order'])
    )
  })
  it('does not execute tool history or embed attachment bytes', async () => {
    schema()
    message('a', 0, 'user', {
      text: 'file',
      files: [{ uri: 'media:sha256' }, { data: 'secret bytes', name: 'image.png' }]
    })
    message('b', 1, 'assistant', {
      content: [
        {
          type: 'tool',
          name: 'shell',
          state: {
            status: 'completed',
            input: { command: 'do not execute' },
            content: [{ type: 'text', text: 'old output' }]
          }
        }
      ]
    })
    const result = await read()
    expect(result.messages.flatMap((m) => m.data.parts ?? []).every((p) => p.type === 'text')).toBe(true)
    expect(JSON.stringify(result.messages)).not.toContain('secret bytes')
    expect(result.downgradedParts).toBe(3)
  })
  it('reports bad JSON by record and blocks compression it cannot reconstruct', async () => {
    schema()
    message('a', 0, 'user', { text: 'valid' })
    db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(
      'bad',
      'ses_a',
      'user',
      1,
      1767225600000,
      '{bad'
    )
    message('c', 2, 'compaction', { summary: 'partial' })
    const result = await read()
    expect(result.messages).toHaveLength(1)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_json', path: file + '#bad' }),
        expect.objectContaining({ code: 'unsupported_compaction', severity: 'error' })
      ])
    )
  })
  it('rejects oversized records before reading their JSON bodies', async () => {
    schema()
    message('a', 0, 'user', { text: 'x'.repeat(IMPORT_LIMITS.line) })
    await expect(read()).rejects.toThrow('line_limit')
  })
  it('uses the first user sentence when the source title is absent', async () => {
    schema()
    db.prepare('UPDATE session_v2 SET title = NULL').run()
    message('user', 0, 'user', { text: 'Explain my project' })
    const refs: SessionRef[] = []
    for await (const ref of opencodeAdapter.discover(root, signal())) refs.push(ref)
    expect(refs[0].title).toBe('Explain my project')
    expect((await read()).title).toBe('Explain my project')
  })
})
