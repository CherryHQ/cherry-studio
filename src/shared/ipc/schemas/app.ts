import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import * as z from 'zod'

import { type RelocationProgress, USER_DATA_RELOCATION_VALIDATION_REASONS } from '../../types/relocation'
import { defineRoute } from '../define'

const relocationInspectionSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(true), targetExists: z.boolean(), targetEmpty: z.boolean() }),
  z.object({ valid: z.literal(false), reason: z.enum(USER_DATA_RELOCATION_VALIDATION_REASONS) })
])

const relocationProgressSchema: z.ZodType<RelocationProgress> = z.object({
  stage: z.enum(['preparing', 'copying', 'committing', 'completed', 'failed']),
  from: z.string(),
  to: z.string(),
  copy: z.boolean(),
  bytesCopied: z.number(),
  bytesTotal: z.number(),
  error: z.string().optional()
})

export const userDataRelocationWindowRequestSchemas = {
  'app.user_data_relocation.get_progress': defineRoute({
    input: z.void(),
    output: relocationProgressSchema.nullable()
  }),
  'app.user_data_relocation.restart': defineRoute({ input: z.void(), output: z.void() })
}

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
  'app.inspect_user_data_relocation': defineRoute({
    input: z.object({ path: z.string().min(1) }),
    output: relocationInspectionSchema
  }),
  'app.request_user_data_relocation': defineRoute({
    input: z.object({
      path: z.string().min(1),
      copy: z.boolean()
    }),
    output: z.void()
  }),
  ...userDataRelocationWindowRequestSchemas,
  'app.relaunch': defineRoute({ input: z.void(), output: z.void() }),
  'app.adjust_zoom': defineRoute({
    input: z.object({ delta: z.number(), reset: z.boolean().optional() }),
    output: z.number()
  }),
  'app.set_spell_check_enabled': defineRoute({ input: z.boolean(), output: z.void() }),
  'app.updater.check_for_update': defineRoute({ input: z.void(), output: z.void() }),
  'app.updater.quit_and_install': defineRoute({ input: z.void(), output: z.void() })
}

export type AppEventSchemas = {
  'app.user_data_relocation.progress': RelocationProgress
  'app.updater.error': Error
  'app.updater.available': UpdateInfo
  'app.updater.not_available': void
  'app.updater.download_progress': ProgressInfo
  'app.updater.downloaded': UpdateInfo
}
