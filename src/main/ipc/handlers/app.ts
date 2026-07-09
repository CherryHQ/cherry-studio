import { application } from '@application'
import { requestRelocation } from '@main/core/preboot/userDataLocation'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { BrowserWindow, type Session, session } from 'electron'

async function flushAppDataSessions(): Promise<void> {
  const sessions = new Set<Session>([session.defaultSession, session.fromPartition('persist:webview')])

  for (const window of BrowserWindow.getAllWindows()) {
    sessions.add(window.webContents.session)
  }

  for (const electronSession of sessions) {
    electronSession.flushStorageData()
    await electronSession.cookies.flushStore()
    await electronSession.closeAllConnections()
  }
}

/**
 * Thin adapters for the app request routes: each delegates to `AppUpdaterService`,
 * which owns the electron-updater lifecycle. These act on app-level state, not the
 * caller's window, so they ignore `IpcContext`.
 *
 * `quit_and_install` uses a block body so the arrow resolves `undefined`, matching
 * the route's `z.void()` output.
 */
export const appHandlers: IpcHandlersFor<typeof appRequestSchemas> = {
  'app.updater.check_for_update': async () => {
    const { currentVersion, updateInfo } = await application.get('AppUpdaterService').checkForUpdates()
    // `currentVersion` may be a SemVer (autoUpdater.currentVersion) or a string
    // (app.getVersion()); normalize to a plain string for the IPC contract.
    return { currentVersion: String(currentVersion), updateInfo }
  },
  'app.updater.quit_and_install': async () => {
    application.get('AppUpdaterService').quitAndInstall()
  },
  'app.set_user_data_path': async ({ path, copyData = false }) => {
    if (copyData) {
      await flushAppDataSessions()
    }

    requestRelocation(application.getPath('app.userdata'), path, copyData)
  }
}
