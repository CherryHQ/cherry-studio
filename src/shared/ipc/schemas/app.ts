import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * App IPC schemas — app-level info + imperative operations (updater, zoom, spellcheck,
 * relaunch) delegated to main services / electron. `get_info` enumerates its 12 fields
 * explicitly rather than mirroring the renderer `AppInfo` type (which omits `notesPath`,
 * a field the handler returns and consumers read).
 */
export const appRequestSchemas = {
  'app.get_info': defineRoute({
    input: z.void(),
    output: z.object({
      version: z.string(),
      isPackaged: z.boolean(),
      appPath: z.string(),
      homePath: z.string(),
      notesPath: z.string(),
      configPath: z.string(),
      appDataPath: z.string(),
      resourcesPath: z.string(),
      logsPath: z.string(),
      arch: z.string(),
      isPortable: z.boolean(),
      installPath: z.string()
    })
  }),
  // Adjust the app-wide zoom factor by `delta` (or reset to 1); returns the NEW factor.
  'app.adjust_zoom': defineRoute({
    input: z.object({ delta: z.number(), reset: z.boolean().optional() }),
    output: z.number()
  }),
  'app.set_spell_check_enabled': defineRoute({ input: z.boolean(), output: z.void() }),
  // Trigger-only: kicks off the update check; the result (available / not / error) arrives
  // via the app.updater.* broadcast events below, so the caller reads no return value.
  'app.updater.check_for_update': defineRoute({ input: z.void(), output: z.void() }),
  // Fire-and-forget: quits and installs, so no result the caller reads.
  'app.updater.quit_and_install': defineRoute({ input: z.void(), output: z.void() })
}

// Auto-updater push events (main → renderer), broadcast by AppUpdaterService.
export type AppEventSchemas = {
  'app.updater.error': Error
  'app.updater.available': UpdateInfo
  'app.updater.not_available': void
  'app.updater.download_progress': ProgressInfo
  'app.updater.downloaded': UpdateInfo
}
