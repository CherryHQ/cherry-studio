import { loggerService } from '@logger'
import { isAllowedRoute, openRouteInMainWindow } from '@main/services/mainWindowNavigation'
import type { navigationRequestSchemas } from '@shared/ipc/schemas/navigation'
import type { IpcHandlersFor } from '@shared/ipc/types'

const logger = loggerService.withContext('navigationHandlers')

export const navigationHandlers: IpcHandlersFor<typeof navigationRequestSchemas> = {
  'navigation.open_route_in_main': async ({ path }) => {
    if (!isAllowedRoute(path)) {
      logger.warn('Blocked navigation to disallowed route', { path })
      return
    }
    openRouteInMainWindow(path)
  }
}
