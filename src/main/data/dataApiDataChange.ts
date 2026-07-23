/**
 * DataApi data change notification — main-side publisher (issue #17144, section 4.1).
 *
 * A data service, after a business write successfully commits, calls this to
 * broadcast "which DataApi read models changed, and in what way" to every
 * Electron window. Renderer consumers subscribe through the renderer
 * `DataApiService.onDataChanged` facility and decide their own convergence.
 *
 * This is NOT part of the transport-neutral DataApi core (`src/main/data/api/`):
 * that directory is the portable transport framework and reserves an
 * HttpAdapter, so it must stay free of Electron/WindowManager dependencies and
 * of a `services → api` reverse edge. This capability is an IPC special case and
 * lives here, a sibling of `DataApiService.ts`. Dependency direction is
 * `services → data/dataApiDataChange → core(application/window) + shared`,
 * acyclic.
 *
 * Governance exception (recorded in data/README.md and the DataApi governing
 * docs):
 *
 * > A data service may publish a read-model observation signal after data is
 * > successfully committed, for cross-window data convergence.
 *
 * Fences (all hard constraints): publish only after commit, never inside a
 * transaction; not part of write success — notification failure must not roll
 * back or affect committed data; describes endpoint/read-model changes only;
 * must not carry entity rows, field diffs, SQL predicates, or business
 * commands; must not be used to perform file, network, process,
 * window-control, or external-service work; Renderer consumers may use it only
 * for fact refetching and local reconciliation. This is NOT an escape hatch for
 * general side effects in DataApi.
 *
 * Delivery and recovery (issue #17144, section 8): delivery is best-effort to
 * live, continuously subscribed renderers, with per-window FIFO ordering; there
 * is no ack/replay and no "guaranteed delivery" claim. Notifications emitted
 * before Application bootstrap completes are intentionally dropped by the
 * `isReady()` guard below (pre-bootstrap migration/seeding writes no-op through
 * it), and a consumer has a residual exposure window between its first GET's
 * database read and its subscription registration. Both are the accepted
 * startup-window race; recovery is the next relevant change on that endpoint, a
 * consumer remount, or any active query. No sequence numbers, catch-up
 * handshake, or durable log are introduced here.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('dataApiDataChange')

/**
 * Broadcast a set of read-model change effects to all Electron windows.
 *
 * Call after the outermost public write has successfully committed and before
 * the public operation returns — never inside a `withWriteTx` callback. On
 * rollback the exception propagates and this call is unreachable, so an emitted
 * signal is a structural guarantee that the write committed.
 *
 * @param effects All effects of one business operation (one notification).
 */
export function notifyDataApiDataChange(effects: DataApiDataChangeEffect[]): void {
  if (effects.length === 0) return
  // Delivery-boundary guard: delivery starts after Application bootstrap completes.
  // Not getOptional: WindowManager is not @Conditional and getOptional throws for it
  // (ServiceContainer semantics). Not bare get as a fallback: lazy creation would
  // construct a WhenReady service prematurely.
  if (!application.isReady()) return
  try {
    application.get('WindowManager').broadcast(IpcChannel.DataApi_DataChanged, effects)
  } catch (error) {
    // Notification is not part of write success — failure here must never affect
    // the already-committed write.
    logger.warn('data change notification failed', error as Error)
  }
}
