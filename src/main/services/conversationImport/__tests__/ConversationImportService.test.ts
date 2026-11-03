import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase, replayMigration } from '@test-helpers/db'
import { createTestSession, scriptedModel, textParts, finish, gatewayModel } from '@test-helpers/piGateway'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { snapshotTo } from '@data/db/restore/snapshot'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable, AGENT_SESSION_IMPORT_STATEMENTS } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { getImportedHistoryState } from '@data/services/importedSessionHistory'
import { ensureImportedSessionHistory } from '@main/ai/runtime/pi/importedSessionHistory'
import * as piSdk from '@main/ai/runtime/pi/piSdk'
import { BaseService } from '@main/core/lifecycle'

import { ConversationImportService } from '../ConversationImportService'

describe('local history atomic import', () => {
  const dbh = setupTestDatabase()
  let root: string
  let service: ConversationImportService
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-history-db-'))
    await mkdir(path.join(root, 'source'))
    vi.mocked(application.getPath).mockImplementation((key, filename) => path.join(root, key, filename ?? ''))
    BaseService.resetInstances()
    service = new ConversationImportService()
    dbh.db
      .insert(agentTable)
      .values([
        { id: 'pi', type: 'pi', name: 'Same name', instructions: 'Keep these instructions', orderKey: 'a0' },
        { id: 'other', type: 'pi', name: 'Same name', instructions: 'Other instructions', orderKey: 'a1' },
        { id: 'claude', type: 'claude-code', name: 'Claude target', instructions: '', orderKey: 'a2' }
      ])
      .run()
  })
  afterEach(async () => {
    service.cancel('window')
    service.cancel('other-window')
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  async function source(id = 'source', timestamps = ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'], cwd?: string) {
    const file = path.join(root, 'source', id + '.jsonl')
    await writeFile(
      file,
      timestamps
        .map((timestamp, index) =>
          JSON.stringify({
            type: index === 1 ? 'assistant' : 'user',
            uuid: id + index,
            parentUuid: index ? id + (index - 1) : null,
            sessionId: id,
            version: '2.1.284',
            timestamp,
            cwd,
            message: {
              content: 'Message ' + index,
              ...(index === 1 ? { model: 'history-model', stop_reason: 'end_turn' } : {})
            }
          })
        )
        .join('\n')
    )
    return file
  }
  async function preview(target = 'pi', owner = 'window') {
    const scan = await service.discover(owner, 'claude-code', path.join(root, 'source'))
    const result = await service.preview(
      owner,
      scan.scanId,
      target,
      scan.candidates.map((c) => ({ ref: c.ref }))
    )
    return { ...result, scan }
  }
  it('imports Codex threads independently and rejects an index changed after preview', async () => {
    const sourceRoot = path.join(root, 'source')
    for (const id of ['one', 'two'])
      await writeFile(
        path.join(sourceRoot, 'rollout-' + id + '.jsonl'),
        [
          { type: 'session_meta', payload: { id, session_id: 'root', cli_version: '0.114.0' } },
          {
            type: 'response_item',
            timestamp: '2026-01-01T00:00:00Z',
            payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: id }] }
          }
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')
      )
    const scan = await service.discover('window', 'codex', sourceRoot)
    const before = counts()
    const prepared = await service.preview(
      'window',
      scan.scanId,
      'pi',
      scan.candidates.map((c) => ({ ref: c.ref }))
    )
    expect(counts()).toEqual(before)
    expect(prepared.items.every((item) => item.diagnostics.length === 0)).toBe(true)
    const outcomes = await service.commit(
      'window',
      prepared.previewId,
      prepared.items.map((item) => item.ref)
    )
    expect(outcomes.map((item) => item.status)).toEqual(['imported', 'imported'])
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .map((row) => row.importMetadata?.originalSessionId)
        .sort()
    ).toEqual(['one', 'two'])
    const next = await service.discover('window', 'codex', sourceRoot)
    const preview = await service.preview(
      'window',
      next.scanId,
      'pi',
      next.candidates.map((c) => ({ ref: c.ref }))
    )
    await writeFile(path.join(sourceRoot, 'session_index.jsonl'), JSON.stringify({ id: 'one', thread_name: 'changed' }))
    expect(
      (
        await service.commit(
          'window',
          preview.previewId,
          preview.items.map((item) => item.ref)
        )
      ).every((item) => item.reason === 'source_changed')
    ).toBe(true)
  })
  it('imports OpenCode from a read-only database snapshot and rechecks changed rows', async () => {
    const sourceRoot = path.join(root, 'source')
    const external = new Database(path.join(sourceRoot, 'opencode.db'))
    try {
      external.exec(
        'CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT, directory TEXT, version TEXT, revert TEXT, fork_session_id TEXT, fork_boundary TEXT); CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT);'
      )
      external
        .prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, NULL, NULL, NULL)')
        .run('external', 'OpenCode import', '', '2.2.5')
      external
        .prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)')
        .run('message', 'external', 'user', 0, 1767225600000, JSON.stringify({ text: 'original' }))
      const scan = await service.discover('window', 'opencode', sourceRoot)
      const before = counts()
      const prepared = await service.preview(
        'window',
        scan.scanId,
        'pi',
        scan.candidates.map((c) => ({ ref: c.ref }))
      )
      expect(counts()).toEqual(before)
      external.prepare('UPDATE session_message SET data = ?').run(JSON.stringify({ text: 'changed' }))
      expect(
        (
          await service.commit(
            'window',
            prepared.previewId,
            prepared.items.map((item) => item.ref)
          )
        )[0].reason
      ).toBe('source_changed')
      expect(counts()).toEqual(before)
      const fresh = await service.discover('window', 'opencode', sourceRoot)
      const accepted = await service.preview(
        'window',
        fresh.scanId,
        'pi',
        fresh.candidates.map((c) => ({ ref: c.ref }))
      )
      const [outcome] = await service.commit(
        'window',
        accepted.previewId,
        accepted.items.map((item) => item.ref)
      )
      expect(outcome).toMatchObject({ status: 'imported', initialization: 'ready', agentId: 'pi' })
      const stored = dbh.db.select().from(agentSessionMessageTable).all()
      expect(stored[0].data.parts).toEqual([{ type: 'text', text: 'changed' }])
      expect(stored[0].provenance?.source).toBe('opencode')
    } finally {
      external.close()
    }
  })
  it('renders already imported Claude tool results without rewriting stored history', async () => {
    await source()
    const prepared = await preview()
    const [outcome] = await service.commit(
      'window',
      prepared.previewId,
      prepared.items.map((item) => item.ref)
    )
    const stored = dbh.db.select().from(agentSessionMessageTable).all()[0]
    const data = {
      parts: [
        {
          type: 'text' as const,
          text:
            '[Historical tool result: Read]\n' +
            JSON.stringify({ type: 'tool_result', content: 'line one\nline two', tool_use_id: 'call' })
        }
      ]
    }
    dbh.db
      .update(agentSessionMessageTable)
      .set({ data, role: 'system' })
      .where(eq(agentSessionMessageTable.id, stored.id))
      .run()
    const visible = agentSessionMessageService.getSessionMessage(outcome.sessionId!, stored.id)
    expect(visible.role).toBe('assistant')
    expect(visible.data.parts).toEqual([
      expect.objectContaining({
        type: 'dynamic-tool',
        state: 'output-available',
        output: 'line one\nline two'
      })
    ])
    expect(JSON.stringify(visible.data)).not.toContain('tool_use_id')
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, stored.id)).get()!.data
    ).toEqual(data)
  })
  function counts() {
    return [agentSessionTable, agentSessionMessageTable, agentWorkspaceTable, appStateTable].map(
      (table) => dbh.db.select().from(table).all().length
    )
  }
  it('keeps preview read-only and imports historical times into the selected existing agent', async () => {
    await source()
    const before = dbh.db.select().from(agentTable).all()
    const p = await preview()
    expect(counts()).toEqual([0, 0, 0, 0])
    const result = await service.commit(
      'window',
      p.previewId,
      p.items.map((i) => i.ref)
    )
    expect(result).toEqual([expect.objectContaining({ status: 'imported', initialization: 'ready', agentId: 'pi' })])
    expect(dbh.db.select().from(agentTable).all()).toEqual(before)
    const session = dbh.db.select().from(agentSessionTable).get()!
    expect(session).toMatchObject({ agentId: 'pi', createdAt: 1767225600000, lastActivityAt: 1767225600000 })
    expect(dbh.db.select().from(agentWorkspaceTable).get()!.type).toBe('system')
    const newest = agentSessionMessageService.listSessionMessages(session.id, { limit: 1 })
    expect(newest.items[0].role).toBe('assistant')
    const older = agentSessionMessageService.listSessionMessages(session.id, { limit: 1, cursor: newest.nextCursor })
    expect(older.items[0].role).toBe('user')
    expect(older.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
  it('initializes actual Pi context including a final user message without a model', async () => {
    await source('tail', ['2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', '2026-01-01T00:00:02Z'])
    const p = await preview()
    const [result] = await service.commit('window', p.previewId, [p.items[0].ref])
    const state = getImportedHistoryState(result.sessionId!)!
    const directory = path.join(root, 'feature.agents.pi.sessions')
    const file = path.join(directory, (await readdir(directory))[0])
    const context = SessionManager.open(file, directory).buildSessionContext()
    expect(context.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(context.messages)).toContain('Message 2')
    await ensureImportedSessionHistory(result.sessionId!)
    expect(SessionManager.open(file, directory).getEntries()).toHaveLength(3)
    expect(state.status).toBe('ready')
  })
  it('deduplicates across selected agents and preserves the original owner', async () => {
    await source()
    const first = await preview()
    const [created] = await service.commit('window', first.previewId, [first.items[0].ref])
    const next = await preview('other')
    expect(next.items[0].existing).toMatchObject({ sessionId: created.sessionId, agentId: 'pi' })
    expect(await service.commit('window', next.previewId, [next.items[0].ref])).toEqual([
      expect.objectContaining({ status: 'existing', sessionId: created.sessionId, agentId: 'pi' })
    ])
    expect(counts()).toEqual([1, 2, 1, 1])
  })
  it('preserves archived copies and allows reimport and subsequent restoration after index upgrade', async () => {
    await source()
    const p = await preview()
    const [created] = await service.commit('window', p.previewId, [p.items[0].ref])
    dbh.sqlite.exec(`DROP INDEX agent_session_import_active_identity_idx;
      CREATE UNIQUE INDEX agent_session_import_identity_uniq ON agent_session (json_extract(import_metadata, '$.source'), json_extract(import_metadata, '$.originalSessionId'))`)
    dbh.sqlite.exec(AGENT_SESSION_IMPORT_STATEMENTS.join(';'))
    const original = dbh.db.select().from(agentSessionTable).get()!
    const originalMessages = dbh.db.select().from(agentSessionMessageTable).all()
    agentSessionService.delete(created.sessionId!)
    const next = await preview('other')
    expect(next.items[0].existing).toBeUndefined()
    const [copy] = await service.commit('window', next.previewId, [next.items[0].ref])
    expect(copy).toMatchObject({ status: 'imported', agentId: 'other' })
    expect(copy.sessionId).not.toBe(created.sessionId)
    const archived = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, created.sessionId!)).get()!
    expect(archived.deletedAt).not.toBeNull()
    expect(archived.importMetadata).toEqual(original.importMetadata)
    expect(
      dbh.db
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.sessionId, created.sessionId!))
        .all()
    ).toEqual(originalMessages)
    expect(agentSessionService.restore(created.sessionId!).deletedAt).toBeUndefined()
    expect(counts().slice(0, 2)).toEqual([2, 4])
    const again = await preview()
    expect((await service.commit('window', again.previewId, [again.items[0].ref]))[0].status).toBe('existing')
    expect(counts().slice(0, 2)).toEqual([2, 4])
  })
  it('commits valid selections and retries blocked selections without losing or duplicating successes', async () => {
    await source('valid')
    await source('blocked', ['2099-01-01T00:00:00Z'])
    const p = await preview()
    const blocked = p.items.find((item) => item.diagnostics.some((d) => d.severity === 'error'))!
    const outcomes = await service.commit(
      'window',
      p.previewId,
      p.items.map((item) => item.ref)
    )
    expect(outcomes.map((item) => item.status).sort()).toEqual(['failed', 'imported'])
    expect(counts().slice(0, 2)).toEqual([1, 2])
    await source('blocked')
    const retry = await service.preview('window', p.scan.scanId, 'pi', [{ ref: blocked.ref }])
    expect((await service.commit('window', retry.previewId, [blocked.ref]))[0].status).toBe('imported')
    expect(counts().slice(0, 2)).toEqual([2, 4])
  })
  it('rolls back all rows for a failed session', async () => {
    await source()
    const p = await preview()
    vi.spyOn(agentSessionMessageService, 'importMessagesTx').mockImplementation(() => {
      throw new Error('write_failed')
    })
    const result = await service.commit('window', p.previewId, [p.items[0].ref])
    expect(result[0]).toMatchObject({ status: 'failed', reason: 'write_failed' })
    expect(counts()).toEqual([0, 0, 0, 0])
  })
  it('rejects source changes and foreign-window confirmation before writing', async () => {
    const file = await source()
    const p = await preview()
    await expect(service.commit('other-window', p.previewId, [p.items[0].ref])).rejects.toThrow('preview_expired')
    await writeFile(file, '{}')
    expect((await service.commit('window', p.previewId, [p.items[0].ref]))[0]).toMatchObject({
      status: 'failed',
      reason: 'source_changed'
    })
    expect(counts()).toEqual([0, 0, 0, 0])
  })
  it('rejects future timestamps in preview and clock rollback at commit', async () => {
    await source('future', ['2099-01-01T00:00:00Z'])
    const future = await preview()
    expect(future.items[0].diagnostics).toContainEqual(
      expect.objectContaining({ code: 'clock_skew', severity: 'error' })
    )
    await source('future')
    const p = await preview()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-12-31T00:00:00Z'))
    expect((await service.commit('window', p.previewId, [p.items[0].ref]))[0]).toMatchObject({
      status: 'failed',
      reason: 'clock_skew'
    })
    expect(counts()).toEqual([0, 0, 0, 0])
  })
  it('does not let a target change create an orphan workspace', async () => {
    await source()
    const p = await preview()
    dbh.db.update(agentTable).set({ type: 'claude-code' }).where(eq(agentTable.id, 'pi')).run()
    expect((await service.commit('window', p.previewId, [p.items[0].ref]))[0]).toMatchObject({
      status: 'failed',
      reason: 'target_changed'
    })
    expect(counts()).toEqual([0, 0, 0, 0])
    await expect(preview('claude')).rejects.toThrow('target_changed')
  })
  it('requires explicit mapping for an unavailable directory', async () => {
    await source('mapped', undefined, path.join(root, 'missing'))
    const p = await preview()
    expect(p.items[0].diagnostics).toContainEqual(
      expect.objectContaining({ code: 'directory_required', severity: 'error' })
    )
    const mapped = await service.preview('window', p.scan.scanId, 'pi', [{ ref: p.items[0].ref, directory: root }])
    expect(mapped.items[0].diagnostics).toEqual([])
    const [created] = await service.commit('window', mapped.previewId, [mapped.items[0].ref])
    expect(created.status).toBe('imported')
    expect(dbh.db.select().from(agentWorkspaceTable).get()!.path).toBe(
      await import('node:fs/promises').then((fs) => fs.realpath(root))
    )
  })
  it('sends imported history before a new prompt through the actual Pi gateway', async () => {
    await source()
    const p = await preview()
    const [created] = await service.commit('window', p.previewId, [p.items[0].ref])
    const directory = path.join(root, 'feature.agents.pi.sessions')
    const manager = SessionManager.open(path.join(directory, (await readdir(directory))[0]), directory)
    const { model } = scriptedModel([[...textParts('response', 'Continued'), finish('stop')]])
    const { upstream: port, requests } = gatewayModel(model)
    const { session } = await createTestSession({
      port,
      sessionManager: manager,
      builtinTools: [],
      systemPrompt: dbh.db.select().from(agentTable).where(eq(agentTable.id, 'pi')).get()!.instructions
    })
    await session.prompt('Continue this task')
    expect(requests).toHaveLength(1)
    expect(requests[0].system).toContain('Keep these instructions')
    const input = JSON.stringify(requests[0].messages)
    expect(input.indexOf('Message 0')).toBeLessThan(input.indexOf('Message 1'))
    expect(input.indexOf('Message 1')).toBeLessThan(input.indexOf('Continue this task'))
    expect(Object.keys(requests[0].tools)).toEqual([])
    expect(created.initialization).toBe('ready')
  })
  it('stops after a committed session when cancellation arrives', async () => {
    await source('one')
    await source('two')
    const p = await preview()
    const notify = agentSessionService.notifyReadModelChange.bind(agentSessionService)
    vi.spyOn(agentSessionService, 'notifyReadModelChange').mockImplementation((...args) => {
      notify(...args)
      service.cancel('window')
    })
    const results = await service.commit(
      'window',
      p.previewId,
      p.items.map((item) => item.ref)
    )
    expect(results.map((result) => result.status)).toEqual(['imported', 'unprocessed'])
    expect(counts()).toEqual([1, 2, 1, 1])
  })
  it('rejects expired previews and keeps initialization failures readable and retryable', async () => {
    await source()
    const p = await preview()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(p.expiresAt + 1)
    await expect(service.commit('window', p.previewId, [p.items[0].ref])).rejects.toThrow('preview_expired')
    expect(counts()).toEqual([0, 0, 0, 0])
    clock.mockRestore()
    const fresh = await preview()
    vi.spyOn(piSdk, 'loadPiSdk').mockRejectedValueOnce(new Error('disk_unavailable'))
    const [created] = await service.commit('window', fresh.previewId, [fresh.items[0].ref])
    expect(created).toMatchObject({ status: 'imported', initialization: 'failed' })
    expect(agentSessionMessageService.listSessionMessages(created.sessionId!).items).toHaveLength(2)
    await ensureImportedSessionHistory(created.sessionId!)
    await ensureImportedSessionHistory(created.sessionId!)
    expect(getImportedHistoryState(created.sessionId!)!.status).toBe('ready')
    expect(counts()).toEqual([1, 2, 1, 1])
  })
  it('preserves source files and reuses a mapped workspace across separate conversations', async () => {
    const file = await source('one', undefined, root)
    await source('two', undefined, root)
    const before = await import('node:fs/promises').then((fs) => fs.readFile(file))
    const p = await preview()
    const results = await service.commit(
      'window',
      p.previewId,
      p.items.map((item) => item.ref)
    )
    expect(results.map((result) => result.status)).toEqual(['imported', 'imported'])
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
    expect(await import('node:fs/promises').then((fs) => fs.readFile(file))).toEqual(before)
  })
  it('serializes two windows importing the same source identity', async () => {
    await source()
    const a = await preview('pi', 'window')
    const b = await preview('other', 'other-window')
    const results = await Promise.all([
      service.commit('window', a.previewId, [a.items[0].ref]),
      service.commit('other-window', b.previewId, [b.items[0].ref])
    ])
    expect(
      results
        .flat()
        .map((result) => result.status)
        .sort()
    ).toEqual(['existing', 'imported'])
    expect(counts()).toEqual([1, 2, 1, 1])
  })
  it('rebuilds a missing pristine native file but blocks loss after continuation', async () => {
    await source()
    const p = await preview()
    const [created] = await service.commit('window', p.previewId, [p.items[0].ref])
    const directory = path.join(root, 'feature.agents.pi.sessions')
    const file = path.join(directory, (await readdir(directory))[0])
    await rm(file)
    await ensureImportedSessionHistory(created.sessionId!)
    expect(SessionManager.open(file, directory).buildSessionContext().messages).toHaveLength(2)
    agentSessionMessageService.saveMessage({
      sessionId: created.sessionId!,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'A later question' }] } }
    })
    await rm(file)
    await expect(ensureImportedSessionHistory(created.sessionId!)).rejects.toThrow('history_unrecoverable')
  })

  it('upgrades populated pre-import tables without changing existing history', async () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'old-workspace', name: 'Old', path: root, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'old-session', agentId: 'pi', name: 'Old task', workspaceId: 'old-workspace', orderKey: 'a0' })
      .run()
    agentSessionMessageService.saveMessage({
      sessionId: 'old-session',
      message: {
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Existing history' }] }
      }
    })
    dbh.sqlite.exec('DROP INDEX agent_session_import_active_identity_idx')
    dbh.sqlite.exec('ALTER TABLE agent_session DROP COLUMN import_metadata')
    dbh.sqlite.exec('ALTER TABLE agent_session_message DROP COLUMN provenance')
    replayMigration(dbh, '0030_agent_history_import')
    expect(dbh.db.select().from(agentSessionTable).get()!.importMetadata).toBeNull()
    expect(agentSessionMessageService.listSessionMessages('old-session').items[0].data.parts).toEqual([
      { type: 'text', text: 'Existing history' }
    ])
  })
  it('retains import identity, ownership and initialization state in a database backup', async () => {
    await source()
    const p = await preview()
    const [created] = await service.commit('window', p.previewId, [p.items[0].ref])
    const file = path.join(root, 'backup.sqlite')
    snapshotTo(dbh.sqlite, file)
    const restored = new Database(file, { readonly: true, fileMustExist: true })
    try {
      const row = restored
        .prepare('SELECT agent_id, workspace_id, import_metadata FROM agent_session WHERE id = ?')
        .get(created.sessionId!) as { agent_id: string; workspace_id: string; import_metadata: string }
      expect(row.agent_id).toBe('pi')
      expect(JSON.parse(row.import_metadata)).toMatchObject({ source: 'claude-code', originalSessionId: 'source' })
      expect(
        restored.prepare('SELECT count(*) AS count FROM agent_workspace WHERE id = ?').get(row.workspace_id)
      ).toEqual({ count: 1 })
      expect(
        restored
          .prepare('SELECT count(*) AS count FROM app_state WHERE key = ?')
          .get('conversation-import:' + created.sessionId)
      ).toEqual({ count: 1 })
    } finally {
      restored.close()
    }
  })
  it('counts filtered sessions separately and revalidates stale selections without writes', async () => {
    const setup = (id: string) =>
      JSON.stringify({
        type: 'user',
        uuid: id,
        parentUuid: null,
        sessionId: id,
        version: '2.1.284',
        timestamp: '2026-01-01T00:00:00Z',
        isMeta: true,
        message: { content: 'generated setup' }
      })
    const excluded = path.join(root, 'source', 'setup.jsonl')
    await writeFile(excluded, setup('setup'))
    const changing = await source('changing')
    await source('valid')
    const scan = await service.discover('window', 'claude-code', path.join(root, 'source'))
    expect(scan.candidates).toHaveLength(2)
    expect(scan.filtered).toEqual({ claude_no_user_task: 1, codex_guardian_review: 0 })
    const before = counts()
    await writeFile(changing, setup('changing'))
    const prepared = await service.preview(
      'window',
      scan.scanId,
      'pi',
      scan.candidates.map((c) => ({ ref: c.ref }))
    )
    expect(counts()).toEqual(before)
    const outcomes = await service.commit(
      'window',
      prepared.previewId,
      prepared.items.map((i) => i.ref)
    )
    expect(outcomes.map((o) => o.status).sort()).toEqual(['filtered', 'imported'])
    expect(outcomes.find((o) => o.status === 'filtered')).toEqual(
      expect.objectContaining({ reason: 'claude_no_user_task' })
    )
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .map((s) => s.importMetadata?.originalSessionId)
    ).toEqual(['valid'])
  })
  it('keeps the source fingerprint guard when a prepared session becomes setup-only', async () => {
    const file = await source()
    const prepared = await preview()
    const before = counts()
    await writeFile(
      file,
      JSON.stringify({
        type: 'user',
        uuid: 'setup',
        parentUuid: null,
        sessionId: 'source',
        version: '2.1.284',
        isMeta: true,
        message: { content: 'setup' }
      })
    )
    expect(
      await service.commit(
        'window',
        prepared.previewId,
        prepared.items.map((i) => i.ref)
      )
    ).toEqual([expect.objectContaining({ status: 'failed', reason: 'source_changed' })])
    expect(counts()).toEqual(before)
  })
})
