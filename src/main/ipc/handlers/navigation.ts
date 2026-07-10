import { openSettingsInMainWindow } from '@main/services/settingsNavigation'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import type { navigationRequestSchemas } from '@shared/ipc/schemas/navigation'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const navigationHandlers: IpcHandlersFor<typeof navigationRequestSchemas> = {
  'navigation.open_settings': async ({ path }) => {
    openSettingsInMainWindow(normalizeSettingsPath(path))
  }
}
