import * as z from 'zod'

import { defineRoute } from '../define'

const appInfoSchema = z.object({
  version: z.string(),
  isPackaged: z.boolean(),
  appPath: z.string(),
  filesPath: z.string(),
  notesPath: z.string(),
  appDataPath: z.string(),
  resourcesPath: z.string(),
  logsPath: z.string(),
  arch: z.string(),
  isPortable: z.boolean(),
  installPath: z.string()
})

export type AppInfo = z.infer<typeof appInfoSchema>

// ── Request: renderer→main calls (zod values, always parsed) ──
export const appRequestSchemas = {
  'app.get_info': defineRoute({ input: z.void(), output: appInfoSchema })
}
