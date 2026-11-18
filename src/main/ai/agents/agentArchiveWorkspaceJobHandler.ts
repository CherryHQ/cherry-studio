/**
 * Job handler for `agent.archive-system-workspace` — background compression of
 * an archived (trashed) root session's system workspace.
 *
 * Enqueued transactionally with the business archive state (`trashByIdsTx` via
 * `JobManager.enqueueTx`), so the archive request resolves without waiting for
 * the `tar.gz` pack and the task survives a crash after commit. The handler
 * re-reads the workspace business state and delegates every storage detail
 * (reservation, recovery records, path handling) to
 * `AgentWorkspaceStorageService.archiveWorkspace`: a workspace restored after
 * the task was queued is skipped instead of re-archived.
 */

import { ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX, agentSessionService } from '@data/services/AgentSessionService'
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
    await agentWorkspaceStorageService.archiveWorkspace(workspace)
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
