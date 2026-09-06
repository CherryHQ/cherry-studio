import { application } from '@application'
import type { trashRequestSchemas } from '@shared/ipc/schemas/trash'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapter for the trash request route: delegates to `TrashService`, which
 * owns the purge job. Acts on shared business data, not the caller's window,
 * so it ignores `IpcContext`.
 */
export const trashHandlers: IpcHandlersFor<typeof trashRequestSchemas> = {
  'trash.purge_now': async () => application.get('TrashService').purgeNow()
}
