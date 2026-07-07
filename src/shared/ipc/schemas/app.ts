import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * App IPC schemas — imperative app-level operations delegated to main/preboot
 * services.
 *
 * Updater routes are handled by `AppUpdaterService`. Update *progress/result
 * events* are NOT here: they still reach the renderer through the legacy
 * `IpcChannel.Update*` broadcasts in `AppUpdaterService`, so there is no Event
 * block.
 *
 * Request-only: renderer→main calls, always parsed.
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
  'app.updater.quit_and_install': defineRoute({ input: z.void(), output: z.void() }),
  'app.set_user_data_path': defineRoute({
    input: z.object({
      path: z.string().min(1),
      copyData: z.boolean().optional(),
      overwriteExisting: z.boolean().optional()
    }),
    output: z.void()
  })
}
