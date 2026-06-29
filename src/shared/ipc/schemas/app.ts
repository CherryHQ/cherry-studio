import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * App IPC schemas — imperative app-level operations delegated to main services.
 *
 * Currently only the updater routes (handled by `AppUpdaterService`). Update
 * *progress/result events* are NOT here: they still reach the renderer through
 * the legacy `IpcChannel.Update*` broadcasts in `AppUpdaterService`, so there is
 * no Event block.
 *
 * Request-only: renderer→main calls, always parsed. Both take no input.
 */
export const appRequestSchemas = {
  'app.updater.check_for_update': defineRoute({
    input: z.void(),
    output: z.object({
      currentVersion: z.string(),
      // UpdateInfo (builder-util-runtime) | null — opaque to IPC; the renderer
      // imports the concrete type. Mirroring it in zod buys no safety here.
      updateInfo: z.unknown()
    })
  }),
  // Fire-and-forget: quits and installs, so no result the caller reads.
  'app.updater.quit_and_install': defineRoute({ input: z.void(), output: z.void() })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type AppEventSchemas = {
  'app.open_settings_tab': Record<string, never>
}
