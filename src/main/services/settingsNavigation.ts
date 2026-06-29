import { application } from '@application'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import type { MainWindowInitData } from '@shared/types/mainWindow'

let nextSettingsNavigationRequestId = 0

export function openSettingsInMainWindow(path?: SettingsPath): void {
  const targetPath = normalizeSettingsPath(path)

  application.get('MainWindowService').showMainWindow({
    kind: 'settings-navigation',
    path: targetPath,
    requestId: nextSettingsNavigationRequestId++
  } satisfies MainWindowInitData)
}
