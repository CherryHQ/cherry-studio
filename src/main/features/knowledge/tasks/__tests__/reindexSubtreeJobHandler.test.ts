import { KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED } from '@shared/data/types/knowledge'
import type { PosixRelativeFilePath } from '@shared/utils/file'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { describe, expect, it } from 'vitest'

import {
  cancelMock,
  copyFileIntoKnowledgeBaseAtMock,
  createCtx,
  createDirectoryItem,
  createFileItem,
  createJobSnapshot,
  createNoteItem,
  createReindexSubtreeJobHandler,
  createUrlItem,
  deleteItemsByIdsMock,
  deleteKnowledgeItemFilesBestEffortMock,
  deleteMaterialsMock,
  fetchKnowledgeWebPageMock,
  FILE_ITEM_ID,
  FILE_RELATIVE_PATH,
  ingestionService,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  listMock,
  loggerWarnMock,
  probeKnowledgeSourcePathMock,
  scheduleItemMock,
  writeFileIntoKnowledgeBaseAtMock
} from './jobHandlerTestUtils'

describe('reindex-subtree job handler', () => {
  it('clears old artifacts, resets selected roots, and schedules selected roots', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )

    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    await handler.execute(ctx)

    expect(deleteMaterialsMock).toHaveBeenCalledWith(['note-1'])
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job', { forceFileReprocess: true })
    // A clean rebuild with nothing skipped omits skippedMissingSource entirely (exact-object match).
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done', totalFiles: 1 })
  })

  it('clears stale directory copy progress before marking the directory as preparing', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )
    MockMainCacheServiceExport.cacheService.setShared('knowledge.item.directory_copy_progress.dir-1', 100)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))

    expect(MockMainCacheServiceExport.cacheService.deleteShared).toHaveBeenCalledWith(
      'knowledge.item.directory_copy_progress.dir-1'
    )
    expect(MockMainCacheServiceExport.cacheService.deleteShared.mock.invocationCallOrder[0]).toBeLessThan(
      knowledgeItemUpdateStatusMock.mock.invocationCallOrder[0]
    )
  })

  it('routes container descendant cleanup through best-effort delete before deleting rows', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))

    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith('kb-1', [child], {
      baseId: 'kb-1',
      jobId: 'reindex-job'
    })
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    // Cleanup is best-effort (swallows failures — see pathStorage test); row deletion must run after it.
    expect(deleteKnowledgeItemFilesBestEffortMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteItemsByIdsMock.mock.invocationCallOrder[0]
    )
  })

  it('skips deleting subtrees before reset', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1', 'deleting')
    const child = createNoteItem('note-1', 'dir-1', 'deleting')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([root, child])

    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting' })
    expect(listMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('skips reset when the subtree becomes deleting inside the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    const deletingChild = createNoteItem('note-1', 'dir-1', 'deleting')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock.mockReturnValueOnce([root, child]).mockReturnValueOnce([root, deletingChild])

    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting', totalFiles: 0 })
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('leaves a root untouched when its source vanished before the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )
    // The directory's on-disk source is gone, so the in-lock re-check must keep its
    // existing vectors instead of wiping them with nothing left to rebuild from.
    probeKnowledgeSourcePathMock.mockResolvedValue('missing')

    await handler.execute(ctx)

    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Skipping reindex for roots whose source could not be read before the mutation lock',
      expect.objectContaining({ baseId: 'kb-1', missingSourceRootIds: ['dir-1'], jobId: 'reindex-job' })
    )
    // The skipped-source count is threaded into the done detail so the partial no-op is visible.
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done', totalFiles: 0, skippedMissingSource: 1 })
  })

  it('reindexes only the roots whose source still exists', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const presentRoot = createDirectoryItem('dir-1')
    const presentChild = createNoteItem('note-1', 'dir-1')
    const missingRoot = createDirectoryItem('dir-2')
    const missingChild = createNoteItem('note-2', 'dir-2')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.includeRoots && options.leafOnly) return rootIds.includes('dir-1') ? [presentChild] : []
        if (options.includeRoots) return [presentRoot, presentChild, missingRoot, missingChild]
        return rootIds.includes('dir-1') ? [presentChild] : []
      }
    )
    probeKnowledgeSourcePathMock.mockImplementation(async (absolutePath: string) =>
      absolutePath === '/dir-1' ? 'readable' : 'missing'
    )

    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', 'dir-2'] }, 'reindex-job')
    await handler.execute(ctx)

    // Only the surviving root's subtree is wiped and rescheduled; the vanished root keeps its vectors.
    expect(deleteMaterialsMock).toHaveBeenCalledWith(['note-1'])
    expect(deleteMaterialsMock).not.toHaveBeenCalledWith(expect.arrayContaining(['note-2']))
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-2', 'preparing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job', { forceFileReprocess: true })
    expect(scheduleItemMock).not.toHaveBeenCalledWith('kb-1', 'dir-2', 'reindex-job', { forceFileReprocess: true })
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Skipping reindex for roots whose source could not be read before the mutation lock',
      expect.objectContaining({ baseId: 'kb-1', missingSourceRootIds: ['dir-2'], jobId: 'reindex-job' })
    )
    // One root rebuilt, one skipped — the done detail surfaces the skip alongside the rebuilt count.
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done', totalFiles: 1, skippedMissingSource: 1 })
  })

  it('clears old artifacts for selected leaf roots', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createNoteItem('note-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [root]
        if (options.includeRoots) return [root]
        return []
      }
    )

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['note-1'] }, 'reindex-job'))

    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'note-1', 'reindex-job', { forceFileReprocess: true })
  })

  it('re-copies a file root from the user’s original before its index is torn down', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createFileItem(FILE_ITEM_ID)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([root])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: [FILE_ITEM_ID] }, 'reindex-job'))

    // Overwrites the pinned relativePath rather than reserving a new name — otherwise every
    // refresh would mint a `source_1.pdf` twin and orphan the previous copy.
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'kb-1',
      '/docs/source.pdf',
      FILE_RELATIVE_PATH,
      expect.objectContaining({ overwrite: true })
    )
    expect(copyFileIntoKnowledgeBaseAtMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMaterialsMock.mock.invocationCallOrder[0]
    )
  })

  it('re-fetches a url root and overwrites its captured snapshot with the new page', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createUrlItem('url-1', 'example-page.md' as PosixRelativeFilePath)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([root])
    fetchKnowledgeWebPageMock.mockResolvedValue({ title: 'Updated', markdown: '# Updated\n\nfresh body' })

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['url-1'] }, 'reindex-job'))

    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledWith('https://example.com', expect.anything())
    const [baseId, relativePath, fileText, options] = writeFileIntoKnowledgeBaseAtMock.mock.calls[0]
    expect([baseId, relativePath, options]).toEqual(['kb-1', 'example-page.md', { overwrite: true }])
    expect(fileText).toContain('fresh body')
  })

  it('rewrites a note root’s snapshot from data.content, the note’s source of truth', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createNoteItem('note-1')
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([root])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['note-1'] }, 'reindex-job'))

    const [baseId, relativePath, fileText, options] = writeFileIntoKnowledgeBaseAtMock.mock.calls[0]
    expect([baseId, relativePath, options]).toEqual(['kb-1', 'note-1.md', { overwrite: true }])
    expect(fileText).toContain('hello note-1')
  })

  it('leaves a never-captured url to the index job’s first-index capture instead of re-acquiring', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createUrlItem('url-1')
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([root])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['url-1'] }, 'reindex-job'))

    expect(fetchKnowledgeWebPageMock).not.toHaveBeenCalled()
    expect(writeFileIntoKnowledgeBaseAtMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'url-1', 'reindex-job', { forceFileReprocess: true })
  })

  it('fails a url root loudly when its page can no longer be fetched, before anything is reset', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createUrlItem('url-1', 'example-page.md' as PosixRelativeFilePath)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([root])
    fetchKnowledgeWebPageMock.mockRejectedValue(new Error('404 Not Found'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['url-1'] }, 'reindex-job'))).rejects.toThrow(
      '404 Not Found'
    )

    // The root is still `completed` at this point, so the reset-side onSettled recovery would never
    // pick it up — without this explicit flip the user's refresh click would look like a no-op.
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['url-1'], 'failed', {
      error: '404 Not Found'
    })
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('activates every root before replacing any bytes, so a mid-write failure leaves none completed', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createNoteItem('note-1'), createNoteItem('note-2')])
    writeFileIntoKnowledgeBaseAtMock.mockResolvedValueOnce('note-1.md').mockRejectedValueOnce(new Error('ENOSPC'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['note-1', 'note-2'] }, 'reindex-job'))
    ).rejects.toThrow('ENOSPC')

    // `completed` is the one status no recovery path revisits, so both roots must leave it before
    // the first byte is replaced: note-1's snapshot is already overwritten and note-2 is the write
    // that threw — either one left green would keep claiming an index it no longer matches.
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-2', 'processing')
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
  })

  it('re-acquires selected roots concurrently instead of serializing their fetches', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const first = createUrlItem('url-1', 'first.md' as PosixRelativeFilePath)
    const second = createUrlItem('url-2', 'second.md' as PosixRelativeFilePath)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([first, second])
    const events: string[] = []
    fetchKnowledgeWebPageMock.mockImplementation(async () => {
      events.push('start')
      await Promise.resolve()
      events.push('end')
      return { title: 'Updated', markdown: '# Updated' }
    })

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['url-1', 'url-2'] }, 'reindex-job'))

    // Serialized producers interleave as start/end/start/end, multiplying a bulk refresh by the
    // per-page fetch latency until it exceeds the job timeout — and the timeout is retryable.
    expect(events).toEqual(['start', 'start', 'end', 'end'])
  })

  it('records every failed producer, so one dead page does not hide the others', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const first = createUrlItem('url-1', 'first.md' as PosixRelativeFilePath)
    const second = createUrlItem('url-2', 'second.md' as PosixRelativeFilePath)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([first, second])
    fetchKnowledgeWebPageMock
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['url-1', 'url-2'] }, 'reindex-job'))
    ).rejects.toThrow('404 Not Found')

    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['url-1'], 'failed', {
      error: '404 Not Found'
    })
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['url-2'], 'failed', {
      error: '503 Service Unavailable'
    })
  })

  it('leaves a root aborted mid-fetch untouched, and keeps the diagnosis of one that genuinely failed', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const dead = createUrlItem('url-1', 'dead.md' as PosixRelativeFilePath)
    const aborted = createUrlItem('url-2', 'aborted.md' as PosixRelativeFilePath)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([dead, aborted])
    const controller = new AbortController()
    const ctx = {
      ...createCtx({ baseId: 'kb-1', rootItemIds: ['url-1', 'url-2'] }, 'reindex-job'),
      signal: controller.signal
    }
    let onDeadRecorded: () => void = () => {}
    const deadRecorded = new Promise<void>((resolve) => {
      onDeadRecorded = resolve
    })
    knowledgeItemSetSubtreeStatusMock.mockImplementation(() => {
      onDeadRecorded()
      return []
    })
    fetchKnowledgeWebPageMock.mockRejectedValueOnce(new Error('404 Not Found')).mockImplementationOnce(async () => {
      await deadRecorded
      controller.abort(new Error('JobManager shutdown'))
      throw new Error('JobManager shutdown')
    })

    await expect(handler.execute(ctx)).rejects.toThrow('404 Not Found')

    // url-2 was never touched: its snapshot and vectors are intact, and `failed` would drop it out
    // of search (query/visibility.ts keeps only completed items) for a refresh that did nothing.
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledTimes(1)
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['url-1'], 'failed', {
      error: '404 Not Found'
    })
  })

  it('stands down without touching anything when the reindex is cancelled before the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createNoteItem('note-1')])
    const controller = new AbortController()
    const ctx = {
      ...createCtx({ baseId: 'kb-1', rootItemIds: ['note-1'] }, 'reindex-job'),
      signal: controller.signal
    }
    // Re-acquisition and the wait for the lock are the long stretches; a quit landing in either
    // must not still spend the reset on a root that is untouched and correctly indexed.
    knowledgeLockManager.runExclusive.mockImplementationOnce(async (_key: string, task: () => Promise<unknown>) => {
      controller.abort(new Error('JobManager shutdown'))
      return await task()
    })

    await expect(handler.execute(ctx)).rejects.toThrow('JobManager shutdown')

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(writeFileIntoKnowledgeBaseAtMock).not.toHaveBeenCalled()
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
  })

  it('marks only unscheduled reset roots failed when rescheduling fails', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const firstRoot = createDirectoryItem('dir-1')
    const secondRoot = createDirectoryItem('dir-2')
    const firstChild = createNoteItem('note-1', 'dir-1')
    const secondChild = createNoteItem('note-2', 'dir-2')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [firstChild, secondChild]
        if (options.includeRoots) return [firstRoot, firstChild, secondRoot, secondChild]
        return [firstChild, secondChild]
      }
    )
    scheduleItemMock.mockResolvedValueOnce({ id: 'job-dir-1' }).mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', 'dir-2'] }, 'reindex-job'))
    ).rejects.toThrow('enqueue failed')

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-2', 'preparing')
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-2'], 'failed', {
      error: 'Failed to schedule reindex after reset: enqueue failed'
    })
  })

  it('never fails a left-untouched missing-source root when rescheduling a rebuildable root fails', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const presentRoot = createDirectoryItem('dir-1')
    const presentChild = createNoteItem('note-1', 'dir-1')
    const missingRoot = createDirectoryItem('dir-2')
    const missingChild = createNoteItem('note-2', 'dir-2')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.includeRoots && options.leafOnly) return rootIds.includes('dir-1') ? [presentChild] : []
        if (options.includeRoots) return [presentRoot, presentChild, missingRoot, missingChild]
        return rootIds.includes('dir-1') ? [presentChild] : []
      }
    )
    probeKnowledgeSourcePathMock.mockImplementation(async (absolutePath: string) =>
      absolutePath === '/dir-1' ? 'readable' : 'missing'
    )
    scheduleItemMock.mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', 'dir-2'] }, 'reindex-job'))
    ).rejects.toThrow('enqueue failed')

    // Only the rebuildable root that was reset-but-not-scheduled is failed; the missing-source
    // root (dir-2) was never reset and keeps its vectors, so it must not be flipped to failed.
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1'], 'failed', {
      error: 'Failed to schedule reindex after reset: enqueue failed'
    })
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalledWith(
      'kb-1',
      ['dir-1', 'dir-2'],
      'failed',
      expect.anything()
    )
  })

  it('stores the localized interruption code when a shutdown abort interrupts rescheduling', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )

    // A deliberate quit aborts the job's signal mid-reset; the abort then surfaces at the
    // scheduling loop's throwIfAborted, so scheduleItem is never reached and the reset root is
    // left unscheduled — the path that must store a localized code, not a raw English string.
    const controller = new AbortController()
    const ctx = { ...createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'), signal: controller.signal }
    knowledgeItemUpdateStatusMock.mockImplementation(() => {
      controller.abort(new Error('JobManager shutdown'))
      return root
    })

    await expect(handler.execute(ctx)).rejects.toThrow('JobManager shutdown')

    expect(scheduleItemMock).not.toHaveBeenCalled()
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1'], 'failed', {
      error: KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
    })
  })

  it('onSettled marks active roots without follow-up jobs failed', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    listMock.mockResolvedValue([])
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([
      createDirectoryItem('dir-1', 'preparing'),
      createNoteItem('note-1', null, 'processing')
    ])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      parentId: null,
      status: 'failed',
      input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'note-1'] },
      error: { code: 'FAILED', message: 'reset failed', retryable: false },
      attempt: 3,
      metadata: {}
    })

    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'], 'failed', {
      error: 'Reindex job failed: reset failed'
    })
  })

  it('onSettled stores the localized interruption code when the reindex job was cancelled', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    listMock.mockResolvedValue([])
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([
      createDirectoryItem('dir-1', 'preparing'),
      createNoteItem('note-1', null, 'processing')
    ])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      parentId: null,
      status: 'cancelled',
      input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'note-1'] },
      error: { code: 'CANCELLED', message: 'JobManager shutdown', retryable: false },
      attempt: 1,
      metadata: {}
    })

    // A quit-cancelled reindex stores the bare error code (not "Reindex job cancelled: …") so the
    // data-source tooltip localizes it instead of leaking the internal abort string into zh-cn/zh-tw.
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'], 'failed', {
      error: KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
    })
  })

  it('onSettled skips deleting roots and roots with follow-up jobs', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'prepare-dir-1',
        type: 'knowledge.prepare-root',
        parentId: 'reindex-job',
        input: { baseId: 'kb-1', itemId: 'dir-1' }
      })
    ])
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([
      createDirectoryItem('dir-1', 'preparing'),
      createNoteItem('note-1', null, 'deleting')
    ])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      parentId: null,
      status: 'cancelled',
      input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'note-1'] },
      error: { code: 'CANCELLED', message: 'cancelled', retryable: false },
      attempt: 1,
      metadata: {}
    })

    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })

  it('onSettled treats file-processing check jobs as follow-up jobs', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, ingestionService)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'check-file-1',
        type: 'knowledge.check-file-processing-result',
        parentId: 'reindex-job',
        input: {
          baseId: 'kb-1',
          itemId: FILE_ITEM_ID,
          fileProcessingJobId: 'fp-job-1',
          pollRound: 0,
          firstScheduledAt: 1779811200000,
          processedRelativePath: 'source.md'
        }
      })
    ])
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createFileItem(FILE_ITEM_ID, 'processing')])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      parentId: null,
      status: 'failed',
      input: { baseId: 'kb-1', rootItemIds: [FILE_ITEM_ID] },
      error: { code: 'FAILED', message: 'reset failed', retryable: false },
      attempt: 3,
      metadata: {}
    })

    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })
})
