/**
 * Job handler for `agent.archive-system-workspace` — background compression of
 * an archived (trashed) root session's system workspace.
 *
 * Enqueued transactionally with the business archive state (`AgentLifecycleService` via
 * `JobManager.enqueueTx`), so the archive request resolves without waiting for
 * the `tar.gz` pack and the task survives a crash after commit. The handler
 * re-reads the workspace business state and delegates every storage detail
 * (reservation, recovery records, path handling) to
 * `AgentWorkspaceStorageService.archiveWorkspace`: a workspace restored after
 * the task was queued is skipped instead of re-archived.
 */

import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import { agentWorkspaceStorageService } from './AgentWorkspaceStorageService'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'agent.archive-system-workspace': {
      /** Root session id — the identity `listSystemWorkspaceSessions` keys a system workspace by. */
      sessionId: string
    }
  }
}

const logger = loggerService.withContext('agentArchiveWorkspaceJobHandler')

export const agentArchiveWorkspaceJobHandler: JobHandler<{ sessionId: string }> = {
  /** A crash after commit must not lose the compression: replay non-terminal rows on restart. */
  recovery: 'retry',

  /** One queue for every workspace archive so batch archives share the concurrency cap. */
  defaultQueue: () => 'agent.workspace-archive',

  defaultConcurrency: 2,

  /** Compression failures (e.g. a writer still closing) retry instead of dropping the archive. */
  defaultRetryPolicy: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 1000, maxDelayMs: 30000 },

  async execute(ctx) {
    if (ctx.signal.aborted) throw new Error('Archive cancelled before it started')
    const workspace = agentSessionService.listSystemWorkspaceSessions([ctx.input.sessionId])[0]
    if (!workspace || workspace.deletedAt === null) {
      // Stale task: the workspace was restored (or never archived) after this
      // task was queued. Archiving now would pack a live directory.
      ctx.logger.info('Skipping workspace archive — workspace is no longer archived', {
        sessionId: ctx.input.sessionId
      })
      return { skipped: true }
    }
    let outcome: Awaited<ReturnType<typeof agentWorkspaceStorageService.archiveWorkspace>>
    try {
      outcome = await agentWorkspaceStorageService.archiveWorkspace(
        workspace,
        // Re-read after the worker's strict close: a purge committed while the
        // close was held must stop the pack, not be archived over (issue #21645).
        () => {
          const current = agentSessionService.listSystemWorkspaceSessions([ctx.input.sessionId])[0]
          return !!current && current.deletedAt !== null
        }
      )
    } catch (error) {
      // Log every failed attempt with its session: JobManager records a retry
      // without the cause and a later successful retry clears the stored error,
      // so this line is the only durable trace of what failed (issue #21645).
      ctx.logger.error('Workspace archive attempt failed', { sessionId: ctx.input.sessionId, error })
      throw error
    }
    if (outcome === 'skipped') {
      ctx.logger.info('Skipping workspace archive — workspace was permanently deleted during close', {
        sessionId: ctx.input.sessionId
      })
      return { skipped: true }
    }
    if (outcome === 'busy') {
      // Transient contention is not completion: surface it so the retry policy
      // requeues the pack instead of settling the task with the directory
      // still unpacked.
      throw new Error('Workspace storage is reserved by another operation; the archive will be retried')
    }
    if (outcome === 'blocked') {
      // A registered workspace's claim overlaps this directory: packing is
      // refused until the claim is removed. Retrying cannot help, so settle as
      // skipped; the sweep re-attempts on every pass.
      ctx.logger.info('Skipping workspace archive — a registered workspace claim blocks the reservation', {
        sessionId: ctx.input.sessionId
      })
      return { skipped: true }
    }
    return { archived: workspace.path }
  },

  onSettled(event) {
    if (event.status === 'failed') {
      logger.error('System workspace archive failed; directory retained for retry', {
        sessionId: event.input.sessionId,
        error: event.error?.message
      })
    }
  }
}
