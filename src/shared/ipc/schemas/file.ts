import {
  AbsolutePathSchema,
  DanglingStateSchema,
  FileEntryIdSchema,
  FileEntrySchema,
  SafeNameSchema
} from '@shared/data/types/file'
import { FileHandleSchema } from '@shared/data/types/file'
import { PhysicalFileMetadataSchema, SafeExtSchema, TEXT_FILE_EDIT_MAX_BYTES } from '@shared/types/file'
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

const fileVersionSchema = z.strictObject({
  mtime: z.number().int(),
  size: z.number().int().nonnegative()
})

const textFileLineEndingSchema = z.enum(['lf', 'crlf'])
const contentHashSchema = z.string().regex(/^[0-9a-f]{16}$/)

const readTextSnapshotOutputSchema = z.strictObject({
  content: z.string().max(TEXT_FILE_EDIT_MAX_BYTES),
  version: fileVersionSchema,
  contentHash: contentHashSchema,
  lineEnding: textFileLineEndingSchema,
  hasBom: z.boolean()
})

const writeTextIfUnchangedInputSchema = z.strictObject({
  handle: FileHandleSchema,
  content: z.string().max(TEXT_FILE_EDIT_MAX_BYTES),
  lineEnding: textFileLineEndingSchema,
  hasBom: z.boolean(),
  expectedVersion: fileVersionSchema,
  expectedContentHash: contentHashSchema
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
  'file.read_text_snapshot': defineRoute({ input: FileHandleSchema, output: readTextSnapshotOutputSchema }),
  'file.write_text_if_unchanged': defineRoute({
    input: writeTextIfUnchangedInputSchema,
    output: z.strictObject({ version: fileVersionSchema, contentHash: contentHashSchema })
  }),
  'file.open': defineRoute({ input: FileHandleSchema, output: z.void() }),
  'file.show_in_folder': defineRoute({ input: FileHandleSchema, output: z.void() })
}
