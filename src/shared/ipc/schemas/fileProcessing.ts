import * as z from 'zod'

import { FILE_PROCESSOR_FEATURES, FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import { FileHandleSchema } from '@shared/data/types/file'
import {
  FileProcessingOutputTargetSchema,
  FileProcessingTaskIdSchema,
  FileProcessingTaskSchema,
  ListAvailableFileProcessorsResultSchema
} from '@shared/data/types/fileProcessing'

import { defineRoute } from '../define'

/**
 * File-processing IPC schemas — caller-facing runtime operations that delegate to
 * the stateful FileProcessingService in main.
 *
 * Only a Request block: these are zod *values* (renderer→main, untrusted → always
 * parsed). The file-processing domain pushes nothing main→renderer — a task's state
 * reaches the renderer via the shared Cache (`file_processing.task.*`, cross-window-synced
 * by CacheService; `get_task` reads a task whose entry has expired), not IPC events — so
 * there is no Event block (unlike window.ts/selection.ts).
 *
 * Inputs reuse the canonical file zod schemas. `FileHandleSchema.path` is
 * `AbsoluteFilePathSchema`, so the schema infers the branded `FileHandle` directly —
 * the parsed `start_task` input's `file` is already a `FileHandle`, needing no cast.
 */

const startTaskInputSchema = z
  .object({
    feature: z.enum(FILE_PROCESSOR_FEATURES),
    file: FileHandleSchema,
    output: FileProcessingOutputTargetSchema.optional(),
    context: z
      .object({
        dataId: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    processorId: z.enum(FILE_PROCESSOR_IDS).optional()
  })
  .strict()

// ── Request: renderer→main calls (zod values, always parsed) ──
export const fileProcessingRequestSchemas = {
  'file_processing.start_task': defineRoute({ input: startTaskInputSchema, output: FileProcessingTaskSchema }),
  /** Null when no such task exists. */
  'file_processing.get_task': defineRoute({
    input: z.object({ taskId: FileProcessingTaskIdSchema }).strict(),
    output: FileProcessingTaskSchema.nullable()
  }),
  'file_processing.list_available_processors': defineRoute({
    input: z.void(),
    output: ListAvailableFileProcessorsResultSchema
  }),
  /**
   * Is the configured Open MinerU host answering? A probe that cannot reach the
   * host is an answer, not a failure, so it resolves false rather than rejecting.
   */
  'file_processing.open_mineru.check_connectivity': defineRoute({
    input: z.void(),
    output: z.boolean()
  })
}
