import {
  AbsolutePathSchema,
  CleanupPolicySchema,
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

// Fields common to every create-entry source. `cleanupPolicy` is required at
// all creation surfaces (file-entry-cleanup.md §4.1) — written once here, not
// per union branch. `.extend()` keeps the branches strict.
const createInternalEntryBaseSchema = z.strictObject({ cleanupPolicy: CleanupPolicySchema })

// TODO(file-ipc): Unify these schemas with the branded transport types in
// `src/shared/types/file/ipc.ts`. `FilePath`, `Base64String`, and `UrlString` are
// TS-only aliases while their runtime schemas live elsewhere, so a successful
// Zod parse still cannot prove `CreateInternalEntryIpcParams` without an `as`
// cast in the handler. Keeping the type and schema definitions separate risks
// future drift; refactor them to share one source of truth before migrating the
// remaining File IPC surface.
//
// Exported: the legacy single-create channel (`File_CreateInternalEntry`,
// registered in FileManager) parses with this same schema — one source of truth.
export const createInternalEntryInputSchema = z.discriminatedUnion('source', [
  createInternalEntryBaseSchema.extend({ source: z.literal('path'), path: AbsolutePathSchema }),
  createInternalEntryBaseSchema.extend({ source: z.literal('url'), url: z.url() }),
  createInternalEntryBaseSchema.extend({
    source: z.literal('base64'),
    data: z.string().min(1),
    name: SafeNameSchema.optional()
  }),
  createInternalEntryBaseSchema.extend({
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
  // Draft-window hold for an eagerly-materialized input whose owning row does not
  // exist yet (painting composer inputs — file-entry-cleanup.md §4.1). A
  // cleanup-visible temp-session ref keeps the entry alive through the draft
  // window until generation's `painting_file_ref role='input'` takes over;
  // `release_temp_session` drops the whole draft source once it does (or on discard).
  'file.hold_temp_session': defineRoute({
    input: z.strictObject({
      fileEntryId: FileEntryIdSchema,
      sourceId: z.string().min(1),
      role: z.literal('input')
    }),
    output: z.void()
  }),
  'file.release_temp_session': defineRoute({
    input: z.strictObject({ sourceId: z.string().min(1) }),
    output: z.void()
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
