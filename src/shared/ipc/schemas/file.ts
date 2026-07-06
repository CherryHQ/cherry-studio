import {
  AbsolutePathSchema,
  DanglingStateSchema,
  FileEntryIdSchema,
  FileEntrySchema,
  SafeNameSchema
} from '@shared/data/types/file'
import { FileHandleSchema } from '@shared/data/types/file'
import { PhysicalFileMetadataSchema, SafeExtSchema } from '@shared/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

/** Maximum entry ids accepted by one file batch IPC call. */
export const FILE_IPC_MAX_BATCH_IDS = 500
/** Maximum items accepted by one internal-entry batch-create IPC call. */
export const FILE_IPC_MAX_BATCH_CREATE_ITEMS = 100

const fileEntryIdsInputSchema = z.strictObject({
  ids: z.array(FileEntryIdSchema).max(FILE_IPC_MAX_BATCH_IDS)
})

const batchGetMetadataInputSchema = z.strictObject({
  items: z.array(z.strictObject({ key: z.string().min(1), handle: FileHandleSchema })).max(FILE_IPC_MAX_BATCH_IDS)
})

const batchMutationResultSchema = z.strictObject({
  succeeded: z.array(FileEntryIdSchema),
  failed: z.array(z.strictObject({ id: FileEntryIdSchema, error: z.string() }))
})

const batchCreateResultSchema = z.strictObject({
  succeeded: z.array(z.strictObject({ id: FileEntryIdSchema, sourceRef: z.string() })),
  failed: z.array(z.strictObject({ sourceRef: z.string(), error: z.string() }))
})

// TODO(file-ipc): Unify these schemas with the branded transport types in
// `src/shared/types/file/ipc.ts`. `FilePath`, `Base64String`, and `UrlString` are
// TS-only aliases while their runtime schemas live elsewhere, so a successful
// Zod parse still cannot prove `CreateInternalEntryIpcParams` without an `as`
// cast in the handler. Keeping the type and schema definitions separate risks
// future drift; refactor them to share one source of truth before migrating the
// remaining File IPC surface.
const createInternalEntryInputSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('path'), path: AbsolutePathSchema }),
  z.strictObject({ source: z.literal('url'), url: z.url() }),
  z.strictObject({ source: z.literal('base64'), data: z.string().min(1), name: SafeNameSchema.optional() }),
  z.strictObject({
    source: z.literal('bytes'),
    data: z.instanceof(Uint8Array),
    name: SafeNameSchema,
    ext: SafeExtSchema.nullable()
  })
])

const batchCreateInternalEntriesInputSchema = z.strictObject({
  items: z.array(createInternalEntryInputSchema).min(1).max(FILE_IPC_MAX_BATCH_CREATE_ITEMS)
})

/**
 * File IPC schemas — filesystem-backed FileManager operations.
 *
 * SQL-only FileEntry reads stay on DataApi (`/files/entries`). These routes cover
 * live FS metadata and mutations / system actions that must run in main.
 */
export const fileRequestSchemas = {
  'file.batch_get_metadata': defineRoute({
    input: batchGetMetadataInputSchema,
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
  'file.batch_create_internal_entries': defineRoute({
    input: batchCreateInternalEntriesInputSchema,
    output: batchCreateResultSchema
  }),
  'file.batch_trash': defineRoute({ input: fileEntryIdsInputSchema, output: batchMutationResultSchema }),
  'file.batch_restore': defineRoute({ input: fileEntryIdsInputSchema, output: batchMutationResultSchema }),
  'file.batch_permanent_delete': defineRoute({ input: fileEntryIdsInputSchema, output: batchMutationResultSchema }),
  'file.empty_trash': defineRoute({ input: z.void(), output: batchMutationResultSchema }),
  'file.rename': defineRoute({
    input: z.strictObject({ id: FileEntryIdSchema, newName: SafeNameSchema }),
    output: FileEntrySchema
  }),
  'file.open': defineRoute({ input: FileHandleSchema, output: z.void() }),
  'file.show_in_folder': defineRoute({ input: FileHandleSchema, output: z.void() })
}
