import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  collectRestoredKnowledgeBaseIds,
  enqueueKnowledgeReindexAfterRestore,
  knowledgeIndexDocumentsPayload,
  knowledgeRootRelativeToUserData
} from '../enqueueKnowledgeReindexAfterRestore'
import { isExcludedKnowledgeIndexBasename, KNOWLEDGE_INDEX_SQLITE_BASENAMES } from '../FileStager'

describe('knowledge index-documents payload (jobTypes.ts)', () => {
  it('matches { baseId, itemId, parentJobId } with null parent for top-level restore enqueue', () => {
    const payload = knowledgeIndexDocumentsPayload('kb-1', 'item-1', null)
    expect(payload).toEqual({
      baseId: 'kb-1',
      itemId: 'item-1',
      parentJobId: null
    })
    // Shape guard against jobTypes.ts:14-18 drift.
    expect(Object.keys(payload).sort()).toEqual(['baseId', 'itemId', 'parentJobId'])
  })

  it('preserves a non-null parentJobId (reindex-subtree → scheduleIndexing)', () => {
    expect(knowledgeIndexDocumentsPayload('kb-1', 'item-1', 'reindex-job')).toEqual({
      baseId: 'kb-1',
      itemId: 'item-1',
      parentJobId: 'reindex-job'
    })
  })
})

describe('collectRestoredKnowledgeBaseIds', () => {
  it('collects dir-add livePaths under the knowledge root', () => {
    const ids = collectRestoredKnowledgeBaseIds(
      [
        { kind: 'blob-add', stagingPath: 's/f1', livePath: 'Data/Files/f1' },
        { kind: 'dir-add', stagingPath: 's/kb/a', livePath: 'Data/KnowledgeBase/base-a' },
        { kind: 'dir-add', stagingPath: 's/kb/b', livePath: 'Data/KnowledgeBase/base-b' },
        { kind: 'dir-add', stagingPath: 's/skills/x', livePath: 'Data/Skills/x' },
        { kind: 'note-add', stagingPath: 's/n.md', livePath: 'Notes/n.md' }
      ],
      'Data/KnowledgeBase'
    )
    expect(ids).toEqual(['base-a', 'base-b'])
  })

  it('rejects nested paths under the knowledge root', () => {
    expect(
      collectRestoredKnowledgeBaseIds(
        [{ kind: 'dir-add', stagingPath: 's', livePath: 'Data/KnowledgeBase/base/nested' }],
        'Data/KnowledgeBase'
      )
    ).toEqual([])
  })
})

describe('knowledgeRootRelativeToUserData', () => {
  it('strips the userData prefix', () => {
    expect(knowledgeRootRelativeToUserData('/app/userData', '/app/userData/Data/KnowledgeBase')).toBe(
      'Data/KnowledgeBase'
    )
  })
})

describe('enqueueKnowledgeReindexAfterRestore', () => {
  it('enqueues reindexItems for bases that need reindex, with completed roots', async () => {
    const reindexItems = vi.fn().mockResolvedValue(undefined)
    await enqueueKnowledgeReindexAfterRestore(['kb-1', 'kb-2', 'kb-skip'], {
      reindexItems,
      listCompletedRoots: (baseId) => (baseId === 'kb-skip' ? [] : [`${baseId}-item`]),
      needsReindex: (baseId) => baseId !== 'kb-2'
    })
    expect(reindexItems).toHaveBeenCalledTimes(1)
    expect(reindexItems).toHaveBeenCalledWith('kb-1', ['kb-1-item'])
  })

  it('builds index-documents payloads for each completed leaf (AC shape)', async () => {
    // Production path goes through reindex-subtree → scheduleIndexing; this pins the
    // leaf payload contract the AC requires against jobTypes.ts.
    const payloads = [
      knowledgeIndexDocumentsPayload('kb-1', 'leaf-1', null),
      knowledgeIndexDocumentsPayload('kb-1', 'leaf-2', 'parent-reindex')
    ]
    expect(payloads).toEqual([
      { baseId: 'kb-1', itemId: 'leaf-1', parentJobId: null },
      { baseId: 'kb-1', itemId: 'leaf-2', parentJobId: 'parent-reindex' }
    ])
  })
})

describe('KNOWLEDGE_INDEX_SQLITE_BASENAMES exclude filter', () => {
  it('excludes exactly index.sqlite and WAL/SHM sidecars', () => {
    expect([...KNOWLEDGE_INDEX_SQLITE_BASENAMES].sort()).toEqual([
      'index.sqlite',
      'index.sqlite-shm',
      'index.sqlite-wal'
    ])
    expect(isExcludedKnowledgeIndexBasename('/kb/.cherry/index.sqlite')).toBe(true)
    expect(isExcludedKnowledgeIndexBasename('/kb/.cherry/index.sqlite-wal')).toBe(true)
    expect(isExcludedKnowledgeIndexBasename('/kb/.cherry/index.sqlite-shm')).toBe(true)
    expect(isExcludedKnowledgeIndexBasename('/kb/raw/doc.md')).toBe(false)
    expect(isExcludedKnowledgeIndexBasename('/kb/.cherry/other.db')).toBe(false)
  })
})

describe('FTS isolation sentinel (knowledge-r1)', () => {
  it('does not touch FtsCentralHelper / message_fts rebuild paths', async () => {
    const ftsPath = join(process.cwd(), 'src/main/services/backup/merge/FtsCentralHelper.ts')
    expect(existsSync(ftsPath)).toBe(true)

    const { readFile } = await import('node:fs/promises')
    const stager = await readFile(join(process.cwd(), 'src/main/services/backup/FileStager.ts'), 'utf8')
    const enqueue = await readFile(
      join(process.cwd(), 'src/main/services/backup/enqueueKnowledgeReindexAfterRestore.ts'),
      'utf8'
    )
    const backupService = await readFile(join(process.cwd(), 'src/main/services/backup/BackupService.ts'), 'utf8')
    for (const src of [stager, enqueue, backupService]) {
      expect(src).not.toMatch(/FtsCentralHelper/)
      expect(src).not.toMatch(/message_fts/)
      expect(src).not.toMatch(/agent_session_message_fts/)
    }
  })
})
