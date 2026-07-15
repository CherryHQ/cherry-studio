import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KNOWLEDGE_ACTIVE_JOB_LIMIT } from '../../../types'

const { cancelMock, listMock, knowledgeItemGetSubtreeItemsMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  listMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: cancelMock,
      list: listMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock
  }
}))

const { cancelActiveKnowledgeJobs } = await import('../cancel')

type JobSnapshotInput = Pick<JobSnapshot, 'type' | 'input'> & Partial<JobSnapshot>

function createJobSnapshot(overrides: JobSnapshotInput): JobSnapshot {
  return {
    id: 'job-1',
    status: 'running',
    priority: 0,
    queue: 'base.kb-1',
    idempotencyKey: null,
    scheduleId: null,
    scheduledAt: '2026-04-08T00:00:00.000Z',
    startedAt: '2026-04-08T00:00:00.000Z',
    finishedAt: null,
    attempt: 1,
    maxAttempts: 3,
    output: null,
    error: null,
    parentId: null,
    cancelRequested: false,
    metadata: {},
    timeoutMs: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides
  }
}

function createItem(id: string): KnowledgeItem {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { source: 'note', content: 'text' },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('cancelActiveKnowledgeJobs', () => {
  beforeEach(() => {
    cancelMock.mockReset().mockResolvedValue({ outcome: 'cancelled' })
    listMock.mockReset().mockResolvedValue([])
    knowledgeItemGetSubtreeItemsMock.mockReset()
  })

  it('cancels every active knowledge job in the base queue when scoped base-wide', async () => {
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'prepare-job',
        type: 'knowledge.prepare-root',
        input: { baseId: 'kb-1', itemId: 'dir-1' }
      }),
      createJobSnapshot({
        id: 'check-job',
        type: 'knowledge.check-file-processing-result',
        input: {
          baseId: 'kb-1',
          itemId: 'file-1',
          fileProcessingJobId: 'fp-job-1',
          pollRound: 0,
          firstScheduledAt: 1779811200000,
          processedRelativePath: 'source.md'
        }
      })
    ])

    await cancelActiveKnowledgeJobs('kb-1', 'delete-base', { onCancelTimeout: 'proceed' })

    expect(knowledgeItemGetSubtreeItemsMock).not.toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalledWith('prepare-job', 'delete-base')
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'delete-base')
  })

  it('returns without listing jobs when the requested subtree resolves empty', async () => {
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([])

    await cancelActiveKnowledgeJobs('kb-1', 'knowledge-delete-subtree', {
      rootItemIds: ['missing-root'],
      onCancelTimeout: 'throw'
    })

    expect(listMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('scopes cancellation to jobs touching the resolved subtree and excludes the given job id', async () => {
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createItem('dir-1'), createItem('note-1')])
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'current-job',
        type: 'knowledge.delete-subtree',
        input: { baseId: 'kb-1', rootItemIds: ['dir-1'] }
      }),
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1' }
      }),
      createJobSnapshot({
        id: 'unrelated-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'other' }
      })
    ])

    await cancelActiveKnowledgeJobs('kb-1', 'knowledge-delete-subtree', {
      rootItemIds: ['dir-1'],
      excludeJobId: 'current-job',
      onCancelTimeout: 'throw'
    })

    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith('index-job', 'knowledge-delete-subtree')
  })

  it('cancels a scoped target even when it trails a full window of unrelated active jobs', async () => {
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createItem('target')])
    // More unrelated active jobs than the base-wide page window, with the only subtree
    // match at the very end. A windowed read (limit KNOWLEDGE_ACTIVE_JOB_LIMIT) that
    // broke when a full page missed the subtree would never reach it; the unbounded
    // scoped read sees it.
    const jobs = [
      ...Array.from({ length: KNOWLEDGE_ACTIVE_JOB_LIMIT }, (_, index) =>
        createJobSnapshot({
          id: `miss-${index}`,
          type: 'knowledge.index-documents',
          input: { baseId: 'kb-1', itemId: `other-${index}` }
        })
      ),
      createJobSnapshot({
        id: 'target-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'target' }
      })
    ]
    listMock.mockResolvedValue(jobs)

    await cancelActiveKnowledgeJobs('kb-1', 'knowledge-delete-subtree', {
      rootItemIds: ['target'],
      onCancelTimeout: 'throw'
    })

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith('target-job', 'knowledge-delete-subtree')
  })

  it('throws when a scoped cancel times out', async () => {
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createItem('note-1')])
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1' }
      })
    ])
    cancelMock.mockResolvedValue({ outcome: 'timed-out' })

    await expect(
      cancelActiveKnowledgeJobs('kb-1', 'knowledge-delete-subtree', {
        rootItemIds: ['note-1'],
        onCancelTimeout: 'throw'
      })
    ).rejects.toThrow('Job cancel timed out: index-job')
  })

  it('does not throw on a cancel timeout when proceeding base-wide', async () => {
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1' }
      })
    ])
    cancelMock.mockResolvedValue({ outcome: 'timed-out' })

    await expect(
      cancelActiveKnowledgeJobs('kb-1', 'delete-base', { onCancelTimeout: 'proceed' })
    ).resolves.toBeUndefined()
  })

  it('drains a full page and re-queries until a page comes back short', async () => {
    const fullPage = Array.from({ length: KNOWLEDGE_ACTIVE_JOB_LIMIT }, (_, index) =>
      createJobSnapshot({
        id: `index-job-${index}`,
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: `note-${index}` }
      })
    )
    listMock.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([])

    await cancelActiveKnowledgeJobs('kb-1', 'delete-base', { onCancelTimeout: 'proceed' })

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(cancelMock).toHaveBeenCalledTimes(KNOWLEDGE_ACTIVE_JOB_LIMIT)
  })

  it('reads the scoped active set once and cancels nothing when it all misses the subtree', async () => {
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createItem('target')])
    // Every active job touches an item OUTSIDE the requested subtree, so there is nothing
    // to cancel. Scoped cancel makes a single unbounded read (no `limit`), so it never
    // re-queries and never spins.
    const misses = Array.from({ length: KNOWLEDGE_ACTIVE_JOB_LIMIT }, (_, index) =>
      createJobSnapshot({
        id: `index-job-${index}`,
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: `other-${index}` }
      })
    )
    listMock.mockResolvedValue(misses)

    await cancelActiveKnowledgeJobs('kb-1', 'knowledge-delete-subtree', {
      rootItemIds: ['target'],
      onCancelTimeout: 'throw'
    })

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(listMock).toHaveBeenCalledWith(expect.not.objectContaining({ limit: expect.anything() }))
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('stops after a single empty page without cancelling anything', async () => {
    listMock.mockResolvedValueOnce([])

    await cancelActiveKnowledgeJobs('kb-1', 'delete-base', { onCancelTimeout: 'proceed' })

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).not.toHaveBeenCalled()
  })
})
