import * as z from 'zod'

import { defineRoute } from '../define'

export const englishLearningRequestSchemas = {
  'english_learning.reminder.snooze': defineRoute({
    input: z.strictObject({
      minutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .optional()
    }),
    output: z.strictObject({ snoozedUntil: z.iso.datetime() })
  }),
  'english_learning.reminder.open_today': defineRoute({
    input: z.void(),
    output: z.void()
  })
}
