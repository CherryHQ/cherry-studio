import { useCommandHandler } from '@renderer/hooks/command'
import { ipcApi } from '@renderer/ipc'

/**
 * Command handlers every window owns, mounted once per window app directly inside
 * `CommandProvider`.
 *
 * Not in `AppShell`: onboarding renders instead of it, and a detached sub window never
 * mounts it at all — both would leave these commands unhandled. Surfaces that can serve a
 * command better (the MiniApp pool inspecting its visible pane) register later and win,
 * because the runtime resolves to the last enabled handler.
 */
export function WindowCommandHandlers(): null {
  useCommandHandler('app.devtools.toggle', () => void ipcApi.request('system.toggle_dev_tools'))
  return null
}
