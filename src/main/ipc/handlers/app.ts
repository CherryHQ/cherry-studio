import { arch } from 'node:os'

import { app, BrowserWindow } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { cacheCleanupService } from '@main/services/cacheCleanup'
import { requestDataReset, requestV1Remigration } from '@main/services/dataReset'
import {
  abandonNotesRelocationSession,
  acknowledgeRendererNotesEditsFlush,
  acquireNotesRelocationSession,
  inspectNotesRelocation,
  isRendererNotesEditsFlushWindowRegistered,
  migrateNotesDirectory,
  registerRendererNotesEditsFlushWindow,
  releaseNotesRelocationSession,
  requestRendererNotesEditsFlush,
  setNotesRelocationMigrateInFlight,
  unregisterRendererNotesEditsFlushWindow
} from '@main/services/notesRelocation'
import { regionService } from '@main/services/RegionService'
import { inspectUserDataRelocationTarget, requestUserDataRelocation } from '@main/services/userDataRelocation'
import { getAndroidDownloadUrl } from '@main/utils/mobileAppDownload'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'
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
  'app.notes_relocation.inspect': async ({ sourcePath, targetPath }) => inspectNotesRelocation(sourcePath, targetPath),
  'app.notes_relocation.flush_edits_register': async (_input, { senderId }) => {
    if (senderId != null) {
      registerRendererNotesEditsFlushWindow(senderId)
    }
  },
  'app.notes_relocation.flush_edits_unregister': async (_input, { senderId }) => {
    if (senderId == null) {
      return
    }
    const abandonedSession = abandonNotesRelocationSession(senderId)
    unregisterRendererNotesEditsFlushWindow(senderId)
    if (abandonedSession) {
      application.get('IpcApiService').broadcast('app.notes_relocation.migrate_complete', undefined)
    }
  },
  'app.notes_relocation.flush_edits_ack': async ({ requestId, ok }, { senderId }) => {
    acknowledgeRendererNotesEditsFlush(requestId, senderId, ok)
  },
  'app.notes_relocation.migrate': async ({ sourcePath, targetPath, merge }, { senderId }) => {
    if (senderId == null) {
      throw new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_FAILED,
        'notes relocation requires a renderer window'
      )
    }

    acquireNotesRelocationSession(senderId)
    setNotesRelocationMigrateInFlight(true)
    try {
      await requestRendererNotesEditsFlush()
      const result = await migrateNotesDirectory(sourcePath, targetPath, { merge })
      if (!isRendererNotesEditsFlushWindowRegistered(senderId)) {
        releaseNotesRelocationSession(senderId)
        application.get('IpcApiService').broadcast('app.notes_relocation.migrate_complete', undefined)
      }
      return result
    } catch (error) {
      releaseNotesRelocationSession(senderId)
      application.get('IpcApiService').broadcast('app.notes_relocation.migrate_complete', undefined)
      throw error
    } finally {
      setNotesRelocationMigrateInFlight(false)
    }
  },
  'app.notes_relocation.complete': async (_input, { senderId }) => {
    if (senderId == null) {
      throw new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_FAILED,
        'notes relocation requires a renderer window'
      )
    }
    releaseNotesRelocationSession(senderId)
    application.get('IpcApiService').broadcast('app.notes_relocation.migrate_complete', undefined)
  },
  'app.notes_relocation.release_session': async (_input, { senderId }) => {
    if (senderId == null) {
      return
    }
    releaseNotesRelocationSession(senderId)
    application.get('IpcApiService').broadcast('app.notes_relocation.migrate_complete', undefined)
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
  'app.updater.release_notes.get': async () => application.get('AppUpdaterService').getReleaseHistory(),
  'app.updater.quit_and_install': async () => {
    application.get('AppUpdaterService').quitAndInstall()
  }
}
