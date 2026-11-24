import { seedSessionRoot, setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { applyMigrations } from '@data/db/applyMigrations'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { artifactTable } from '@data/db/schemas/artifact'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { artifactService } from '@data/services/ArtifactService'
import { topicService } from '@data/services/TopicService'
import { ArtifactBackfillService, backfillPastOutputs } from '@main/ai/agents/ArtifactBackfillService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const NOW = Date.UTC(2026, 10, 13, 12)
const DAY = 24 * 60 * 60 * 1000

describe('ArtifactService', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defers the startup backfill until all database write holds are released', async () => {
    vi.useFakeTimers()
    const service = new ArtifactBackfillService()
    try {
      const firstHold = service.pause()
      const secondHold = service.pause()
      await service._doAllReady()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(await service.drainInFlight({ timeoutMs: 100 })).toEqual({ settled: true })
      expect(artifactService.hasBackfilledPastOutputs()).toBe(false)

      firstHold.dispose()
      firstHold.dispose()
      expect(artifactService.hasBackfilledPastOutputs()).toBe(false)

      secondHold.dispose()
      expect(await service.drainInFlight({ timeoutMs: 100 })).toEqual({ settled: true })
      expect(artifactService.hasBackfilledPastOutputs()).toBe(true)
    } finally {
      await service._doStop()
      vi.useRealTimers()
    }
  })

  describe('Agent outputs', () => {
    function seed() {
      for (const id of ['reviewer', 'writer']) {
        dbh.db.insert(agentTable).values({ id, type: 'claude-code', name: id, instructions: '', orderKey: id }).run()
      }
      dbh.db.insert(agentWorkspaceTable).values({ id: 'ws', name: 'Workspace', path: '/ws', orderKey: 'a0' }).run()
      const session = (id: string, agentId: string, deletedAt?: number) =>
        dbh.db
          .insert(agentSessionTable)
          .values({ id, agentId, name: `Session ${id}`, workspaceId: 'ws', orderKey: id, deletedAt })
          .run()
      session('s-1', 'reviewer')
      session('s-2', 'reviewer')
      session('s-deleted', 'reviewer', NOW)
      session('s-other', 'writer')
    }

    function recordAt(time: number, agentId: string, sessionId: string, paths: string[], size: number | null = 10) {
      vi.spyOn(Date, 'now').mockReturnValue(time)
      artifactService.recordAgentArtifacts(
        agentId,
        sessionId,
        paths.map((path) => ({ path, title: path.split('/').at(-1)!, size }))
      )
    }

    it('derives the kind from the file type: HTML and Markdown are pages, images, audio and video are media', () => {
      seed()
      recordAt(NOW, 'reviewer', 's-1', [
        '/ws/report.HTML',
        '/ws/notes.md',
        '/ws/shot.png',
        '/ws/voice.mp3',
        '/ws/clip.mp4',
        '/ws/data.csv',
        '/ws/nested/.PNG',
        '/ws/README'
      ])

      const kinds = Object.fromEntries(
        artifactService.list({ agentId: 'reviewer' }).items.map((item) => [item.title, item.kind])
      )
      expect(kinds).toEqual({
        'report.HTML': 'page',
        'notes.md': 'page',
        'shot.png': 'media',
        'voice.mp3': 'media',
        'clip.mp4': 'media',
        'data.csv': 'file',
        '.PNG': 'file',
        README: 'file'
      })
    })

    it("lists the Agent's outputs across its live sessions, newest first, with every kind's total", () => {
      seed()
      recordAt(NOW - 2000, 'reviewer', 's-1', ['/ws/old.pdf'])
      recordAt(NOW - 1000, 'reviewer', 's-2', ['/ws/page.html'], null)
      recordAt(NOW, 'reviewer', 's-2', ['/ws/shot.png'])
      recordAt(NOW, 'reviewer', 's-deleted', ['/ws/trashed.pdf'])
      recordAt(NOW, 'writer', 's-other', ['/ws/foreign.pdf'])

      const list = artifactService.list({ agentId: 'reviewer' })

      expect(list.items.map((item) => item.path)).toEqual(['/ws/shot.png', '/ws/page.html', '/ws/old.pdf'])
      expect(list.items[1]).toEqual({
        id: expect.any(String),
        sourceId: 's-2',
        sourceName: 'Session s-2',
        path: '/ws/page.html',
        fileEntryId: undefined,
        title: 'page.html',
        kind: 'page',
        size: undefined,
        reportedAt: new Date(NOW - 1000).toISOString()
      })
      expect(list.counts).toEqual({ all: 3, page: 1, media: 1, file: 1 })
    })

    it('filters the items by kind but keeps the totals of every kind', () => {
      seed()
      recordAt(NOW, 'reviewer', 's-1', ['/ws/a.html', '/ws/b.png', '/ws/c.png'])

      const list = artifactService.list({ agentId: 'reviewer' }, { kind: 'media' })

      expect(list.items.map((item) => item.path).sort()).toEqual(['/ws/b.png', '/ws/c.png'])
      expect(list.counts).toEqual({ all: 3, page: 1, media: 2, file: 0 })
    })

    it('keeps one row per session and path, refreshed when the path is reported again', () => {
      seed()
      recordAt(NOW - 1000, 'reviewer', 's-1', ['/ws/report.pdf'], 10)
      vi.spyOn(Date, 'now').mockReturnValue(NOW)
      artifactService.recordAgentArtifacts('reviewer', 's-1', [
        { path: '/ws/report.pdf', title: 'Final report', size: 20 }
      ])
      recordAt(NOW, 'reviewer', 's-2', ['/ws/report.pdf'])

      const items = artifactService.list({ agentId: 'reviewer' }).items.filter((item) => item.sourceId === 's-1')

      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ title: 'Final report', size: 20, reportedAt: new Date(NOW).toISOString() })
      expect(artifactService.list({ agentId: 'reviewer' }).counts.all).toBe(2)
    })

    it('retains current and legacy output identities when the system workspace moves', () => {
      seed()
      dbh.db.update(agentWorkspaceTable).set({ type: 'system' }).where(eq(agentWorkspaceTable.id, 'ws')).run()
      recordAt(NOW, 'reviewer', 's-1', ['/ws/current.md', '/ws/legacy.md'])
      dbh.db.update(artifactTable).set({ path: '/ws/legacy.md' }).where(eq(artifactTable.path, 'legacy.md')).run()
      const before = artifactService.list({ agentId: 'reviewer' }).items

      application.get('DbService').withWriteTx((tx) => {
        agentWorkspaceService.relocateSystemWorkspaceTx(tx, 'ws', '/ws', '/ws-moved')
      })

      expect(artifactService.list({ agentId: 'reviewer' }).items).toEqual(
        before.map((item) => ({ ...item, path: item.path?.replace('/ws/', '/ws-moved/') }))
      )
    })

    it('moves output ownership with the session and refreshes the same output after another report', () => {
      seed()
      recordAt(NOW, 'reviewer', 's-1', ['/ws/report.md'])
      const originalId = artifactService.list({ agentId: 'reviewer' }).items[0].id

      agentSessionService.update('s-1', { agentId: 'writer' })
      expect(artifactService.list({ agentId: 'reviewer' }).items).toEqual([])
      expect(artifactService.list({ agentId: 'writer' }).items).toEqual([expect.objectContaining({ id: originalId })])

      recordAt(NOW + DAY, 'writer', 's-1', ['/ws/report.md'])
      expect(artifactService.list({ agentId: 'writer' }).items).toEqual([
        expect.objectContaining({ id: originalId, reportedAt: new Date(NOW + DAY).toISOString() })
      ])
    })

    it('rejects an output of a session that does not exist', () => {
      seed()
      expect(() => recordAt(NOW, 'reviewer', 'missing', ['/ws/a.pdf'])).toThrow()
      expect(artifactService.list({ agentId: 'reviewer' }).counts.all).toBe(0)
    })

    describe('past reports', () => {
      let messageSeq = 0
      const report = (toolName: string, artifacts: unknown, extra: Record<string, unknown> = {}) => ({
        type: 'dynamic-tool',
        toolName,
        toolCallId: `call-${messageSeq}`,
        state: 'output-available',
        input: { artifacts, summary: 'Done' },
        output: { content: 'Recorded 1 artifact(s).' },
        ...extra
      })
      function message(sessionId: string, createdAt: number, parts: unknown[]) {
        dbh.db
          .insert(agentSessionMessageTable)
          .values({
            id: `m-${++messageSeq}`,
            sessionId,
            parentId: seedSessionRoot(dbh.db, sessionId),
            role: 'assistant',
            data: { parts: parts as never },
            status: 'success',
            createdAt,
            updatedAt: createdAt
          })
          .run()
      }

      it("lists the deliverables reported in every past session, in each transport's tool shape", async () => {
        seed()
        message('s-1', NOW - 10 * DAY, [
          { type: 'text', text: 'Here is the report' },
          report('mcp__cherry-tools__report_artifacts', [{ path: '/ws/report.md', description: 'Weekly report' }])
        ])
        message('s-2', NOW - 3 * DAY, [report('mcp__cherry_tools__report_artifacts', [{ path: 'out/chart.png' }])])
        message('s-2', NOW, [
          {
            type: 'tool-report_artifacts',
            toolCallId: 'static',
            state: 'output-available',
            input: { artifacts: [{ path: '/ws/data.csv' }] }
          }
        ])
        message('s-other', NOW, [report('mcp__cherry-tools__report_artifacts', [{ path: '/ws/foreign.pdf' }])])

        await backfillPastOutputs()

        const list = artifactService.list({ agentId: 'reviewer' })
        expect(
          list.items.map(({ sourceId, path, title, kind, reportedAt }) => ({ sourceId, path, title, kind, reportedAt }))
        ).toEqual([
          {
            sourceId: 's-2',
            path: '/ws/data.csv',
            title: 'data.csv',
            kind: 'file',
            reportedAt: new Date(NOW).toISOString()
          },
          {
            sourceId: 's-2',
            path: '/ws/out/chart.png',
            title: 'chart.png',
            kind: 'media',
            reportedAt: new Date(NOW - 3 * DAY).toISOString()
          },
          {
            sourceId: 's-1',
            path: '/ws/report.md',
            title: 'Weekly report',
            kind: 'page',
            reportedAt: new Date(NOW - 10 * DAY).toISOString()
          }
        ])
        expect(artifactService.list({ agentId: 'writer' }).items.map((item) => item.path)).toEqual(['/ws/foreign.pdf'])
      })

      it('keeps one row per session and path, with its newest report', async () => {
        seed()
        message('s-1', NOW - 2 * DAY, [report('report_artifacts', [{ path: '/ws/a.md', description: 'Draft' }])])
        message('s-1', NOW - DAY, [report('report_artifacts', [{ path: '/ws/a.md', description: 'Final' }])])
        message('s-1', NOW - 3 * DAY, [report('report_artifacts', [{ path: '/ws/live.md', description: 'Old' }])])
        recordAt(NOW, 'reviewer', 's-1', ['/ws/live.md'])

        await backfillPastOutputs()

        const items = artifactService.list({ agentId: 'reviewer' }).items
        expect(items.map(({ path, title, reportedAt }) => ({ path, title, reportedAt }))).toEqual([
          { path: '/ws/live.md', title: 'live.md', reportedAt: new Date(NOW).toISOString() },
          { path: '/ws/a.md', title: 'Final', reportedAt: new Date(NOW - DAY).toISOString() }
        ])
      })

      it('adds nothing when the same reports are indexed again', async () => {
        seed()
        message('s-1', NOW, [report('report_artifacts', [{ path: '/ws/a.md' }, { path: '/ws/b.png' }])])

        await backfillPastOutputs()
        await backfillPastOutputs()

        expect(dbh.db.select().from(artifactTable).all()).toHaveLength(2)
      })

      it('shows past outputs after restoring a session and skips malformed or unfinished calls', async () => {
        seed()
        message('s-deleted', NOW, [report('report_artifacts', [{ path: '/ws/trashed.md' }])])
        message('s-1', NOW, [
          null,
          { state: 'output-available' },
          {
            type: 'dynamic-tool',
            toolName: 42,
            state: 'output-available',
            input: { artifacts: [{ path: '/ws/x.md' }] }
          },
          report('report_artifacts', [{ path: '/ws/failed.md' }], { state: 'output-error' }),
          report('report_artifacts', [{ path: '   ' }]),
          report('report_artifacts', 'not a list'),
          report('report_artifacts', [{ path: '/ws/kept.md' }])
        ])

        await backfillPastOutputs()

        expect(artifactService.list({ agentId: 'reviewer' }).items.map((row) => row.path)).toEqual(['/ws/kept.md'])
        agentSessionService.restore('s-deleted')
        expect(artifactService.list({ agentId: 'reviewer' }).items.map((row) => row.path)).toContain('/ws/trashed.md')
      })

      it('recovers historical absolute paths after their workspace has moved', async () => {
        seed()
        dbh.db.update(agentWorkspaceTable).set({ type: 'system' }).where(eq(agentWorkspaceTable.id, 'ws')).run()
        message('s-1', NOW, [report('report_artifacts', [{ path: '/ws/summary.md' }])])
        application.get('DbService').withWriteTx((tx) => {
          agentWorkspaceService.relocateSystemWorkspaceTx(tx, 'ws', '/ws', '/ws-moved')
        })

        await backfillPastOutputs()

        expect(artifactService.list({ agentId: 'reviewer' }).items.map((row) => row.path)).toEqual([
          '/ws-moved/summary.md'
        ])
      })

      it('rolls back indexed rows when the completion marker cannot be written, then retries', async () => {
        seed()
        message('s-1', NOW, [report('report_artifacts', [{ path: 'a.md' }])])
        dbh.sqlite.exec(`
          CREATE TRIGGER fail_artifact_marker BEFORE INSERT ON app_state
          WHEN NEW.key = 'artifact:past-outputs:v2'
          BEGIN SELECT RAISE(ABORT, 'marker unavailable'); END;
        `)

        await expect(backfillPastOutputs()).rejects.toThrow('marker unavailable')
        expect(artifactService.list({ agentId: 'reviewer' }).items).toEqual([])
        expect(artifactService.hasBackfilledPastOutputs()).toBe(false)

        dbh.sqlite.exec('DROP TRIGGER fail_artifact_marker')
        await backfillPastOutputs()
        expect(artifactService.list({ agentId: 'reviewer' }).items.map((row) => row.path)).toEqual(['/ws/a.md'])
        expect(artifactService.hasBackfilledPastOutputs()).toBe(true)
      })
    })
  })

  describe('Assistant outputs', () => {
    const IMAGE_1 = '019606a0-0000-7000-8000-000000000001'
    const IMAGE_2 = '019606a0-0000-7000-8000-000000000002'

    function seed() {
      for (const id of ['writer', 'coder']) {
        dbh.db
          .insert(assistantTable)
          .values({ id, name: id, emoji: '🌟', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: id })
          .run()
      }
      const topic = (id: string, orderKey: string, assistantId: string | null, deletedAt?: number) =>
        dbh.db
          .insert(topicTable)
          .values({ id, name: `Topic ${id}`, assistantId, orderKey, deletedAt })
          .run()
      topic('t-1', 'a0', 'writer')
      topic('t-deleted', 'a1', 'writer', NOW)
      topic('t-orphan', 'a2', null)
      for (const [id, name] of [
        [IMAGE_1, 'cover'],
        [IMAGE_2, 'banner']
      ]) {
        dbh.db
          .insert(fileEntryTable)
          .values({ id, origin: 'internal', name, ext: 'png', size: 2048, createdAt: NOW, updatedAt: NOW })
          .run()
      }
    }

    it("lists the images generated in the Assistant's live topics as media of that topic", () => {
      seed()
      vi.spyOn(Date, 'now').mockReturnValue(NOW)
      artifactService.recordTopicFiles('t-1', [IMAGE_1])
      artifactService.recordTopicFiles('t-deleted', [IMAGE_2])

      const list = artifactService.list({ assistantId: 'writer' })

      expect(list.items).toEqual([
        {
          id: expect.any(String),
          sourceId: 't-1',
          sourceName: 'Topic t-1',
          path: undefined,
          fileEntryId: IMAGE_1,
          title: 'cover.png',
          kind: 'media',
          size: 2048,
          reportedAt: new Date(NOW).toISOString()
        }
      ])
      expect(list.counts).toEqual({ all: 1, page: 0, media: 1, file: 0 })
      expect(artifactService.list({ assistantId: 'coder' }).counts.all).toBe(0)
    })

    it('skips topics that are not stored or have no Assistant, and files that do not exist', () => {
      seed()
      artifactService.recordTopicFiles('temporary-topic', [IMAGE_1])
      artifactService.recordTopicFiles('t-orphan', [IMAGE_1])
      artifactService.recordTopicFiles('t-1', ['019606a0-0000-7000-8000-0000000000ff'])

      expect(artifactService.list({ assistantId: 'writer' }).counts.all).toBe(0)
    })

    it('keeps the same image with the moved topic after its previous Assistant is deleted', () => {
      seed()
      artifactService.recordTopicFiles('t-1', [IMAGE_1])
      const [indexedImage] = artifactService.list({ assistantId: 'writer' }).items

      topicService.move('t-1', { assistantId: 'coder', order: { position: 'last' } })

      expect(artifactService.list({ assistantId: 'writer' }).items).toEqual([])
      expect(artifactService.list({ assistantId: 'coder' }).items).toEqual([indexedImage])

      dbh.db.delete(assistantTable).where(eq(assistantTable.id, 'writer')).run()
      expect(artifactService.list({ assistantId: 'coder' }).items).toEqual([indexedImage])
    })

    it('keeps the indexed image across detaching and reassigning its topic', () => {
      seed()
      artifactService.recordTopicFiles('t-1', [IMAGE_1])
      const [indexedImage] = artifactService.list({ assistantId: 'writer' }).items

      topicService.update('t-1', { assistantId: null })
      expect(artifactService.list({ assistantId: 'writer' }).items).toEqual([])
      dbh.db.delete(assistantTable).where(eq(assistantTable.id, 'writer')).run()

      topicService.update('t-1', { assistantId: 'coder' })
      expect(artifactService.list({ assistantId: 'coder' }).items).toEqual([indexedImage])
    })

    it('drops the output when its file is deleted', () => {
      seed()
      artifactService.recordTopicFiles('t-1', [IMAGE_1, IMAGE_2])
      dbh.sqlite.prepare('DELETE FROM file_entry WHERE id = ?').run(IMAGE_1)

      expect(artifactService.list({ assistantId: 'writer' }).items.map((item) => item.fileEntryId)).toEqual([IMAGE_2])
    })

    it('lists the images generated in past topics, once, at the time of their message', async () => {
      seed()
      const generated = (output: unknown, state = 'output-available') => ({
        type: 'dynamic-tool',
        toolName: 'generate_image',
        toolCallId: 'image',
        state,
        input: { prompt: 'a cover' },
        output
      })
      const message = (id: string, topicId: string, createdAt: number, parts: unknown[]) => ({
        id,
        parentId: null,
        topicId,
        role: 'assistant',
        data: { parts: parts as never },
        status: 'success',
        createdAt,
        updatedAt: createdAt
      })
      dbh.db
        .insert(messageTable)
        .values(
          withRoot('t-1', [
            message('m-1', 't-1', NOW - DAY, [
              generated([
                { id: IMAGE_1, name: 'cover.png' },
                { id: '019606a0-0000-7000-8000-0000000000ff', name: 'gone.png' }
              ])
            ]),
            message('m-2', 't-1', NOW, [
              generated({ content: [{ id: IMAGE_2, name: 'banner.png' }] }),
              generated([{ id: 'x' }], 'output-error')
            ])
          ])
        )
        .run()
      dbh.db
        .insert(messageTable)
        .values(
          withRoot('t-deleted', [message('m-3', 't-deleted', NOW, [generated([{ id: IMAGE_1, name: 'cover.png' }])])])
        )
        .run()
      vi.spyOn(Date, 'now').mockReturnValue(NOW + DAY)
      artifactService.recordTopicFiles('t-1', [IMAGE_2])
      vi.restoreAllMocks()

      await backfillPastOutputs()
      await backfillPastOutputs()

      expect(
        artifactService
          .list({ assistantId: 'writer' })
          .items.map(({ fileEntryId, reportedAt }) => ({ fileEntryId, reportedAt }))
      ).toEqual([
        { fileEntryId: IMAGE_2, reportedAt: new Date(NOW + DAY).toISOString() },
        { fileEntryId: IMAGE_1, reportedAt: new Date(NOW - DAY).toISOString() }
      ])
      expect(artifactService.list({ assistantId: 'writer' }).items.some((row) => row.sourceId === 't-deleted')).toBe(
        false
      )
      dbh.db.update(topicTable).set({ deletedAt: null }).where(eq(topicTable.id, 't-deleted')).run()
      expect(artifactService.list({ assistantId: 'writer' }).items.some((row) => row.sourceId === 't-deleted')).toBe(
        true
      )
    })
  })
})

// 0042 shipped with #22382; earlier builds of this stack made `artifact` in other shapes, before or inside 0042.
describe('artifact migrate-forward from the shipped 0042', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0043_artifact' })

  // Catches a rewritten 0042 that runs again on a database that applied it and fails on its duplicate column.
  it('adds the artifact table without running 0042 again', () => {
    dbh.db.insert(topicTable).values({ id: 'existing', name: 'Existing topic', orderKey: 'a0' }).run()
    dbh.sqlite
      .prepare('INSERT INTO mcp_server (id, name, skill_permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('existing-server', 'Existing MCP server', null, NOW, NOW)

    applyMigrations(dbh.db, 'migrations/sqlite-drizzle')

    expect(dbh.db.select().from(topicTable).where(eq(topicTable.id, 'existing')).get()?.name).toBe('Existing topic')
    expect(dbh.db.select().from(artifactTable).all()).toEqual([])
    expect(dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, 'existing-server')).get()).toMatchObject({
      name: 'Existing MCP server',
      skillPermissions: null
    })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

// Catches `table artifact already exists` on a profile that ran an earlier build of this stack.
describe.each([
  ['an earlier build with assistant_id', 'assistant_id text,'],
  ['a build that created the current shape', '']
])('artifact migrate-forward after %s', (_case, extraColumn) => {
  const dbh = setupTestDatabase({ beforeMigration: '0043_artifact' })

  it('keeps the existing rows and rebuilds the table in the current shape', () => {
    dbh.db.insert(topicTable).values({ id: 'topic-1', name: 'Topic', orderKey: 'a0' }).run()
    dbh.sqlite.exec(
      `CREATE TABLE artifact (id text PRIMARY KEY NOT NULL, agent_id text, session_id text, ${extraColumn} topic_id text, path text, file_entry_id text, title text NOT NULL, size integer, reported_at integer NOT NULL)`
    )
    dbh.sqlite
      .prepare('INSERT INTO artifact (id, topic_id, file_entry_id, title, size, reported_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('artifact-1', 'topic-1', 'file-1', 'Report', 10, NOW)

    applyMigrations(dbh.db, 'migrations/sqlite-drizzle')

    const columns = (dbh.sqlite.pragma('table_info(artifact)') as { name: string }[]).map((column) => column.name)
    expect(columns).not.toContain('assistant_id')
    expect(dbh.db.select().from(artifactTable).all()).toEqual([
      expect.objectContaining({ id: 'artifact-1', topicId: 'topic-1', fileEntryId: 'file-1', title: 'Report' })
    ])
    expect(() =>
      dbh.sqlite
        .prepare('INSERT INTO artifact (id, topic_id, path, title, reported_at) VALUES (?, ?, ?, ?, ?)')
        .run('invalid', 'topic-1', 'a.md', 'Invalid', NOW)
    ).toThrow(/CHECK constraint failed/)
  })
})
