import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { DEFAULT_SETTINGS_PATH, normalizeSettingsPath, type SettingsPath } from '@shared/data/types/settingsPath'

const logger = loggerService.withContext('settingsNavigation')

export const OPEN_SETTINGS_TAB_EVENT = 'cherry:open-settings-tab'

export type OpenSettingsTabEvent = CustomEvent<{ path: SettingsPath }>

export function openSettingsTab(path: SettingsPath = DEFAULT_SETTINGS_PATH): void {
  const targetPath = normalizeSettingsPath(path)
  const event = new CustomEvent<{ path: SettingsPath }>(OPEN_SETTINGS_TAB_EVENT, {
    cancelable: true,
    detail: { path: targetPath }
  })

  window.dispatchEvent(event)
  if (!event.defaultPrevented) {
    void ipcApi.request('navigation.open_settings', { path: targetPath }).catch((error) => {
      logger.error('Failed to request main-window settings navigation', error as Error)
    })
  }
}
