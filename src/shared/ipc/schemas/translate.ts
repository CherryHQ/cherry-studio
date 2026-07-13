import { type TranslateLangCode, TranslateLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import { AbsolutePathSchema } from '@shared/data/types/file'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

import { defineRoute } from '../define'

const pdfJobInputSchema = z.strictObject({ jobId: z.uuid() })

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
  }),
  'translate.pdf.start': defineRoute({
    input: pdfJobInputSchema.extend({
      sourcePath: AbsolutePathSchema,
      sourceLangCode: z.union([z.literal('auto'), TranslateLangCodeSchema]),
      targetLangCode: TranslateLangCodeSchema.refine((code) => code !== 'unknown'),
      modelId: UniqueModelIdSchema
    }),
    output: z.strictObject({ outputPath: AbsolutePathSchema, fileName: z.string().min(1) })
  }),
  'translate.pdf.cancel': defineRoute({ input: pdfJobInputSchema, output: z.void() }),
  'translate.pdf.cleanup': defineRoute({ input: pdfJobInputSchema, output: z.void() })
}

export type TranslateEventSchemas = {
  'translate.pdf.stage': {
    jobId: string
    stage: 'installing' | 'translating'
  }
}
