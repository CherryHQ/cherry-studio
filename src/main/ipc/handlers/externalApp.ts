import { externalAppsService } from '@main/services/ExternalAppsService'
import type { externalAppRequestSchemas } from '@shared/ipc/schemas/externalApp'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const externalAppHandlers: IpcHandlersFor<typeof externalAppRequestSchemas> = {
  'external_app.open': async ({ appId, targetPath }) => externalAppsService.open(appId, targetPath)
}
