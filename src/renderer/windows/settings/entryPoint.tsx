import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'
import '@renderer/databases'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_SETTINGS_PATH, normalizeSettingsPath } from '@shared/data/types/settingsPath'
import { createRoot } from 'react-dom/client'

import SettingsApp, { SettingsWindowFatalError } from './SettingsApp'

loggerService.initWindowSource('SettingsWindow')

const SETTINGS_SHELL_PREFERENCE_KEYS: UnifiedPreferenceKeyType[] = [
  'app.language',
  'ui.theme_mode',
  'ui.window_style',
  'ui.theme_user.color_primary',
  'chat.code.editor.enabled',
  'chat.code.editor.theme_light',
  'chat.code.editor.theme_dark',
  'chat.code.viewer.theme_light',
  'chat.code.viewer.theme_dark'
]

const logger = loggerService.withContext('SettingsWindowEntry')

async function preloadSettingsPreferences() {
  try {
    await preferenceService.preload(SETTINGS_SHELL_PREFERENCE_KEYS)
    return null
  } catch (error) {
    logger.error('Failed to preload settings preferences', error as Error)
    return error
  }
}

async function getInitialSettingsPath() {
  try {
    return normalizeSettingsPath(await ipcApi.request('window.get_init_data'))
  } catch (error) {
    logger.error('Failed to get settings window init data', error as Error)
    return DEFAULT_SETTINGS_PATH
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement)
const preloadError = await preloadSettingsPreferences()
const initialSettingsPath = preloadError ? DEFAULT_SETTINGS_PATH : await getInitialSettingsPath()

root.render(
  preloadError ? <SettingsWindowFatalError error={preloadError} /> : <SettingsApp initialPath={initialSettingsPath} />
)
