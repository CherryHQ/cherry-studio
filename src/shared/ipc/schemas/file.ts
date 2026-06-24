import {
  AbsolutePathSchema,
  DanglingStateSchema,
  FileEntryIdSchema,
  FileEntrySchema,
  SafeNameSchema
} from '@shared/data/types/file'
import { PhysicalFileMetadataSchema } from '@shared/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

/** Maximum entry ids accepted by one file batch IPC call. */
export const FILE_IPC_MAX_BATCH_IDS = 500
/** Maximum source paths accepted by one file import IPC call. */
export const FILE_IPC_MAX_IMPORT_PATHS = 100

const fileEntryIdsInputSchema = z.strictObject({
  ids: z.array(FileEntryIdSchema).max(FILE_IPC_MAX_BATCH_IDS)
})

const fileEntryIdInputSchema = z.strictObject({
  id: FileEntryIdSchema
})

const batchMutationResultSchema = z.strictObject({
  succeeded: z.array(FileEntryIdSchema),
  failed: z.array(z.strictObject({ id: FileEntryIdSchema, error: z.string() }))
})

const batchCreateResultSchema = z.strictObject({
  succeeded: z.array(z.strictObject({ id: FileEntryIdSchema, sourceRef: z.string() })),
  failed: z.array(z.strictObject({ sourceRef: z.string(), error: z.string() }))
})

/**
 * File IPC schemas — filesystem-backed FileManager operations.
 *
 * SQL-only FileEntry reads stay on DataApi (`/files/entries`). These routes cover
 * live FS metadata and mutations / system actions that must run in main.
 */
export const fileRequestSchemas = {
  'file.batch_get_metadata': defineRoute({
    input: fileEntryIdsInputSchema,
    output: z.record(z.string(), PhysicalFileMetadataSchema.nullable())
  }),
  'file.batch_get_physical_paths': defineRoute({
    input: fileEntryIdsInputSchema,
    output: z.record(z.string(), AbsolutePathSchema.nullable())
  }),
  'file.batch_get_dangling_states': defineRoute({
    input: fileEntryIdsInputSchema,
    output: z.record(z.string(), DanglingStateSchema)
  }),
  'file.batch_trash': defineRoute({ input: fileEntryIdsInputSchema, output: batchMutationResultSchema }),
  'file.batch_restore': defineRoute({ input: fileEntryIdsInputSchema, output: batchMutationResultSchema }),
  'file.batch_permanent_delete': defineRoute({ input: fileEntryIdsInputSchema, output: batchMutationResultSchema }),
  'file.rename': defineRoute({
    input: z.strictObject({ id: FileEntryIdSchema, newName: SafeNameSchema }),
    output: FileEntrySchema
  }),
  'file.open': defineRoute({ input: fileEntryIdInputSchema, output: z.void() }),
  'file.show_in_folder': defineRoute({ input: fileEntryIdInputSchema, output: z.void() }),
  'file.import_paths': defineRoute({
    input: z.strictObject({ paths: z.array(AbsolutePathSchema).min(1).max(FILE_IPC_MAX_IMPORT_PATHS) }),
    output: batchCreateResultSchema
  })
}
