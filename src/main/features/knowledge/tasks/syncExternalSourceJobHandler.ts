import './jobTypes'
import * as z from 'zod'

import { application } from '@application'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import type { JobHandler } from '@main/core/job/types'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'

import {
  notifyExternalKnowledgeSourceChange,
  notifyExternalKnowledgeSyncContentChange
} from '../external/externalKnowledgeDataChange'
import {
  ExternalKnowledgeSourceSyncError,
  type ExternalKnowledgeSourceSyncSummary,
  type ExternalKnowledgeSyncService
} from '../external/ExternalKnowledgeSyncService'
import { knowledgeQueueName, toKnowledgeBaseId } from '../types'
import type { KnowledgeSyncExternalSourcePayload } from './jobTypes'

const WarningCodeSchema = z.enum([
  'transient',
  'invalid-provider-response',
  'unsupported-resource',
  'resource-permission-denied',
  'document-sync-failed'
])

const SyncSummarySchema = z
  .strictObject({
    scannedCount: z.number().int().nonnegative(),
    indexedCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    warnings: z.array(
      z.strictObject({ code: WarningCodeSchema, remoteObjectId: z.string().trim().min(1).max(1024).optional() })
    )
  })
  .refine((summary) => summary.warningCount === summary.warnings.length)

const MetadataCodeSchema = z.enum([
  'stopped',
  'not-found',
  'connection-in-use',
  'session-not-found',
  'credential-unavailable',
  'scope-missing',
  'automatic-scope-mismatch',
  'identity-conflict',
  'identity-unverifiable',
  'reauthorization-required',
  'authorization-failed',
  'invalid-scope-url',
  'resource-permission-denied',
  'scope-not-found',
  'unsupported-resource',
  'transient',
  'invalid-provider-response',
  'cancelled',
  'scan-failed',
  'stale-publication',
  'reconciliation-failed',
  'unexpected'
])

const MetadataSchema = z.strictObject({ code: MetadataCodeSchema, summary: SyncSummarySchema })

const EMPTY_SUMMARY: ExternalKnowledgeSourceSyncSummary = {
  scannedCount: 0,
  indexedCount: 0,
  unchangedCount: 0,
  skippedCount: 0,
  warningCount: 0,
  warnings: []
}

type SyncService = Pick<ExternalKnowledgeSyncService, 'syncSource'>

export type SyncExternalSourceJobHandlerDependencies = {
  now(): number
}

function parseSummary(value: unknown): ExternalKnowledgeSourceSyncSummary {
  const result = SyncSummarySchema.safeParse(value)
  return result.success ? result.data : { ...EMPTY_SUMMARY, warnings: [] }
}

function parseMetadata(
  value: unknown
): { code: z.infer<typeof MetadataCodeSchema>; summary: ExternalKnowledgeSourceSyncSummary } | null {
  const result = MetadataSchema.safeParse(value)
  return result.success ? result.data : null
}

export function createSyncExternalSourceJobHandler(
  syncService: SyncService,
  dependencies: SyncExternalSourceJobHandlerDependencies = { now: Date.now }
): JobHandler<KnowledgeSyncExternalSourcePayload> {
  return {
    recovery: 'abandon',
    defaultQueue: (input) => knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
    defaultConcurrency: 5,
    defaultRetryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 30_000
    },
    defaultTimeoutMs: 30 * 60 * 1000,

    async execute(ctx) {
      ctx.reportProgress(0, { stage: 'scanning' })
      try {
        const result = await syncService.syncSource({
          fence: {
            baseId: ctx.input.baseId,
            sourceId: ctx.input.sourceId,
            expectedSourceRevision: ctx.input.sourceRevision,
            activeJobId: ctx.jobId
          },
          signal: ctx.signal,
          reportProgress: (progress, detail) => ctx.reportProgress(progress, detail)
        })
        const summary = SyncSummarySchema.safeParse(result)
        if (!summary.success) {
          throw new Error('External knowledge source synchronization returned an invalid summary')
        }
        return summary.data
      } catch (error) {
        if (error instanceof ExternalKnowledgeSourceSyncError) {
          const cancellationMismatch = error.code === 'cancelled' && !ctx.signal.aborted
          const code = cancellationMismatch ? 'unexpected' : error.code
          await ctx.patchMetadata({
            externalKnowledgeSync: { code, summary: parseSummary(error.summary) }
          })
          if (error.code === 'cancelled' && ctx.signal.aborted) {
            ctx.signal.throwIfAborted()
          }
          if (cancellationMismatch) {
            ctx.logger.warn('External knowledge synchronization reported cancellation without an aborted job signal')
          }
          throw new Error(`External knowledge source synchronization failed: ${code}`)
        }

        await ctx.patchMetadata({
          externalKnowledgeSync: { code: 'unexpected', summary: { ...EMPTY_SUMMARY, warnings: [] } }
        })
        ctx.logger.warn('External knowledge synchronization failed with an unexpected error')
        throw new Error('External knowledge source synchronization failed: unexpected')
      } finally {
        notifyExternalKnowledgeSyncContentChange(ctx.input.baseId, ctx.input.sourceId)
      }
    },

    async onSettled(event) {
      const completedSummary = event.status === 'completed' ? parseSummary(event.output) : null
      const failedMetadata = event.status === 'completed' ? null : parseMetadata(event.metadata.externalKnowledgeSync)
      const summary = completedSummary ?? failedMetadata?.summary ?? { ...EMPTY_SUMMARY, warnings: [] }
      const outcome =
        event.status === 'completed'
          ? summary.warningCount > 0
            ? 'completed-with-warnings'
            : 'completed'
          : event.status
      const errorSummary =
        event.status === 'completed'
          ? null
          : event.status === 'cancelled'
            ? 'cancelled'
            : event.error?.code === JOB_ERROR_CODES.HANDLER_TIMEOUT
              ? 'timeout'
              : (failedMetadata?.code ?? 'failed')
      const settled = application.get('DbService').withWriteTx((tx) =>
        externalKnowledgeSourceService.settleSyncTx(tx, {
          sourceId: event.input.sourceId,
          expectedRevision: event.input.sourceRevision,
          jobId: event.jobId,
          finishedAt: dependencies.now(),
          outcome,
          scannedCount: summary.scannedCount,
          indexedCount: summary.indexedCount,
          unchangedCount: summary.unchangedCount,
          skippedCount: summary.skippedCount,
          warningCount: summary.warningCount,
          errorSummary
        })
      )
      if (settled) {
        notifyExternalKnowledgeSourceChange(event.input.baseId, event.input.sourceId, 'projection')
      }
    }
  }
}
