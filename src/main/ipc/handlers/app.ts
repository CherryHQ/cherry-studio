import { arch } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { requestDataReset } from '@main/services/dataReset'
import { inspectUserDataRelocationTarget, requestUserDataRelocation } from '@main/services/userDataRelocation'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { app, BrowserWindow, webContents } from 'electron'

export const appHandlers: IpcHandlersFor<typeof appRequestSchemas> = {
  'app.get_info': async () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: application.getPath('app.root'),
    homePath: application.getPath('sys.home'),
    notesPath: application.getPath('feature.notes.data'),
    configPath: application.getPath('cherry.config'),
    appDataPath: application.getPath('app.userdata'),
    resourcesPath: application.getPath('app.root.resources'),
    logsPath: loggerService.getLogsDir(),
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: application.getPath('app.install')
  }),
  // The request face of userData relocation IPC: the running app validates a
  // target and persists the request here. The execution face (a relocation-only
  // launch) never starts IpcApiService — its progress window talks over bare
  // UserDataRelocationIpcChannels instead (services/userDataRelocation/window.ts).
  'app.user_data_relocation.inspect': async ({ path }) => inspectUserDataRelocationTarget(path),
  'app.user_data_relocation.request': async ({ path, copy }) => {
    if (!app.isPackaged) {
      throw new IpcError('USER_DATA_RELOCATION_UNAVAILABLE', 'userData relocation is available only in packaged builds')
    }
    requestUserDataRelocation(path, copy)
  },
  'app.relaunch': async () => application.relaunch(),
  'app.adjust_zoom': async ({ delta, reset = false }) => {
    handleZoomFactor(BrowserWindow.getAllWindows(), delta, reset)
    return application.get('PreferenceService').get('app.zoom_factor')
  },
  'app.set_spell_check_enabled': async (isEnable) => {
    webContents.getAllWebContents().forEach((w) => w.session.setSpellCheckerEnabled(isEnable))
  },
  // Thin delegate: the whole request-to-restart contract (native
  // confirmation, marker staging, Chromium clear, graceful relaunch) is
  // owned by services/dataReset.
  'app.data_reset.request': async () => requestDataReset(),
  'app.updater.check_for_update': async () => {
    await application.get('AppUpdaterService').checkForUpdates()
  },
  'app.updater.quit_and_install': async () => {
    application.get('AppUpdaterService').quitAndInstall()
  }
}
