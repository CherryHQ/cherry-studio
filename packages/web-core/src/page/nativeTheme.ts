import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import { NATIVE_THEME_CHANNEL } from '../worker/protocol'
import { ipcRenderer } from './electron'

/** Reports the browser's color scheme to the Worker now and on every change, as Electron's `nativeTheme` would. */
export function reportNativeTheme(): void {
  const darkScheme = matchMedia('(prefers-color-scheme: dark)')
  const report = () => ipcRenderer.send(NATIVE_THEME_CHANNEL, darkScheme.matches ? ThemeMode.dark : ThemeMode.light)
  report()
  darkScheme.addEventListener('change', report)
}
