import type { SettingsPath } from '@shared/data/types/settingsPath'

export type MainWindowInitData = {
  kind: 'settings-navigation'
  path: SettingsPath
  requestId: number
}
