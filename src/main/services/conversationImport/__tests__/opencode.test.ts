import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { opencodeAdapter } from '../opencode'
import { IMPORT_LIMITS, type SessionRef } from '../types'

let root: string
let db: Database.Database
let file: string
const signal = () => new AbortController().signal
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cherry-opencode-import-'))
  vi.spyOn(application, 'getPath').mockReturnValue(path.join(root, 'scratch'))
  file = path.join(root, 'opencode.db')
  db = new Database(file)
})
afterEach(async () => {
  vi.restoreAllMocks()
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
  it('reads a checkpointed WAL database without creating any sidecars', async () => {
    db.pragma('journal_mode = WAL')
    schema()
    message('a', 0, 'user', { text: 'checkpointed' })
    db.close()
    const before = await readFile(file)
    expect(before[18]).toBe(2)
    expect(await readdir(root)).toEqual(['opencode.db'])
    const [ref] = await Array.fromAsync(opencodeAdapter.discover(root, signal()))
    expect((await opencodeAdapter.read(ref, signal())).messages[0].data.parts).toEqual([
      { type: 'text', text: 'checkpointed' }
    ])
    expect(await readdir(root)).toEqual(['opencode.db'])
    expect(await readFile(file)).toEqual(before)
  })
  it.each(['-wal', '-shm'])('rejects closed WAL with %s sidecar without writing source files', async (sidecar) => {
    db.pragma('journal_mode = WAL')
    schema(false)
    db.close()
    if (sidecar !== 'none') await writeFile(file + sidecar, '')
    const names = await readdir(root)
    const before = await Promise.all(names.map((name) => readFile(path.join(root, name))))
    await expect(Array.fromAsync(opencodeAdapter.discover(root, signal()))).rejects.toThrow('unsupported_readonly_wal')
    await expect(read()).rejects.toThrow('unsupported_readonly_wal')
    expect(await readdir(root)).toEqual(names)
    expect(await Promise.all(names.map((name) => readFile(path.join(root, name))))).toEqual(before)
  })
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
    expect(result.messages[1].messageSnapshot?.model?.name).toBe('historic')
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
  it('reads migrated v2 messages while preserving the original v1 version', async () => {
    schema(true, false)
    db.prepare('UPDATE session_v2 SET version = ?').run('1.2.0')
    message('user', 0, 'user', { text: 'migrated question' })
    message('assistant', 1, 'assistant', {
      content: [{ type: 'text', text: 'migrated answer' }],
      time: { completed: 1767225600000 }
    })
    const result = await read()
    expect(result.sourceVersion).toBe('1.2.0')
    expect(result.diagnostics).toEqual([])
    expect(result.messages.map((m) => ({ role: m.role, parts: m.data.parts }))).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'migrated question' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'migrated answer' }] }
    ])
  })
  it.each([true, false])('still rejects unknown versions in v2=%s layouts', async (v2) => {
    schema(v2)
    db.prepare('UPDATE ' + (v2 ? 'session_v2' : 'session') + ' SET version = ?').run('3.0.0')
    expect((await read()).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_version', severity: 'error' })
    )
  })
  it('discovers only sessions that have message rows', async () => {
    schema()
    db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, NULL, NULL, NULL)').run('ses_b', 'Second', '', '2.2.5')
    message('a', 0, 'user', { text: 'History' })
    const refs: SessionRef[] = []
    for await (const ref of opencodeAdapter.discover(root, signal())) refs.push(ref)
    expect(refs.map((r) => r.originalSessionId)).toEqual(['ses_a'])
    db.prepare('DELETE FROM session_message').run()
    expect((await read()).diagnostics).toContainEqual(expect.objectContaining({ code: 'empty_session' }))
  })
  it('rejects unknown database structures and never creates an absent source', async () => {
    db.exec('CREATE TABLE session_v2 (id TEXT)')
    await expect(read()).rejects.toThrow('unsupported_database_layout')
    await expect(
      opencodeAdapter.read({ path: path.join(root, 'absent.db'), originalSessionId: 'a' }, signal())
    ).rejects.toThrow()
  })
  it('reconciles copies across stores and keeps supported sessions beside an unknown layout', async () => {
    schema()
    message('a', 0, 'user', { text: 'original' })
    const next = path.join(root, 'opencode-next.db')
    await copyFile(file, next)
    const refs = await Array.fromAsync(opencodeAdapter.discover(root, signal()))
    expect(refs).toHaveLength(1)
    expect((await opencodeAdapter.read(refs[0], signal())).messages).toHaveLength(1)
    const other = new Database(next)
    try {
      other.prepare('UPDATE session_message SET data = ?').run(JSON.stringify({ text: 'different' }))
      await expect(opencodeAdapter.read(refs[0], signal())).rejects.toThrow('identity_conflict')
      other.exec('DROP TABLE session_v2; CREATE TABLE session(id TEXT)')
      const mixed = await Array.fromAsync(opencodeAdapter.discover(root, signal()))
      const good = mixed.find((ref) => ref.originalSessionId === 'ses_a')!
      expect((await opencodeAdapter.read(good, signal())).messages).toHaveLength(1)
      await expect(
        opencodeAdapter.read(
          mixed.find((ref) => ref.path === next)!,
          signal()
        )
      ).rejects.toThrow('unsupported_database_layout')
    } finally {
      other.close()
    }
  })
  it('keeps inherited v2 history from falling back to a populated legacy row', async () => {
    schema()
    schema(false)
    db.exec("INSERT INTO message VALUES ('a','ses_a',1,'{}')")
    db.exec("UPDATE session_v2 SET fork_session_id = 'parent'")
    const [ref] = await Array.fromAsync(opencodeAdapter.discover(root, signal()))
    expect((await opencodeAdapter.read(ref, signal())).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_history_layout', severity: 'error' })
    )
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
            attachments: [{ filename: 'output.png', url: 'data:image/png;base64,secret bytes' }],
            content: [{ type: 'text', text: 'old output' }]
          }
        }
      ]
    })
    const result = await read()
    expect(result.messages.flatMap((m) => m.data.parts ?? []).every((p) => p.type === 'text')).toBe(true)
    expect(JSON.stringify(result.messages)).not.toContain('secret bytes')
    expect(JSON.stringify(result.messages)).toContain('output.png')
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
    db.exec("INSERT INTO session_message VALUES ('c','ses_a','compaction',2,2,'{bad')")
    const result = await read()
    expect(result.messages).toHaveLength(1)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_json', path: file + '#bad' }),
        expect.objectContaining({ code: 'unsupported_compaction', severity: 'error' })
      ])
    )
  })
  it('checks and fingerprints the SQL part discriminator independently of its JSON', async () => {
    schema()
    message('a', 0, 'assistant', {})
    db.exec(`INSERT INTO session_part VALUES ('ses_a','a',0,'text','{"type":"text","text":"original"}')`)
    const before = await read()
    db.exec("UPDATE session_part SET type = 'compaction'")
    const after = await read()
    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint)
    expect(after.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported_compaction', severity: 'error' })
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
