import { arch } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { canonicalize } from '@main/core/preboot/factoryResetGate'
import { bootConfigService } from '@main/data/bootConfig'
import { t } from '@main/i18n'
import { inspectUserDataRelocationTarget, requestUserDataRelocation } from '@main/services/userDataRelocation'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { appRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { app, BrowserWindow, dialog, session, webContents } from 'electron'

const logger = loggerService.withContext('IpcHandler:app')

/**
 * Clear every storage kind of the sessions Cherry uses (the same pair the
 * "Clear cache" feature targets: default + the miniapp webview partition).
 * No `storages` filter — a factory reset clears everything the API knows,
 * including kinds a future Chromium adds.
 */
async function clearChromiumState(): Promise<void> {
  const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
  for (const s of sessions) {
    try {
      await s.clearCache()
      await s.clearStorageData()
      await s.clearAuthCache()
    } catch (error) {
      logger.warn('Failed to clear a session during factory reset request', { error: String(error) })
    }
  }
}

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
  // Stage a factory reset (#17131) and relaunch; the preboot factoryResetGate
  // wipes on the next boot. persist() (not flush) so a failed write rejects
  // the request instead of relaunching without a staged marker.
  'app.factory_reset.request': async () => {
    // Final confirmation lives HERE, in a native dialog, not in the renderer:
    // the request arms a whole-profile wipe, and a compromised or buggy
    // renderer must not be able to arm it with a single unconfirmed IPC call.
    // Declining resolves without staging anything — a silent no-op, since the
    // user just cancelled.
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: t('dialog.factory_reset.title'),
      message: t('dialog.factory_reset.message'),
      detail: t('dialog.factory_reset.detail'),
      buttons: [t('dialog.factory_reset.cancel'), t('dialog.factory_reset.confirm')],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    const userDataPath = application.getPath('app.userdata')
    const previous = bootConfigService.get('temp.factory_reset')
    bootConfigService.set('temp.factory_reset', {
      status: 'pending',
      userDataPath,
      // Pin the physical directory the user confirmed: the gate refuses a
      // wipe whose realpath resolution has changed since this moment.
      canonicalPath: canonicalize(userDataPath),
      requestedAt: new Date().toISOString()
    })
    try {
      bootConfigService.persist()
    } catch (error) {
      // Roll back the in-memory marker (same pattern as userDataRelocation):
      // persist() keeps the dirty flag on failure, so a later flush — e.g.
      // during shutdown — would otherwise stage the wipe the user was just
      // told had failed.
      bootConfigService.set('temp.factory_reset', previous)
      throw error
    }

    // Semantic Chromium clear while the sessions are alive — the layer the
    // preboot gate cannot provide (it can only rm the storage directories it
    // knows by name; this API call covers whatever the running Chromium
    // actually persisted). Best-effort by design: the marker is already
    // durable, and the gate's rm pass is the deterministic layer.
    await clearChromiumState()

    // Graceful relaunch, not application.relaunch(): running services (OVMS
    // and friends) must release their child processes and file handles
    // before the next boot's gate deletes the files they may hold open.
    await application.relaunchAfterShutdown()
  },
  'app.updater.check_for_update': async () => {
    await application.get('AppUpdaterService').checkForUpdates()
  },
  'app.updater.quit_and_install': async () => {
    application.get('AppUpdaterService').quitAndInstall()
  }
}
