import { arch } from 'node:os'

import { app, BrowserWindow } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { showSupportedMessageBox } from '@main/core/preboot/nativeErrorDialog'
import { WindowType } from '@main/core/window/types'
import { getAppLanguage, t } from '@main/i18n'
import { cacheCleanupService } from '@main/services/cacheCleanup'
import { requestDataReset, requestV1Remigration } from '@main/services/dataReset'
import { deliverToReadyMain, setMainSurfaceReceiver } from '@main/services/mainWindowNavigation'
import { regionService } from '@main/services/RegionService'
import { inspectUserDataRelocationTarget, requestUserDataRelocation } from '@main/services/userDataRelocation'
import { getAndroidDownloadUrl } from '@main/utils/mobileAppDownload'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const appHandlers: IpcHandlersFor<typeof appRequestSchemas> = {
  'app.mobile.get_android_download_url': async () => getAndroidDownloadUrl(await regionService.getCountry()),
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
  'app.cache_cleanup.inspect': async ({ groups }) => cacheCleanupService.inspect(groups),
  'app.cache_cleanup.run': async ({ groups }) => cacheCleanupService.run(groups),
  'app.relaunch': async () => application.relaunch(),
  'app.adjust_zoom': async ({ delta, reset = false }) => {
    handleZoomFactor(BrowserWindow.getAllWindows(), delta, reset)
    return application.get('PreferenceService').get('app.zoom_factor')
  },
  'app.data_reset.request': async () => requestDataReset(),
  'app.migration_v2.rerun': async () => requestV1Remigration(),
  'app.updater.check_for_update': async () => {
    await application.get('AppUpdaterService').checkForUpdates()
  },
  'app.updater.present_check': async () => {
    if (!deliverToReadyMain('app.updater.run_check', undefined)) {
      throw new IpcError('MAIN_UNAVAILABLE', 'The main window is not ready to check for updates')
    }
  },
  'app.surface.receiver': async ({ kind, ready }, { senderId }) => {
    if (!senderId || application.get('WindowManager').getWindowType(senderId) !== WindowType.Main) return
    setMainSurfaceReceiver(kind, ready)
  },
  'app.updater.release_notes.get': async () => application.get('AppUpdaterService').getReleaseHistory(),
  'app.error.handoff': async (context) => {
    if (!deliverToReadyMain('app.error.open', context)) {
      throw new IpcError('MAIN_UNAVAILABLE', 'The main window is not ready to show this error')
    }
  },
  'app.error.degraded': async (context) => {
    const language = getAppLanguage()
    const technicalDetail = [context.name, context.message, context.stack].filter(Boolean).join('\n')
    await showSupportedMessageBox({
      language,
      box: {
        type: 'error',
        title: t('dialog.support.degraded_title', undefined, language),
        message: t('dialog.support.degraded_message', undefined, language),
        buttons: [t('dialog.support.close', undefined, language)],
        defaultId: 0,
        cancelId: 0
      },
      technicalDetail
    })
  },
  'app.updater.quit_and_install': async () => {
    application.get('AppUpdaterService').quitAndInstall()
  }
}
