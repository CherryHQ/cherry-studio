import { application } from '@application'
import type { windowRequestSchemas } from '@shared/ipc/schemas/window'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for caller-window control routes. Each one acts on the window that
 * issued the call, identified by `ctx.senderId` (the WindowId main derived from
 * `event.sender` — the renderer cannot forge it), then delegates to its lifecycle owner.
 *
 * SCOPE GUARD: caller-window controls stay with their lifecycle owner. Explicit
 * `window.main.*` / `window.sub.*` routes delegate to their domain services; opening
 * named windows (settings/search) remains outside this map.
 *
 * A null `senderId` means the caller is not a window WindowManager tracks (e.g. detached
 * devtools). That is an accepted no-op, mirroring the legacy handlers' `if (!windowId)
 * return false/null` guard.
 */
export const windowHandlers: IpcHandlersFor<typeof windowRequestSchemas> = {
  'window.close': async (_input, { senderId }) => {
    if (!senderId) return

    if (!application.get('MainWindowService').requestClose(senderId)) {
      application.get('WindowManager').close(senderId)
    }
  },
  'window.minimize': async (_input, { senderId }) => {
    if (senderId) application.get('WindowManager').minimize(senderId)
  },
  'window.maximize': async (_input, { senderId }) => {
    if (senderId) application.get('WindowManager').maximize(senderId)
  },
  'window.unmaximize': async (_input, { senderId }) => {
    if (senderId) application.get('WindowManager').unmaximize(senderId)
  },
  'window.set_full_screen': async (value, { senderId }) => {
    if (senderId) application.get('WindowManager').setFullScreen(senderId, value)
  },
  'window.is_maximized': async (_input, { senderId }) =>
    senderId ? application.get('WindowManager').isMaximized(senderId) : false,
  'window.is_full_screen': async (_input, { senderId }) =>
    senderId ? application.get('WindowManager').isFullScreen(senderId) : false,
  'window.get_init_data': async (_input, { senderId }) =>
    senderId ? application.get('WindowManager').getInitData(senderId) : null,

  // Sub-window-only contract: reject unless the caller resolves to a SubWindow-type window
  // (a non-null senderId is insufficient — the main window must not pin itself).
  'window.sub.set_always_on_top': async (pinned, { senderId }) =>
    application.get('SubWindowService').setAlwaysOnTop(senderId, pinned),

  // window.main.* — act on the main-window singleton via MainWindowService, not the caller.
  'window.main.set_minimum_size': async ({ width, height }) => {
    application.get('MainWindowService').setMainWindowMinimumSize(width, height)
  },
  'window.main.reset_minimum_size': async () => {
    application.get('MainWindowService').resetMainWindowMinimumSize()
  },
  'window.main.reload': async () => {
    application.get('MainWindowService').reloadMainWindow()
  }
}
