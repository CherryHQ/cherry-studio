import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { topicTable } from '@data/db/schemas/topic'
import { artifactService } from '@data/services/ArtifactService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const NOW = Date.UTC(2026, 10, 13, 12)

describe('ArtifactService', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
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

    it('rejects an output of a session that does not exist', () => {
      seed()
      expect(() => recordAt(NOW, 'reviewer', 'missing', ['/ws/a.pdf'])).toThrow()
      expect(artifactService.list({ agentId: 'reviewer' }).counts.all).toBe(0)
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
      const topic = (id: string, assistantId: string | null, deletedAt?: number) =>
        dbh.db
          .insert(topicTable)
          .values({ id, name: `Topic ${id}`, assistantId, orderKey: id, deletedAt })
          .run()
      topic('t-1', 'writer')
      topic('t-deleted', 'writer', NOW)
      topic('t-orphan', null)
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

    it('drops the output when its file is deleted', () => {
      seed()
      artifactService.recordTopicFiles('t-1', [IMAGE_1, IMAGE_2])
      dbh.sqlite.prepare('DELETE FROM file_entry WHERE id = ?').run(IMAGE_1)

      expect(artifactService.list({ assistantId: 'writer' }).items.map((item) => item.fileEntryId)).toEqual([IMAGE_2])
    })
  })
})
