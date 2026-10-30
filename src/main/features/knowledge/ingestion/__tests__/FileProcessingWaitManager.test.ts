import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileProcessingWaitManager } = await import('../FileProcessingWaitManager')

const ITEM_PROGRESS_KEY = 'knowledge.item.file_processing_state.file-1'

function itemProgressBroadcasts(): unknown[] {
  return MockMainCacheServiceUtils.getBroadcastHistory()
    .map(({ message }) => message)
    .filter((message) => 'key' in message && message.key === ITEM_PROGRESS_KEY)
}

describe('FileProcessingWaitManager', () => {
  let now: number
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => vi.restoreAllMocks())

  it('publishes stage, progress and advancing elapsed time even at unchanged progress', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', {
      progress: 0,
      detail: { stage: 'queued' }
    })
    waits.mirrorProgress()
    waits.mirrorProgress()
    expect(itemProgressBroadcasts()).toHaveLength(1)
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
      stage: 'queued',
      progress: 0,
      elapsedMs: 0
    })
    now += 5000
    waits.mirrorProgress()
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
      stage: 'queued',
      progress: 0,
      elapsedMs: 5000
    })
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', {
      progress: 0,
      detail: { stage: 'parsing' }
    })
    waits.mirrorProgress()
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
      stage: 'parsing',
      progress: 0,
      elapsedMs: 5000
    })
    expect(itemProgressBroadcasts()).toHaveLength(3)
  })

  it('publishes unknown state before the first report and after the source disappears', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')
    now += 5000
    waits.mirrorProgress()
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
      stage: null,
      progress: null,
      elapsedMs: 5000
    })
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', {
      progress: 25,
      detail: { stage: 'parsing' }
    })
    waits.mirrorProgress()
    MockMainCacheServiceExport.cacheService.deleteShared('jobs.progress.fp-job-1')
    now += 5000
    waits.mirrorProgress()
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
      stage: null,
      progress: null,
      elapsedMs: 10000
    })
  })

  it.each([undefined, null, 'queued', 42, { stage: 'started' }, { stage: 'polling' }])(
    'rejects unsupported stage detail %j',
    (detail) => {
      const waits = new FileProcessingWaitManager()
      waits.add('kb-1', 'file-1', 'fp-job-1')
      MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', { progress: 42, detail })
      waits.mirrorProgress()
      expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
        stage: null,
        progress: 42,
        elapsedMs: 0
      })
    }
  )

  it('removes the previous badge and resets elapsed when replacing a wait', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', {
      progress: 42,
      detail: { stage: 'parsing' }
    })
    waits.mirrorProgress()
    now += 5000
    waits.add('kb-1', 'file-1', 'fp-job-2')
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toBeUndefined()
    now += 1000
    waits.mirrorProgress()
    expect(MockMainCacheServiceUtils.getSharedCacheValue(ITEM_PROGRESS_KEY)).toEqual({
      stage: null,
      progress: null,
      elapsedMs: 1000
    })
  })

  it('clears the published state when its wait ends and ignores later reports', () => {
    const waits = new FileProcessingWaitManager()
    waits.add('kb-1', 'file-1', 'fp-job-1')
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', { progress: 42 })
    waits.mirrorProgress()
    waits.delete('file-1')
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', {
      progress: 99,
      detail: { stage: 'converting' }
    })
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
