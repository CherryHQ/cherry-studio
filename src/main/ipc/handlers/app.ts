import { arch } from 'node:os'

import { app, BrowserWindow } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { cacheCleanupService } from '@main/services/cacheCleanup'
import { requestDataReset, requestV1Remigration } from '@main/services/dataReset'
import {
  completeNotesMigrationCommit,
  getNotesMigrationSessionId,
  inspectNotesRelocation,
  migrateNotesDirectory,
  releaseNotesMigrationSession,
  rendererEditFlushCoordinator,
  scheduleAwaitingMigrationCommit,
  setNotesMigrationBlockedRoots,
  tryBeginNotesDirectoryMigration
} from '@main/services/notesRelocation'
import { inspectUserDataRelocationTarget, requestUserDataRelocation } from '@main/services/userDataRelocation'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'

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
  'app.notes_relocation.inspect': async ({ sourcePath, targetPath }) => inspectNotesRelocation(sourcePath, targetPath),
  'app.notes_relocation.migrate': async ({ sourcePath, targetPath, merge }, ctx) => {
    if (!tryBeginNotesDirectoryMigration()) {
      throw new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_FAILED,
        'another notes directory migration is already in progress'
      )
    }
    try {
      const prepared = await rendererEditFlushCoordinator.prepareForMigration()
      if (!prepared) {
        releaseNotesMigrationSession()
        throw new IpcError(
          notesRelocationErrorCodes.NOTES_RELOCATION_FAILED,
          'a renderer window failed to prepare for notes directory migration'
        )
      }
      setNotesMigrationBlockedRoots(sourcePath, targetPath)
      const result = await migrateNotesDirectory(sourcePath, targetPath, { merge })
      const sessionId = getNotesMigrationSessionId()
      if (!sessionId) {
        releaseNotesMigrationSession()
        throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_FAILED, 'notes migration session is missing')
      }
      scheduleAwaitingMigrationCommit(ctx.senderId)
      return { ...result, sessionId }
    } catch (error) {
      releaseNotesMigrationSession()
      throw error
    }
  },
  'app.notes_relocation.commit': async ({ sessionId }) => {
    completeNotesMigrationCommit(sessionId)
  },
  'app.notes_relocation.migration_lock_ack': async ({ batchId, ok }, ctx) => {
    rendererEditFlushCoordinator.acknowledgeMigrationLock(batchId, ctx.senderId, ok)
  },
  'app.notes_relocation.flush_ack': async ({ batchId, ok }, ctx) => {
    rendererEditFlushCoordinator.acknowledgeFlush(batchId, ctx.senderId, ok)
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
