import { application } from '@application'
import { loggerService } from '@logger'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('DataApiDataChange')

/**
 * Broadcast a DataApi data change notification to all windows.
 *
 * This is the single publish point of the "DataApi data change notification"
 * capability: after a business write successfully commits, the owning data
 * service states which read models changed (as {@link DataApiDataChangeEffect}
 * entries) and every renderer decides its own convergence. It is deliberately
 * an IPC-deployment special case, NOT part of the portable `api/` transport
 * framework — it depends on WindowManager, and HTTP-adapter consumers do not
 * receive these notifications.
 *
 * ## Governance exception (strictly fenced)
 *
 * "Data service → notify → IPC" is a narrow exception to the DataApi layering
 * rules: a data service may publish a read-model observation signal after its
 * data is committed, for cross-window data convergence. Fences (all hard):
 * - publish only after commit, never inside a transaction (listeners must not
 *   run while the write lock is held, and a rollback must be unreachable from
 *   the notify call);
 * - the notification never participates in write success — a failure here
 *   must not roll back or otherwise affect committed data (hence the
 *   try/catch);
 * - it may only describe endpoint/read-model changes — no entity rows, field
 *   diffs, SQL predicates or business commands;
 * - it must not be used to smuggle file, network, process, window-control or
 *   external-service work out of a data service;
 * - renderer consumers may only use it for fact refetching and local
 *   reconciliation;
 * - this is NOT a license for DataApi services to carry side effects in
 *   general.
 *
 * ## Publish invariants
 *
 * - Timing: call after the outermost public write commits and before the
 *   public operation returns — after `withWriteTx` returns for transactional
 *   writes, after the statement returns for single autocommit writes (do NOT
 *   wrap a single write in a transaction just to notify). On failure the
 *   exception propagates and this call is never reached.
 * - `*Tx()` helpers never notify; only the outermost public operation does.
 *   A cross-domain composite operation notifies once at its orchestration
 *   point with all effects inlined.
 * - No-op writes that provably changed nothing may skip notifying; when
 *   proving that is not cheap, notify — a missed signal is a convergence bug,
 *   an extra one is a redundant refetch.
 *
 * ## Delivery contract
 *
 * Best-effort delivery to live, continuously subscribed renderers, FIFO per
 * window (Electron's per-webContents ordering); no cross-window ordering, no
 * ack/replay. Residual race (accepted product contract): a consumer's
 * exposure window spans from its first GET's DB read until its subscription
 * registration completes — an external commit landing inside that window with
 * no follow-up write is missed until the endpoint's next change, a remount,
 * or any fresh query. Notifications during bootstrap are intentionally
 * dropped by the `isReady()` guard and belong to the same accepted class.
 */
export function notifyDataApiDataChange(effects: DataApiDataChangeEffect[]): void {
  if (effects.length === 0) return
  // Delivery boundary: notification delivery starts once bootstrap completes.
  // Not getOptional('WindowManager') — it throws for non-conditional services
  // (ServiceContainer semantics); not a bare get() fallback either — lazy
  // container creation would construct WhenReady services prematurely.
  if (!application.isReady()) return
  try {
    application.get('WindowManager').broadcast(IpcChannel.DataApi_DataChanged, effects)
  } catch (error) {
    // Notification failure must never affect the already-committed write.
    logger.warn('data change notification failed', error as Error)
  }
}
