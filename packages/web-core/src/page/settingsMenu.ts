// Wraps the desktop settings menu: the Web edition shows only the sections whose features it serves.
import { settingsMenu as desktopSettingsMenu } from '@renderer/components/settingsMenu'

export { getSettingsSectionTitleKey, type SettingsMenuEntry } from '@renderer/components/settingsMenu'

const webSections = new Set([
  '/settings/provider',
  '/settings/model',
  '/settings/prompts',
  '/settings/general',
  '/settings/appearance',
  '/settings/archive',
  '/settings/about'
])

export const settingsMenu = desktopSettingsMenu.filter(({ route }) => webSections.has(route))
