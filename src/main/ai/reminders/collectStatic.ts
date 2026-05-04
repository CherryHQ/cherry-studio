/**
 * Run every static reminder source for the current ctx, drop nulls,
 * and isolate failures: a source that throws is logged and skipped —
 * other sources still contribute. The try/catch isolation is a
 * deliberate design choice; if you ever refactor this loop, keep it.
 */

import { loggerService } from '@logger'

import { STATIC_REMINDER_SOURCES } from './sources/registry'
import type { ReminderBlock, StaticReminderCtx } from './types'

const logger = loggerService.withContext('collectStaticReminders')

export async function collectStaticReminders(ctx: StaticReminderCtx): Promise<ReminderBlock[]> {
  const results = await Promise.all(
    STATIC_REMINDER_SOURCES.map(async (source) => {
      try {
        return await source(ctx)
      } catch (err) {
        logger.warn('static reminder source threw, dropping', { error: String(err) })
        return null
      }
    })
  )
  return results.filter((b): b is ReminderBlock => b !== null)
}
