import { externalAppService } from '@main/services/externalApp'
import type { externalAppRequestSchemas } from '@shared/ipc/schemas/externalApp'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const externalAppHandlers: IpcHandlersFor<typeof externalAppRequestSchemas> = {
  'external_app.target.list': async ({ targetPath }) => externalAppService.listOpenTargets(targetPath),
  'external_app.target.open': async ({ targetPath, targetId }) => externalAppService.openTarget(targetPath, targetId)
}
