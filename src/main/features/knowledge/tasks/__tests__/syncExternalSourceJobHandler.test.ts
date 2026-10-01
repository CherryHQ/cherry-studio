import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext, JobSettledEvent } from '@main/core/job/types'
import { SERVICE_STOP_TIMEOUT_MS } from '@main/core/lifecycle'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'

import {
  ExternalKnowledgeSourceSyncError,
  type ExternalKnowledgeSourceSyncSummary
} from '../../external/ExternalKnowledgeSyncService'
import type { KnowledgeSyncExternalSourcePayload } from '../jobTypes'

const { settleSyncTxMock, notifyDataChangeMock, withWriteTxMock } = vi.hoisted(() => ({
  settleSyncTxMock: vi.fn(),
  notifyDataChangeMock: vi.fn(),
  withWriteTxMock: vi.fn((fn: (tx: object) => unknown) => fn({}))
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ DbService: { withWriteTx: withWriteTxMock } })
})

vi.mock('@data/services/ExternalKnowledgeSourceService', () => ({
  externalKnowledgeSourceService: { settleSyncTx: settleSyncTxMock }
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataChangeMock }))

const { createSyncExternalSourceJobHandler } = await import('../syncExternalSourceJobHandler')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abc'
const JOB_ID = '0198f3f2-7d12-7abc-8def-123456789abc'

const payload: KnowledgeSyncExternalSourcePayload = {
  baseId: BASE_ID,
  sourceId: SOURCE_ID,
  sourceRevision: 3,
  trigger: 'manual'
}

const scheduleEnvelope = { ...payload, trigger: 'scheduled' as const, dispatch: 'schedule' as const }

const summary = (overrides: Partial<ExternalKnowledgeSourceSyncSummary> = {}): ExternalKnowledgeSourceSyncSummary => ({
  scannedCount: 4,
  indexedCount: 1,
  unchangedCount: 2,
  skippedCount: 1,
  warningCount: 1,
  warnings: [{ code: 'transient', remoteObjectId: 'doc-1' }],
  ...overrides
})

const createJobRun = (signal = new AbortController().signal): JobContext<KnowledgeSyncExternalSourcePayload> => ({
  jobId: JOB_ID,
  input: payload,
  attempt: 0,
  parentId: null,
  signal,
  metadata: {},
  patchMetadata: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as JobContext['logger']
})

const settledEvent = (
  overrides: Partial<JobSettledEvent<KnowledgeSyncExternalSourcePayload>> = {}
): JobSettledEvent<KnowledgeSyncExternalSourcePayload> => ({
  jobId: JOB_ID,
  type: 'knowledge.sync-external-source',
  scheduleId: null,
  parentId: null,
  status: 'completed',
  input: payload,
  output: summary({ warningCount: 0, warnings: [] }),
  error: null,
  attempt: 0,
  metadata: {},
  ...overrides
})

describe('sync-external-source job handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settleSyncTxMock.mockReturnValue(true)
    withWriteTxMock.mockImplementation((fn: (tx: object) => unknown) => fn({}))
  })

  it('runs the complete source synchronization with a fenced payload and safe output', async () => {
    const syncSource = vi.fn().mockResolvedValue(summary())
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })
    const jobRun = createJobRun()

    await expect(handler.execute(jobRun)).resolves.toEqual(summary())
    expect(syncSource).toHaveBeenCalledWith({
      fence: { baseId: BASE_ID, sourceId: SOURCE_ID, expectedSourceRevision: 3, activeJobId: JOB_ID },
      signal: jobRun.signal,
      reportProgress: expect.any(Function)
    })
    expect(jobRun.reportProgress).toHaveBeenCalledWith(0, { stage: 'scanning' })
    expect(notifyDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/external-knowledge-sources/:id/documents',
        kind: 'membership',
        routeParams: { id: SOURCE_ID }
      },
      { endpoint: '/external-knowledge-documents/:id' },
      { endpoint: '/knowledge-bases/:id/items', kind: 'membership', routeParams: { id: BASE_ID } },
      { endpoint: '/knowledge-items/:id' }
    ])
    expect(JSON.stringify(jobRun)).not.toContain('secret-provider-payload')
    expect(handler).toMatchObject({
      recovery: 'abandon',
      defaultConcurrency: 5,
      defaultRetryPolicy: {
        maxAttempts: 3,
        backoff: 'exponential',
        baseDelayMs: 1000,
        maxDelayMs: 30_000
      },
      defaultTimeoutMs: 30 * 60 * 1000,
      cancelTimeoutMs: expect.any(Number)
    })
    expect(handler.cancelTimeoutMs).toBeGreaterThan(0)
    expect(handler.cancelTimeoutMs).toBeLessThanOrEqual(SERVICE_STOP_TIMEOUT_MS / 2)
    expect(handler.defaultQueue?.(payload)).toBe(`base.${BASE_ID}`)
  })

  it('classifies a natural envelope as scheduled even though its persisted scheduledAt is non-null', async () => {
    const syncSource = vi.fn()
    const dispatchScheduledEnvelope = vi.fn().mockResolvedValue(undefined)
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123, dispatchScheduledEnvelope })
    const jobRun = { ...createJobRun(), input: scheduleEnvelope }

    handler.onEnqueued?.({
      id: JOB_ID,
      scheduleId: 'schedule-1',
      scheduledAt: '2026-09-21T09:05:00.000Z',
      input: scheduleEnvelope
    } as never)
    await expect(handler.execute(jobRun)).resolves.toBeUndefined()
    await handler.onSettled?.(settledEvent({ input: scheduleEnvelope, scheduleId: 'schedule-1' }))

    expect(dispatchScheduledEnvelope).toHaveBeenCalledWith(scheduleEnvelope, 'scheduled')
    expect(syncSource).not.toHaveBeenCalled()
    expect(settleSyncTxMock).not.toHaveBeenCalled()
    expect(notifyDataChangeMock).not.toHaveBeenCalled()
  })

  it('classifies JobManager catch-up as a startup envelope while keeping the same handler', async () => {
    const dispatchScheduledEnvelope = vi.fn().mockResolvedValue(undefined)
    const handler = createSyncExternalSourceJobHandler(
      { syncSource: vi.fn() },
      { now: () => 123, dispatchScheduledEnvelope }
    )

    await handler.onMissed?.({
      scheduleId: 'schedule-1',
      type: 'knowledge.sync-external-source',
      missedCount: 1,
      lastFireAt: 1
    })
    handler.onEnqueued?.({ id: JOB_ID, scheduleId: 'schedule-1', input: scheduleEnvelope } as never)
    await handler.execute({ ...createJobRun(), input: scheduleEnvelope })

    expect(dispatchScheduledEnvelope).toHaveBeenCalledWith(scheduleEnvelope, 'startup')
  })

  it('publishes content read models only after synchronization finishes', async () => {
    let finishSync: ((value: ExternalKnowledgeSourceSyncSummary) => void) | undefined
    const syncSource = vi.fn().mockImplementation(
      () =>
        new Promise<ExternalKnowledgeSourceSyncSummary>((resolve) => {
          finishSync = resolve
        })
    )
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })

    const execution = handler.execute(createJobRun())
    await vi.waitFor(() => expect(syncSource).toHaveBeenCalledOnce())

    expect(notifyDataChangeMock).not.toHaveBeenCalled()
    finishSync?.(summary())
    await execution
    expect(notifyDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/external-knowledge-sources/:id/documents',
        kind: 'membership',
        routeParams: { id: SOURCE_ID }
      },
      { endpoint: '/external-knowledge-documents/:id' },
      { endpoint: '/knowledge-bases/:id/items', kind: 'membership', routeParams: { id: BASE_ID } },
      { endpoint: '/knowledge-items/:id' }
    ])
  })

  it('rejects an invalid success result before provider payload can reach job output', async () => {
    const syncSource = vi.fn().mockResolvedValue({ ...summary(), providerPayload: 'secret-provider-payload' })
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })
    const jobRun = createJobRun()

    const error = await handler.execute(jobRun).catch((cause) => cause)

    expect(error).toMatchObject({ message: 'External knowledge source synchronization failed: unexpected' })
    expect(JSON.stringify([error, (jobRun.patchMetadata as ReturnType<typeof vi.fn>).mock.calls])).not.toContain(
      'secret-provider-payload'
    )
  })

  it('persists only a stable code and safe partial summary for a classified failure', async () => {
    const partial = summary({ indexedCount: 0 })
    const syncSource = vi
      .fn()
      .mockRejectedValue(new ExternalKnowledgeSourceSyncError('credential-unavailable', partial))
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })
    const jobRun = createJobRun()

    const error = await handler.execute(jobRun).catch((cause) => cause)

    expect(jobRun.patchMetadata).toHaveBeenCalledWith({
      externalKnowledgeSync: { code: 'credential-unavailable', summary: partial }
    })
    expect(error).toMatchObject({ message: 'External knowledge source synchronization failed: credential-unavailable' })
    expect(JSON.stringify([error, (jobRun.patchMetadata as ReturnType<typeof vi.fn>).mock.calls])).not.toContain(
      'secret-provider-payload'
    )
    expect(notifyDataChangeMock).toHaveBeenCalled()
  })

  it('sanitizes an unexpected provider failure before it reaches JobManager state', async () => {
    const syncSource = vi.fn().mockRejectedValue(new Error('provider leaked secret-provider-payload'))
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })
    const jobRun = createJobRun()

    const error = await handler.execute(jobRun).catch((cause) => cause)

    expect(jobRun.patchMetadata).toHaveBeenCalledWith({
      externalKnowledgeSync: {
        code: 'unexpected',
        summary: { scannedCount: 0, indexedCount: 0, unchangedCount: 0, skippedCount: 0, warningCount: 0, warnings: [] }
      }
    })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('External knowledge source synchronization failed: unexpected')
    expect(JSON.stringify([error, (jobRun.patchMetadata as ReturnType<typeof vi.fn>).mock.calls])).not.toContain(
      'secret-provider-payload'
    )
    expect(jobRun.logger.warn).toHaveBeenCalledWith(
      'External knowledge synchronization failed with an unexpected error'
    )
    expect(JSON.stringify((jobRun.logger.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'secret-provider-payload'
    )
  })

  it('treats a cancelled service error as unexpected while the job signal remains active', async () => {
    const syncSource = vi
      .fn()
      .mockRejectedValue(new ExternalKnowledgeSourceSyncError('cancelled', summary({ indexedCount: 0 })))
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })
    const jobRun = createJobRun()

    const error = await handler.execute(jobRun).catch((cause) => cause)

    expect(jobRun.signal.aborted).toBe(false)
    expect(jobRun.patchMetadata).toHaveBeenCalledWith({
      externalKnowledgeSync: { code: 'unexpected', summary: summary({ indexedCount: 0 }) }
    })
    expect(error).toMatchObject({ message: 'External knowledge source synchronization failed: unexpected' })
    expect(jobRun.logger.warn).toHaveBeenCalledWith(
      'External knowledge synchronization reported cancellation without an aborted job signal'
    )
  })

  it('rethrows the original cancellation reason after persisting safe partial progress', async () => {
    const reason = new Error('Job cancelled by user')
    const controller = new AbortController()
    controller.abort(reason)
    const syncSource = vi.fn().mockRejectedValue(new ExternalKnowledgeSourceSyncError('cancelled', summary()))
    const handler = createSyncExternalSourceJobHandler({ syncSource }, { now: () => 123 })
    const jobRun = createJobRun(controller.signal)

    await expect(handler.execute(jobRun)).rejects.toBe(reason)
    expect(jobRun.patchMetadata).toHaveBeenCalledWith({
      externalKnowledgeSync: { code: 'cancelled', summary: summary() }
    })
  })

  it.each([
    {
      name: 'clean completion',
      event: settledEvent(),
      expectedOutcome: 'completed',
      expectedError: null,
      expectedSummary: summary({ warningCount: 0, warnings: [] })
    },
    {
      name: 'completion with warnings',
      event: settledEvent({ output: summary() }),
      expectedOutcome: 'completed-with-warnings',
      expectedError: null,
      expectedSummary: summary()
    },
    {
      name: 'classified failure',
      event: settledEvent({
        status: 'failed',
        output: undefined,
        metadata: { externalKnowledgeSync: { code: 'scope-missing', summary: summary({ indexedCount: 0 }) } }
      }),
      expectedOutcome: 'failed',
      expectedError: 'scope-missing',
      expectedSummary: summary({ indexedCount: 0 })
    },
    {
      name: 'cancel without valid metadata',
      event: settledEvent({
        status: 'cancelled',
        output: undefined,
        metadata: { externalKnowledgeSync: { code: 'bad' } }
      }),
      expectedOutcome: 'cancelled',
      expectedError: 'cancelled',
      expectedSummary: {
        scannedCount: 0,
        indexedCount: 0,
        unchangedCount: 0,
        skippedCount: 0,
        warningCount: 0,
        warnings: []
      }
    }
  ])(
    'settles $name from strictly projected persisted state',
    async ({ event, expectedOutcome, expectedError, expectedSummary }) => {
      const handler = createSyncExternalSourceJobHandler({ syncSource: vi.fn() }, { now: () => 999 })

      await handler.onSettled?.(event)

      expect(settleSyncTxMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sourceId: SOURCE_ID,
          expectedRevision: 3,
          jobId: JOB_ID,
          finishedAt: 999,
          outcome: expectedOutcome,
          errorSummary: expectedError,
          scannedCount: expectedSummary.scannedCount,
          indexedCount: expectedSummary.indexedCount,
          unchangedCount: expectedSummary.unchangedCount,
          skippedCount: expectedSummary.skippedCount,
          warningCount: expectedSummary.warningCount
        })
      )
      expect(notifyDataChangeMock).toHaveBeenCalledWith([
        {
          endpoint: '/knowledge-bases/:id/external-knowledge-sources',
          kind: 'projection',
          routeParams: { id: BASE_ID },
          entityIds: [SOURCE_ID]
        },
        { endpoint: '/external-knowledge-sources/:id', routeParams: { id: SOURCE_ID }, entityIds: [SOURCE_ID] }
      ])
    }
  )

  it('does not notify when a stale revision or active job loses the settle fence', async () => {
    settleSyncTxMock.mockReturnValue(false)
    const handler = createSyncExternalSourceJobHandler({ syncSource: vi.fn() }, { now: () => 999 })

    await handler.onSettled?.(settledEvent())

    expect(notifyDataChangeMock).not.toHaveBeenCalled()
  })

  it('projects a structured handler timeout ahead of stale cancellation metadata', async () => {
    const handler = createSyncExternalSourceJobHandler({ syncSource: vi.fn() }, { now: () => 999 })

    await handler.onSettled?.(
      settledEvent({
        status: 'failed',
        output: undefined,
        error: {
          code: JOB_ERROR_CODES.HANDLER_TIMEOUT,
          message: 'handler exceeded its deadline',
          retryable: true
        },
        metadata: { externalKnowledgeSync: { code: 'cancelled', summary: summary({ indexedCount: 0 }) } }
      })
    )

    expect(settleSyncTxMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'failed', errorSummary: 'timeout' })
    )
  })

  it('publishes the source read model only after the settlement transaction returns', async () => {
    const order: string[] = []
    settleSyncTxMock.mockImplementation(() => {
      order.push('settle')
      return true
    })
    withWriteTxMock.mockImplementation((fn: (tx: object) => unknown) => {
      const result = fn({})
      order.push('commit')
      return result
    })
    notifyDataChangeMock.mockImplementation(() => order.push('notify'))
    const handler = createSyncExternalSourceJobHandler({ syncSource: vi.fn() }, { now: () => 999 })

    await handler.onSettled?.(settledEvent())

    expect(order).toEqual(['settle', 'commit', 'notify'])
  })
})
