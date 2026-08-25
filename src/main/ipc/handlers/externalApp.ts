import { externalAppService } from '@main/services/externalApp'
import type { externalAppRequestSchemas } from '@shared/ipc/schemas/externalApp'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const externalAppHandlers: IpcHandlersFor<typeof externalAppRequestSchemas> = {
  'external_app.target.list': async ({ targetPath, pathKind }) =>
    externalAppService.listOpenTargets(targetPath, pathKind),
  'external_app.target.open': async ({ targetPath, pathKind, targetId }) =>
    externalAppService.openTarget(targetPath, targetId, pathKind)
}
