import { application } from '@application'
import { aiHandlers } from '@main/ipc/handlers/ai'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { ipcRequestSchemas, type IpcRequestSchemas } from '@shared/ipc/schemas/ipcSchemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { version } from '../../../../package.json'
import { unsupported } from '../disabled/unsupported'
import { NATIVE_THEME_CHANNEL } from '../worker/protocol'
import { ipcMain } from './electron'

// The page reports its `prefers-color-scheme`, which Electron's `nativeTheme` gives the desktop main process.
let nativeTheme: ThemeMode.light | ThemeMode.dark = ThemeMode.light
ipcMain.on(NATIVE_THEME_CHANNEL, (_event, theme) => {
  nativeTheme = theme as typeof nativeTheme
  application.get('IpcApiService').broadcast('system.native_theme_updated', nativeTheme)
})

/** IpcApi routes the Web edition serves: chat streams, and Web answers to what the desktop shell asks at start. */
const servedHandlers: Partial<IpcHandlersFor<IpcRequestSchemas>> = {
  'ai.stream.open': aiHandlers['ai.stream.open'],
  'ai.stream.attach': aiHandlers['ai.stream.attach'],
  'ai.stream.detach': aiHandlers['ai.stream.detach'],
  'ai.stream.abort': aiHandlers['ai.stream.abort'],
  'app.get_info': async () => ({
    version,
    isPackaged: true,
    appPath: application.getPath('app.root'),
    homePath: application.getPath('sys.home'),
    notesPath: application.getPath('feature.notes.data'),
    configPath: application.getPath('cherry.config'),
    appDataPath: application.getPath('app.userdata'),
    resourcesPath: application.getPath('app.root.resources'),
    logsPath: application.getPath('app.logs'),
    arch: '',
    isPortable: false,
    installPath: application.getPath('app.install')
  }),
  'system.get_native_theme': async () => nativeTheme,
  // The page is the main window, which has no init data; it has no window size, protocol handler or screen capture.
  'window.get_init_data': async () => null,
  'window.main.set_minimum_size': async () => {},
  'window.main.reset_minimum_size': async () => {},
  'navigation.protocol_dispatch_ready': async () => {},
  'chat.screenshot.target': async () => {},
  'backup.get_auto_sync_state': async () => ({ pendingNotifications: [] })
}

/** Browser `ipc/handlers/ipcHandlers`: every other route rejects with `WebUnsupportedError`. */
export const ipcHandlers = Object.fromEntries(
  Object.keys(ipcRequestSchemas).map((route) => [
    route,
    servedHandlers[route as keyof IpcRequestSchemas] ?? unsupported(`IpcApi route ${route}`)
  ])
) as IpcHandlersFor<IpcRequestSchemas>
