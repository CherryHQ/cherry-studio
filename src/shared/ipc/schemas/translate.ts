import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Translate IPC schema — an independent micro-domain (plan ruling 16). `translate.open`
 * OPENS a streaming translation and returns its `streamId`; the streamed chunks/done/error
 * keep riding the shared `ai.stream_*` events (keyed by streamId), and abort goes through
 * `ai.stream_abort` — none of that changes here. The renderer subscribes to those events
 * before calling `open`. `streamId` must be prefixed `translate:` (validated in the service).
 */
export const translateRequestSchemas = {
  'translate.open': defineRoute({
    input: z.object({
      streamId: z.string(),
      text: z.string(),
      targetLangCode: z.custom<TranslateLangCode>(),
      messageId: z.string().optional(),
      sourceLangCode: z.custom<TranslateLangCode>().optional()
    }),
    output: z.object({ streamId: z.string() })
  })
}
