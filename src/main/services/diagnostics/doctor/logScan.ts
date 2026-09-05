import { application } from '@application'

import { collectErrorLogRecords } from '../scan'
import type { DoctorContext } from './types'

export function recentLogScan(ctx: DoctorContext) {
  return ctx.share('doctor:seven-day-logs', async (signal) => {
    const toMs = Date.now()
    const scan = await collectErrorLogRecords(
      application.getPath('app.logs'),
      {
        fromMs: toMs - 7 * 24 * 60 * 60 * 1000,
        toMs
      },
      signal
    )
    return { ...scan, toMs, complete: !scan.truncated && scan.skippedFileCount === 0 && scan.unparsedLineCount === 0 }
  })
}
