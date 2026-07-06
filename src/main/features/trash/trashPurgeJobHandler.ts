import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { fileEntryService } from '@data/services/FileEntryService'
import { messageService } from '@data/services/MessageService'
import { paintingService } from '@data/services/PaintingService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import type { JobHandlerFor } from '@main/core/job/types'

import { sweepOrphanAgentDirs } from './agentDirOrphanSweep'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    /** Trash retention purge. `emptyAll: true` = "empty trash now" (ignores retention). */
    'trash.purge': { emptyAll?: boolean }
  }
}

const logger = loggerService.withContext('TrashPurgeJobHandler')

/** Rows hard-deleted per domain per write transaction. */
const PURGE_BATCH_SIZE = 500

const DAY_MS = 86_400_000

/**
 * RFC §6 purge order — containers before independent rows: topic (messages
 * cascade via purge path) → independently soft-deleted messages → session
 * (session messages FK-cascade) → agent → assistant → painting → file entry.
 * Each domain's `purgeExpiredTx` is DB-only; disk reclamation happens in the
 * post-commit sweeps.
 */
const PURGE_DOMAINS: ReadonlyArray<{
  name: string
  purgeExpiredTx: (tx: DbOrTx, cutoffMs: number, limit: number) => string[]
}> = [
  { name: 'topic', purgeExpiredTx: (tx, cutoffMs, limit) => topicService.purgeExpiredTx(tx, cutoffMs, limit) },
  { name: 'message', purgeExpiredTx: (tx, cutoffMs, limit) => messageService.purgeExpiredTx(tx, cutoffMs, limit) },
  {
    name: 'session',
    purgeExpiredTx: (tx, cutoffMs, limit) => agentSessionService.purgeExpiredTx(tx, cutoffMs, limit)
  },
  { name: 'agent', purgeExpiredTx: (tx, cutoffMs, limit) => agentService.purgeExpiredTx(tx, cutoffMs, limit) },
  {
    name: 'assistant',
    purgeExpiredTx: (tx, cutoffMs, limit) => assistantDataService.purgeExpiredTx(tx, cutoffMs, limit)
  },
  { name: 'painting', purgeExpiredTx: (tx, cutoffMs, limit) => paintingService.purgeExpiredTx(tx, cutoffMs, limit) },
  { name: 'fileEntry', purgeExpiredTx: (tx, cutoffMs, limit) => fileEntryService.purgeExpiredTx(tx, cutoffMs, limit) }
]

/**
 * Hard-deletes trashed rows whose retention window has expired, then reclaims
 * orphaned disk artifacts (file blobs + agent directories).
 *
 * Recovery 'singleton': after a restart only the newest non-terminal purge
 * survives — one full sweep covers everything an older queued run would have
 * done.
 */
export const trashPurgeJobHandler: JobHandlerFor<'trash.purge'> = {
  recovery: 'singleton',
  defaultConcurrency: 1,
  async execute(ctx) {
    const emptyAll = ctx.input?.emptyAll === true
    const retentionDays = application.get('PreferenceService').get('data.trash.retention_days')
    if (!emptyAll && retentionDays === 0) {
      logger.info('Trash auto-purge disabled (retention_days = 0) — skipping')
      return { skipped: true }
    }

    // MAX_SAFE_INTEGER + strict `deletedAt < cutoff` captures rows archived "now".
    const cutoffMs = emptyAll ? Number.MAX_SAFE_INTEGER : Date.now() - retentionDays * DAY_MS
    const dbService = application.get('DbService')
    const totalSteps = PURGE_DOMAINS.length + 2 // + file orphan sweep + agent dir sweep
    const purged: Record<string, number> = {}

    for (const [index, domain] of PURGE_DOMAINS.entries()) {
      ctx.signal.throwIfAborted()
      let count = 0
      let batch: string[]
      // Batched synchronous transactions: each withWriteTx callback runs inline
      // (better-sqlite3), keeping every write window short.
      do {
        batch = dbService.withWriteTx((tx) => domain.purgeExpiredTx(tx, cutoffMs, PURGE_BATCH_SIZE))
        count += batch.length
      } while (batch.length === PURGE_BATCH_SIZE)
      purged[domain.name] = count
      ctx.reportProgress(Math.round(((index + 1) / totalSteps) * 100))
    }

    // Filesystem reclamation strictly AFTER all transactions committed.
    // Failures are logged, never thrown — the DB rows are already gone and any
    // disk residue is picked up by the next purge run's sweeps.
    try {
      await application.get('FileManager').runSweep()
    } catch (error) {
      logger.warn('File orphan sweep failed — residue retried next purge run', { error })
    }
    ctx.reportProgress(Math.round(((PURGE_DOMAINS.length + 1) / totalSteps) * 100))

    try {
      await sweepOrphanAgentDirs()
    } catch (error) {
      logger.warn('Agent orphan-dir sweep failed — residue retried next purge run', { error })
    }
    ctx.reportProgress(100)

    logger.info('Trash purge complete', { emptyAll, purged })
    return { skipped: false, purged }
  }
}
