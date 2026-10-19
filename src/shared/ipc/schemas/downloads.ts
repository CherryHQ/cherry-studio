import * as z from 'zod'

import { DOWNLOAD_STATES } from '@shared/data/types/download'
import { defineRoute } from '@shared/ipc/define'

export const DownloadTaskSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  mime: z.string().nullable(),
  state: z.enum(DOWNLOAD_STATES),
  totalBytes: z.number(),
  receivedBytes: z.number(),
  error: z.string().nullable(),
  createdAt: z.number()
})

export type DownloadTaskSummary = z.infer<typeof DownloadTaskSummarySchema>

const byId = z.object({ id: z.string().min(1) })

export const downloadsRequestSchemas = {
  'downloads.list': defineRoute({
    input: z.object({}),
    output: z.array(DownloadTaskSummarySchema)
  }),
  'downloads.start': defineRoute({
    input: z.object({ url: z.string().url() }),
    output: DownloadTaskSummarySchema
  }),
  'downloads.pause': defineRoute({ input: byId, output: z.void() }),
  'downloads.resume': defineRoute({ input: byId, output: z.void() }),
  'downloads.cancel': defineRoute({ input: byId, output: z.void() }),
  'downloads.retry': defineRoute({ input: byId, output: z.void() }),
  'downloads.remove': defineRoute({ input: byId, output: z.void() }),
  'downloads.open_file': defineRoute({ input: byId, output: z.void() }),
  'downloads.open_folder': defineRoute({ input: byId, output: z.void() }),
  'downloads.pick_directory': defineRoute({
    input: z.object({}),
    output: z.string().nullable()
  })
}
