import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listJobsMock, getByIdMock } = vi.hoisted(() => ({
  listJobsMock: vi.fn(),
  getByIdMock: vi.fn()
}))

vi.mock('@data/services/JobService', () => ({
  jobService: {
    list: listJobsMock,
    getById: getByIdMock
  }
}))

import { jobHandlers } from '../jobs'

const JOB_ID = '11111111-1111-4111-8111-111111111111'

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    type: 'knowledge.ingest',
    status: 'completed',
    priority: 0,
    queue: 'default',
    idempotencyKey: null,
    scheduleId: null,
    scheduledAt: '2025-06-01T00:00:00.000Z',
    startedAt: '2025-06-01T00:00:01.000Z',
    finishedAt: '2025-06-01T00:01:00.000Z',
    attempt: 0,
    maxAttempts: 3,
    input: {},
    output: null,
    error: null,
    parentId: null,
    cancelRequested: false,
    metadata: {},
    timeoutMs: null,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:01:00.000Z',
    ...overrides
  }
}

describe('jobHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── GET /jobs ──────────────────────────────────────────────────────

  describe('/jobs', () => {
    it('should delegate GET to jobService.list with empty query', async () => {
      listJobsMock.mockResolvedValueOnce([])

      const result = await jobHandlers['/jobs'].GET({ query: {} } as never)

      expect(listJobsMock).toHaveBeenCalledWith({
        status: undefined,
        queue: undefined,
        type: undefined,
        scheduleId: undefined,
        limit: undefined,
        offset: undefined
      })
      expect(result).toEqual([])
    })

    it('should pass status filter as parsed array', async () => {
      listJobsMock.mockResolvedValueOnce([])

      await jobHandlers['/jobs'].GET({ query: { status: 'pending,running' } } as never)

      expect(listJobsMock).toHaveBeenCalledWith(expect.objectContaining({ status: ['pending', 'running'] }))
    })

    it('should pass single status as single-element array', async () => {
      listJobsMock.mockResolvedValueOnce([])

      await jobHandlers['/jobs'].GET({ query: { status: 'failed' } } as never)

      expect(listJobsMock).toHaveBeenCalledWith(expect.objectContaining({ status: ['failed'] }))
    })

    it('should pass all query filters to jobService.list', async () => {
      listJobsMock.mockResolvedValueOnce([])

      await jobHandlers['/jobs'].GET({
        query: {
          status: 'completed',
          queue: 'ingest',
          type: 'knowledge.ingest',
          scheduleId: 'sched-1',
          limit: '50',
          offset: '10'
        }
      } as never)

      expect(listJobsMock).toHaveBeenCalledWith({
        status: ['completed'],
        queue: 'ingest',
        type: 'knowledge.ingest',
        scheduleId: 'sched-1',
        limit: 50,
        offset: 10
      })
    })

    it('should reject invalid status value', async () => {
      await expect(jobHandlers['/jobs'].GET({ query: { status: 'invalid_status' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
    })

    it('should reject limit below 1', async () => {
      await expect(jobHandlers['/jobs'].GET({ query: { limit: '0' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
    })

    it('should reject limit above 500', async () => {
      await expect(jobHandlers['/jobs'].GET({ query: { limit: '501' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
    })

    it('should reject negative offset', async () => {
      await expect(jobHandlers['/jobs'].GET({ query: { offset: '-1' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
    })

    it('should return job snapshots from list', async () => {
      const snapshots = [makeSnapshot({ id: 'job-1' }), makeSnapshot({ id: 'job-2' })]
      listJobsMock.mockResolvedValueOnce(snapshots)

      const result = await jobHandlers['/jobs'].GET({ query: {} } as never)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('job-1')
      expect(result[1].id).toBe('job-2')
    })
  })

  // ── GET /jobs/:id ──────────────────────────────────────────────────

  describe('/jobs/:id', () => {
    it('should delegate GET to jobService.getById', async () => {
      const snapshot = makeSnapshot()
      getByIdMock.mockResolvedValueOnce(snapshot)

      const result = await jobHandlers['/jobs/:id'].GET({ params: { id: JOB_ID } } as never)

      expect(getByIdMock).toHaveBeenCalledWith(JOB_ID)
      expect(result).toEqual(snapshot)
    })

    it('should return 404 when job does not exist', async () => {
      getByIdMock.mockResolvedValueOnce(null)

      await expect(jobHandlers['/jobs/:id'].GET({ params: { id: 'nonexistent' } } as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
