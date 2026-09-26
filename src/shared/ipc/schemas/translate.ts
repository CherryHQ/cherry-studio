import * as z from 'zod'

import { type TranslateLangCode, TranslateLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import { SafeNameSchema } from '@shared/data/types/file'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { MAX_TRANSLATE_IMAGE_BYTES } from '@shared/utils/constants'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

const pdfJobInputSchema = z.strictObject({ jobId: z.uuid() })
const translateImageSchema = z.strictObject({
  data: uint8ArraySchema.refine(
    (data) => data.byteLength > 0 && data.byteLength <= MAX_TRANSLATE_IMAGE_BYTES,
    'translation image bytes out of range'
  ),
  filename: SafeNameSchema
})

/**
 * Translate IPC schema — an independent micro-domain (plan ruling 16). `translate.open`
 * OPENS a streaming translation and returns its `streamId`; the streamed chunks/done/error
 * keep riding the shared `ai.stream_*` events (keyed by streamId), and abort goes through
 * `ai.stream.abort` — none of that changes here. The renderer subscribes to those events
 * before calling `open`. `streamId` must be prefixed `translate:` (validated in the service).
 */
export const translateRequestSchemas = {
  'translate.open': defineRoute({
    input: z.strictObject({
      streamId: z.string(),
      text: z.string(),
      targetLangCode: z.custom<TranslateLangCode>(),
      /** Clipboard/screenshot bytes captured during the user's paste/select action. */
      image: translateImageSchema.optional()
    }),
    output: z.strictObject({ streamId: z.string() })
  }),
  'translate.pdf.start': defineRoute({
    input: pdfJobInputSchema.extend({
      sourcePath: AbsoluteFilePathSchema,
      sourceLangCode: z.union([z.literal('auto'), TranslateLangCodeSchema]),
      targetLangCode: TranslateLangCodeSchema.refine((code) => code !== 'unknown', {
        message: 'targetLangCode must be a concrete language, not "unknown"'
      }),
      modelId: UniqueModelIdSchema
    }),
    /**
     * `outputPath` is the translated PDF's managed location — the run records itself in
     * translate history and hands the artifact to FileManager, so there is no temp file
     * for the renderer to clean up (hence no `translate.pdf.cleanup` companion route).
     */
    output: z.strictObject({ outputPath: AbsoluteFilePathSchema, fileName: z.string().min(1) })
  }),
  'translate.pdf.cancel': defineRoute({ input: pdfJobInputSchema, output: z.void() })
}

export const PDF_TRANSLATION_PROGRESS_STAGES = [
  'checking_assets',
  'downloading_assets',
  'loading_model',
  'parsing',
  'analyzing',
  'extracting_terms',
  'translating',
  'typesetting',
  'rendering'
] as const

export type PdfTranslationProgressStage = (typeof PDF_TRANSLATION_PROGRESS_STAGES)[number]

export interface PdfTranslationProgress {
  stage: PdfTranslationProgressStage
  /** Completion within the current stage, or null when BabelDOC cannot measure it. */
  stageProgress: number | null
  /** Monotonic completion across initialization and translation, 0–100. */
  overallProgress: number
}

/** Coarse pipeline stage reported via `onStage`, distinct from the fine-grained `PdfTranslationProgressStage`. */
export type PdfTranslationStage = 'preparing' | 'downloading_assets' | 'translating'

export type TranslateEventSchemas = {
  'translate.pdf.stage': {
    jobId: string
    stage: PdfTranslationStage
  }
  'translate.pdf.progress': PdfTranslationProgress & {
    jobId: string
  }
}
