export function openSettingsWindow(path = '/settings/provider'): Promise<string> {
  return window.api.windowManager.openSettings(path)
}
