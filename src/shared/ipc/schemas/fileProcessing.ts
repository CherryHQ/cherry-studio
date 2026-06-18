import { JobSnapshotSchema } from '@shared/data/api/schemas/jobs'
import { FILE_PROCESSOR_FEATURES, FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import {
  FileProcessingOutputTargetSchema,
  ListAvailableFileProcessorsResultSchema
} from '@shared/data/types/fileProcessing'
import { FileHandleSchema } from '@shared/file/types'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * File-processing IPC schemas — caller-facing runtime operations that delegate to
 * the stateful FileProcessingService in main.
 *
 * Only a Request block: these are zod *values* (renderer→main, untrusted → always
 * parsed). The file-processing domain pushes nothing main→renderer — job progress
 * reaches the renderer through DataApi polling of the job snapshot, not IPC events —
 * so there is no Event block (unlike window.ts/selection.ts).
 *
 * Inputs reuse the canonical file/job zod schemas. `start_job` is not annotated with
 * `z.ZodType<StartFileProcessingJobInput>`: that type's `file` is the branded
 * `FileHandle` (`path: FilePath`), but `FileHandleSchema` infers `path: string`, so an
 * exact-equality binding is impossible. The handler bridges the brand with the repo's
 * `FileHandleSchema.parse(...) as FileHandle` convention (see FileManager.ts).
 */

const startJobInputSchema = z
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
  'file_processing.start_job': defineRoute({ input: startJobInputSchema, output: JobSnapshotSchema }),
  'file_processing.list_available_processors': defineRoute({
    input: z.void(),
    output: ListAvailableFileProcessorsResultSchema
  })
}
