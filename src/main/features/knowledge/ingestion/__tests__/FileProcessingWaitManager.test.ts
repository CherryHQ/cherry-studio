import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingTask, FileProcessingTaskId } from '@main/features/fileProcessing'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileProcessingWaitManager } = await import('../FileProcessingWaitManager')

const ITEM_PROGRESS_KEY = 'knowledge.item.file_processing_progress.file-1'

function taskId(id: string): FileProcessingTaskId {
  return id as FileProcessingTaskId
}

function processing(id: string, progress: number): FileProcessingTask {
  return { id: taskId(id), feature: 'document_to_markdown', processorId: 'doc2x', status: 'processing', progress }
}

function itemProgressBroadcasts(): unknown[] {
  return MockMainCacheServiceUtils.getBroadcastHistory()
    .map(({ message }) => message)
    .filter((message) => 'key' in message && message.key === ITEM_PROGRESS_KEY)
}

describe('FileProcessingWaitManager', () => {
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
  })

  it('mirrors a task’s progress onto its item, broadcasting only values that changed', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', taskId('fp-task-1'))

    waits.mirrorProgress(processing('fp-task-1', 10))
    waits.mirrorProgress(processing('fp-task-1', 10))
    waits.mirrorProgress(processing('fp-task-1', 42))

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBe(42)
    expect(itemProgressBroadcasts()).toHaveLength(2)
  })

  it('shows no percentage while the task is still queued', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', taskId('fp-task-1'))

    waits.mirrorProgress({
      id: taskId('fp-task-1'),
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'queued'
    })

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBeUndefined()
    expect(itemProgressBroadcasts()).toHaveLength(0)
  })

  it('ignores progress of a task no item waits on', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', taskId('fp-task-1'))

    waits.mirrorProgress(processing('fp-task-2', 50))

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBeUndefined()
  })

  it('clears the item’s percentage when its wait ends and stops mirroring it', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', taskId('fp-task-1'))
    waits.mirrorProgress(processing('fp-task-1', 42))

    waits.delete('file-1')
    waits.mirrorProgress(processing('fp-task-1', 60))

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBeUndefined()
    expect(waits.has('file-1')).toBe(false)
  })

  it('lists the tasks waited on in one base, limited to the given items when asked', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', taskId('fp-task-1'))
    waits.add('kb-1', 'file-2', taskId('fp-task-2'))
    waits.add('kb-2', 'file-3', taskId('fp-task-3'))

    expect(waits.taskIds('kb-1')).toEqual(['fp-task-1', 'fp-task-2'])
    expect(waits.taskIds('kb-1', new Set(['file-2', 'file-3']))).toEqual(['fp-task-2'])
  })
})
