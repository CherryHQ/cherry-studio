import { application } from '@application'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'

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
  }
}
