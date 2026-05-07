import { DEFAULT_SETTINGS_PATH, normalizeSettingsPath } from '@shared/data/types/settingsPath'

export function openSettingsWindow(path: unknown = DEFAULT_SETTINGS_PATH): Promise<string> {
  return window.api.windowManager.openSettings(normalizeSettingsPath(path))
}
