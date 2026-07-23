import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import * as z from 'zod'

import { USER_DATA_RELOCATION_VALIDATION_REASONS } from '../../types/userDataRelocation'
import { defineRoute } from '../define'

const relocationInspectionSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(true), targetEmpty: z.boolean() }),
  z.object({ valid: z.literal(false), reason: z.enum(USER_DATA_RELOCATION_VALIDATION_REASONS) })
])

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
  'app.user_data_relocation.inspect': defineRoute({
    input: z.object({ path: z.string().min(1) }),
    output: relocationInspectionSchema
  }),
  'app.user_data_relocation.request': defineRoute({
    input: z.object({
      path: z.string().min(1),
      copy: z.boolean()
    }),
    output: z.void()
  }),
  'app.relaunch': defineRoute({ input: z.void(), output: z.void() }),
  'app.adjust_zoom': defineRoute({
    input: z.object({ delta: z.number(), reset: z.boolean().optional() }),
    output: z.number()
  }),
  'app.set_spell_check_enabled': defineRoute({ input: z.boolean(), output: z.void() }),
  // Data reset (#17131): shows a native main-process confirmation (the
  // renderer's own dialogs don't count as arming authority for a
  // whole-profile wipe), then durably writes the pending-marker file into
  // userData and relaunches; runDataReset performs the wipe at preboot on
  // the next boot. Resolving void is ambiguous (user cancelled at the native
  // dialog, or the relaunch killed this process first) — callers must not
  // rely on it. A *rejection* is meaningful: the marker could not be written
  // and no relaunch was triggered.
  'app.data_reset.request': defineRoute({ input: z.void(), output: z.void() }),
  'app.updater.check_for_update': defineRoute({ input: z.void(), output: z.void() }),
  'app.updater.quit_and_install': defineRoute({ input: z.void(), output: z.void() })
}

export type AppEventSchemas = {
  'app.updater.error': Error
  'app.updater.available': UpdateInfo
  'app.updater.not_available': void
  'app.updater.download_progress': ProgressInfo
  'app.updater.downloaded': UpdateInfo
}
