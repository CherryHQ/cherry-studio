import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileProcessingWaitManager } = await import('../FileProcessingWaitManager')

const ITEM_PROGRESS_KEY = 'knowledge.item.file_processing_progress.file-1'

function itemProgressBroadcasts(): unknown[] {
  return MockMainCacheServiceUtils.getBroadcastHistory()
    .map(({ message }) => message)
    .filter((message) => 'key' in message && message.key === ITEM_PROGRESS_KEY)
}

describe('FileProcessingWaitManager', () => {
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
  })

  it('mirrors a job’s progress onto its item, broadcasting only values that changed', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')

    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', { progress: 10 })
    waits.mirrorProgress()
    waits.mirrorProgress()
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', { progress: 42 })
    waits.mirrorProgress()

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBe(42)
    expect(itemProgressBroadcasts()).toHaveLength(2)
  })

  it('shows no percentage while the job has reported none, such as when it is still queued', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')

    waits.mirrorProgress()

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBeUndefined()
    expect(itemProgressBroadcasts()).toHaveLength(0)
  })

  it('clears the item’s percentage when its wait ends and stops mirroring it', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', { progress: 42 })
    waits.mirrorProgress()

    waits.delete('file-1')
    waits.mirrorProgress()

    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBeUndefined()
    expect(waits.has('file-1')).toBe(false)
  })

  it('lists the jobs waited on in one base, limited to the given items when asked', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')
    waits.add('kb-1', 'file-2', 'fp-job-2')
    waits.add('kb-2', 'file-3', 'fp-job-3')

    expect(waits.jobIds('kb-1')).toEqual(['fp-job-1', 'fp-job-2'])
    expect(waits.jobIds('kb-1', new Set(['file-2', 'file-3']))).toEqual(['fp-job-2'])
  })
})
