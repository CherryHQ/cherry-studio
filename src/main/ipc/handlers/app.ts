import { arch } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { canonicalizeUserDataPath } from '@main/core/preboot/userDataLocation'
import {
  assertUserDataRelocationRequest,
  inspectUserDataRelocationTarget
} from '@main/core/preboot/userDataRelocationGate'
import { bootConfigService } from '@main/data/bootConfig'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { app, BrowserWindow, webContents } from 'electron'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AppIpc')

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
  'app.inspect_user_data_relocation': async ({ path }) =>
    inspectUserDataRelocationTarget(application.getPath('app.userdata'), path),
  'app.request_user_data_relocation': async ({ path, copy }) => {
    if (!app.isPackaged) {
      throw new IpcError('USER_DATA_RELOCATION_UNAVAILABLE', 'userData relocation is available only in packaged builds')
    }

    const pending = {
      status: 'pending' as const,
      taskId: uuidv4(),
      from: canonicalizeUserDataPath(application.getPath('app.userdata')),
      to: canonicalizeUserDataPath(path),
      copy
    }
    assertUserDataRelocationRequest(pending)

    // Temporary BootConfig values bypass PreferenceService. Persist immediately
    // because the request must be durable before Electron relaunches.
    const previous = bootConfigService.get('temp.user_data_relocation')
    bootConfigService.set('temp.user_data_relocation', pending)
    try {
      bootConfigService.persist()
    } catch (error) {
      // persist() intentionally retains dirty in-memory state for retry. This
      // request was rejected, so restore the state a later flush may persist.
      bootConfigService.set('temp.user_data_relocation', previous)
      throw error
    }
    logger.info('userData relocation requested; relaunch required', pending)
  },
  'app.user_data_relocation.get_progress': async () => null,
  'app.user_data_relocation.restart': async () => application.relaunch(),
  'app.relaunch': async () => application.relaunch(),
  'app.adjust_zoom': async ({ delta, reset = false }) => {
    handleZoomFactor(BrowserWindow.getAllWindows(), delta, reset)
    return application.get('PreferenceService').get('app.zoom_factor')
  },
  'app.set_spell_check_enabled': async (isEnable) => {
    webContents.getAllWebContents().forEach((w) => w.session.setSpellCheckerEnabled(isEnable))
  },
  'app.updater.check_for_update': async () => {
    await application.get('AppUpdaterService').checkForUpdates()
  },
  'app.updater.quit_and_install': async () => {
    application.get('AppUpdaterService').quitAndInstall()
  }
}
