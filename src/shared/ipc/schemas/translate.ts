import { type TranslateLangCode, TranslateLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

const pdfJobInputSchema = z.strictObject({ jobId: z.uuid() })

/**
 * Translate IPC schema — an independent micro-domain (plan ruling 16). `translate.open`
 * OPENS a streaming translation and returns its `streamId`; the streamed chunks/done/error
 * keep riding the shared `ai.stream_*` events (keyed by streamId), and abort goes through
 * `ai.stream.abort` — none of that changes here. The renderer subscribes to those events
 * before calling `open`. `streamId` must be prefixed `translate:` (validated in the service).
 */
const taskIdInputSchema = z.strictObject({ taskId: z.uuid() })

export const translateRequestSchemas = {
  'translate.open': defineRoute({
    input: z.object({
      streamId: z.string(),
      text: z.string(),
      targetLangCode: z.custom<TranslateLangCode>()
    }),
    output: z.object({ streamId: z.string() })
  }),
  /** Detect a text's language on its own — for callers that are not running a full task. */
  'translate.detect': defineRoute({
    input: z.object({ text: z.string() }),
    output: z.strictObject({ langCode: TranslateLangCodeSchema })
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
  'translate.pdf.cancel': defineRoute({ input: pdfJobInputSchema, output: z.void() }),
  /**
   * Runs a whole translation — detect the source language, resolve the target from it, stream the
   * result — as one main-owned task. The renderer holds `taskId` in its tab session and follows
   * `translate.task.*` events; the text itself still rides `ai.stream.*` keyed by `streamId`, so
   * nothing about consuming a translation changes.
   */
  'translate.task.start': defineRoute({
    input: z.object({
      text: z.string(),
      sourceLangCode: z.union([z.literal('auto'), TranslateLangCodeSchema]),
      targetLangCode: TranslateLangCodeSchema,
      bidirectional: z.boolean(),
      bidirectionalPair: z.tuple([TranslateLangCodeSchema, TranslateLangCodeSchema])
    }),
    output: z.strictObject({ taskId: z.uuid(), streamId: z.string() })
  }),
  'translate.task.cancel': defineRoute({ input: taskIdInputSchema, output: z.void() }),
  /**
   * Re-point a task at the calling window and get back what it missed. This is what a rebuilt
   * renderer calls after a detach; `undefined` means the task already settled.
   */
  'translate.task.attach': defineRoute({
    input: taskIdInputSchema,
    output: z
      .strictObject({
        taskId: z.uuid(),
        streamId: z.string(),
        busy: z.boolean(),
        accumulated: z.string(),
        detectedSourceLanguage: z.union([TranslateLangCodeSchema, z.null()])
      })
      .optional()
  })
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
  /** Task progress that is not the text itself — currently only the detected source language. */
  'translate.task.state': {
    taskId: string
    streamId: string
    busy: boolean
    accumulated: string
    detectedSourceLanguage: TranslateLangCode | null
  }
  'translate.task.completed': {
    taskId: string
    text: string
    sourceLangCode?: TranslateLangCode
  }
  'translate.task.aborted': { taskId: string }
  /** Carries a bare i18n key; whether it reaches the screen is the renderer's decision. */
  'translate.task.failed': { taskId: string; messageKey: string }
  'translate.pdf.stage': {
    jobId: string
    stage: PdfTranslationStage
  }
  'translate.pdf.progress': PdfTranslationProgress & {
    jobId: string
  }
}
