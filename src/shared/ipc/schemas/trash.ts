import { TerminalJobStatusSchema } from '@shared/data/api/schemas/jobs'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Trash IPC schemas — "empty trash now" workflow command delegated to
 * `TrashService`. A JobManager command, not business data, so it lives on
 * IpcApi (DataApi's guidelines list `POST /jobs` as an anti-pattern).
 *
 * Request-only: the response resolves only after the purge job reached a
 * terminal state, carrying that terminal `status` ('completed' | 'failed' |
 * 'cancelled') so the renderer can invalidate caches / toast truthfully.
 */
export const trashRequestSchemas = {
  'trash.purge_now': defineRoute({
    input: z.void(),
    output: z.strictObject({ jobId: z.string(), status: TerminalJobStatusSchema })
  })
}
