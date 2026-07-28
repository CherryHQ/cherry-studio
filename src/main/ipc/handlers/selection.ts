import { application } from '@application'
import type { selectionRequestSchemas } from '@shared/ipc/schemas/selection'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the selection request routes: each one translates a parsed
 * route call into a `SelectionService` method (business logic + resource lifecycle
 * stay in that service). `pin_action_window` is the exception — pinning is a pure
 * WindowManager operation with no selection-specific state, so it routes straight
 * to `wm.behavior`, the by-id home for alwaysOnTop.
 */
export const selectionHandlers: IpcHandlersFor<typeof selectionRequestSchemas> = {
  'selection.hide_toolbar': async () => {
    application.get('SelectionService').hideToolbar()
  },
  'selection.write_to_clipboard': async (text) => application.get('SelectionService').writeToClipboard(text) ?? false,
  'selection.determine_toolbar_size': async ({ width, height }) => {
    application.get('SelectionService').determineToolbarSize(width, height)
  },
  'selection.process_action': async ({ actionItem, isFullScreen }) => {
    application.get('SelectionService').processAction(actionItem, isFullScreen)
  },
  'selection.pin_action_window': async (isPinned, ctx) => {
    // The caller IS the action window; pin it by its own id. `behavior.setAlwaysOnTop`
    // already no-ops on a missing/destroyed window, so no BrowserWindow round-trip or
    // isDestroyed guard is needed. A null senderId (caller is not a managed window) is
    // an accepted no-op (see ipc-overview.md, "senderId: null semantics").
    if (ctx.senderId) application.get('WindowManager').behavior.setAlwaysOnTop(ctx.senderId, isPinned)
  },
  'selection.get_linux_env_info': async () => application.get('SelectionService').getLinuxEnvInfo()
}
