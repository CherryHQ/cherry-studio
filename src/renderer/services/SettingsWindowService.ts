import { DEFAULT_SETTINGS_PATH, type SettingsPath } from '@shared/data/types/settingsPath'

export function openSettingsWindow(path: SettingsPath = DEFAULT_SETTINGS_PATH): Promise<string> {
  return window.api.windowManager.openSettings(path)
}
