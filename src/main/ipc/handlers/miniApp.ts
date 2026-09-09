import { application } from '@application'
import { miniAppActivityLog } from '@main/features/miniApp/activityLog'
import { uninstallMiniApp } from '@main/features/miniApp/install/installer'
import {
  cancelPending,
  confirmPendingInstall,
  previewBuiltinForInstall,
  previewFileForInstall,
  previewUrlForInstall
} from '@main/features/miniApp/install/installFlow'
import { applyUpdate, checkForUpdate, rollbackUpdate } from '@main/features/miniApp/install/webInstaller'
import {
  checkUpdateOnOpen,
  clearMiniAppData,
  grantMiniAppPermission,
  grantPendingAdditions,
  miniAppDetail,
  revokeMiniAppGrant,
  snoozePendingAdditions
} from '@main/features/miniApp/management'
import { setMiniAppLogo } from '@main/services/entityLogo'
import type { miniAppRequestSchemas } from '@shared/ipc/schemas/miniApp'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'
import { dialog } from 'electron'

function senderWebContents(senderId: WindowId | null): Electron.WebContents | undefined {
  if (senderId == null) return undefined
  return application.get('WindowManager').getWindow(senderId)?.webContents
}

/**
 * Mini-app imperative command handlers. Thin adapter: `mini_app.settings.set_logo`
 * delegates the create→bind→compensate orchestration to `setMiniAppLogo`; the
 * install routes delegate every rule (null owner, owner match, TTL, re-verification)
 * to `installFlow.ts`.
 */
export const miniAppHandlers: IpcHandlersFor<typeof miniAppRequestSchemas> = {
  'mini_app.settings.set_logo': ({ appId, image }) => setMiniAppLogo(appId, image),
  'mini_app.install.pick_and_preview': async (_input, ctx) => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Mini App', extensions: ['miniapp'] }]
    })
    // Dismissing the dialog is normal use, not an error — and nothing was registered.
    if (picked.canceled || !picked.filePaths[0]) return null
    return previewFileForInstall(picked.filePaths[0], ctx.senderId)
  },
  'mini_app.install.preview_file': ({ filePath }, ctx) => previewFileForInstall(filePath, ctx.senderId),
  'mini_app.install.preview_url': async ({ manifestUrl }, ctx) => previewUrlForInstall(manifestUrl, ctx.senderId),
  'mini_app.install.preview_builtin': ({ appId }, ctx) => previewBuiltinForInstall(appId, ctx.senderId),
  'mini_app.install.confirm': ({ installToken, grantedOptional, reinstall }, ctx) =>
    confirmPendingInstall(installToken, ctx.senderId, grantedOptional, reinstall),
  'mini_app.install.cancel_preview': async ({ installToken }, ctx) => cancelPending(installToken, ctx.senderId),
  'mini_app.uninstall': ({ appId }) => uninstallMiniApp(appId),
  'mini_app.runtime.prepare': async ({ appId }) => {
    // Readiness and nothing else: returning the preload path would be a needless
    // disclosure, and main imposes it in `will-attach-webview` anyway.
    const runtime = application.get('MiniAppRuntimeService')
    // Refused rather than queued: "wait silently, then run the old version" is worse
    // than a visible "this app is updating".
    if (runtime.isQuiescing(appId)) throw new Error(`Mini app ${appId} is being updated`)
    await runtime.ensurePartition(appId)
  },
  // Detail-panel routes: every rule lives in `management.ts` / `webInstaller.ts`.
  'mini_app.detail': async ({ appId }) => miniAppDetail(appId),
  'mini_app.activity.list': ({ appId, limit, deniedOnly }) => miniAppActivityLog.list(appId, { limit, deniedOnly }),
  'mini_app.activity.clear': ({ appId }) => miniAppActivityLog.clear(appId),
  'mini_app.activity.open_folder': ({ appId }) => miniAppActivityLog.openFolder(appId),
  'mini_app.runtime.set_visible': async ({ appId, visible }, ctx) => {
    // Keyed by the host webContents the guest hangs off — an unmanaged sender has no pool.
    const host = senderWebContents(ctx.senderId)
    if (host) application.get('MiniAppRuntimeService').setPaneVisible(host.id, appId, visible)
  },
  'mini_app.clear_data': async ({ appId }) => clearMiniAppData(appId),
  'mini_app.grant.approve_pending': async ({ appId }) => grantPendingAdditions(appId),
  'mini_app.grant.snooze_pending': async ({ appId }) => snoozePendingAdditions(appId),
  'mini_app.grant.approve': async ({ appId, permission }) => grantMiniAppPermission(appId, permission),
  'mini_app.grant.revoke': async ({ appId, permission }) => revokeMiniAppGrant(appId, permission),
  'mini_app.update.check': async ({ appId }) => checkForUpdate(appId),
  'mini_app.update.check_on_open': async ({ appId }) => checkUpdateOnOpen(appId),
  'mini_app.update.apply': async (input) => applyUpdate(input.appId, input),
  'mini_app.update.rollback': async ({ appId }) => rollbackUpdate(appId)
}
