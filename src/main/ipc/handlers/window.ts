import { application } from '@application'
import type { windowRequestSchemas } from '@shared/ipc/schemas/window'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the WindowManager caller-window control routes. Each one acts on
 * the window that issued the call, identified by `ctx.senderId` (the WindowId main
 * derived from `event.sender` — the renderer cannot forge it), then delegates to the
 * matching by-id `WindowManager` method.
 *
 * SCOPE GUARD: keep this map to WindowManager caller-window operations only. Opening a
 * named window (settings/search) or driving the main-window singleton (reload, min-size)
 * are different domains — do not add them here just because they touch "a window".
 *
 * A null `senderId` means the caller is not a window WindowManager tracks (e.g. detached
 * devtools). That is an accepted no-op, mirroring the legacy handlers' `if (!windowId)
 * return false/null` guard.
 */
export const windowHandlers: IpcHandlersFor<typeof windowRequestSchemas> = {
  'window.close': async (_input, { senderId }) => {
    if (senderId) application.get('WindowManager').close(senderId)
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
  'window.is_focused': async (_input, { senderId }) =>
    senderId ? application.get('WindowManager').isFocused(senderId) : false,
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
