import * as z from 'zod'

import {
  CleanupPolicySchema,
  ContentHashSchema,
  DanglingStateSchema,
  FileEntryIdSchema,
  FileEntrySchema,
  FileHandleSchema,
  FilePathHandleSchema,
  SafeNameSchema
} from '@shared/data/types/file'
import {
  AbsoluteFilePathSchema,
  Base64StringSchema,
  FileVersionSchema,
  PhysicalFileMetadataSchema,
  SafeExtSchema,
  UrlStringSchema
} from '@shared/types/file'
import { type CreateTreeIpcResult, DirectoryTreeOptionsSchema, type TreeMutationPushPayload } from '@shared/utils/file'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

/** Maximum entry ids accepted by one file batch IPC call. */
export const FILE_IPC_MAX_BATCH_IDS = 500
/** Maximum items accepted by one internal-entry batch-create IPC call. */
export const FILE_IPC_MAX_BATCH_CREATE_ITEMS = 100
/** Maximum bytes returned by one range-read IPC call. */
export const FILE_IPC_MAX_READ_CHUNK_BYTES = 4 * 1024 * 1024

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

const fullBinaryReadOptionsSchema = z.strictObject({ mode: z.literal('full'), encoding: z.literal('binary') })

// Explicit `never` keys reject `withContentHash` in the derived type too — union
// assignability would otherwise let the key slip in via the hashed branch.
const binaryReadOptionsSchema = z.discriminatedUnion('mode', [
  fullBinaryReadOptionsSchema.extend({ withContentHash: z.never().optional() }),
  z.strictObject({
    mode: z.literal('range'),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    length: z.number().int().positive().max(FILE_IPC_MAX_READ_CHUNK_BYTES),
    withContentHash: z.never().optional()
  })
])

// withContentHash binds an xxh3 hash to the returned bytes for a later write_if_unchanged
// (same-second mtime ambiguity on FAT32/SMB/NFS); only the path arm computes it.
const binaryReadInputSchema = z.union([
  z.strictObject({ handle: FileHandleSchema, options: binaryReadOptionsSchema }),
  z.strictObject({
    handle: FilePathHandleSchema,
    options: fullBinaryReadOptionsSchema.extend({ withContentHash: z.literal(true) })
  })
])

const binaryReadResultSchema = z.strictObject({
  content: uint8ArraySchema,
  mime: z.string().min(1),
  version: FileVersionSchema,
  contentHash: ContentHashSchema.optional()
})

const writeIfUnchangedInputSchema = z.strictObject({
  handle: FileHandleSchema,
  data: uint8ArraySchema,
  expectedVersion: FileVersionSchema,
  expectedContentHash: ContentHashSchema.optional()
})

// Fields common to every create-entry source. `cleanupPolicy` is required at
// all creation surfaces (file-entry-cleanup.md §4.1) — written once here, not
// per union branch. `.extend()` keeps the branches strict.
const createInternalEntryBaseSchema = z.strictObject({ cleanupPolicy: CleanupPolicySchema })

// TODO(file-ipc): Unify these schemas with the transport types in
// `src/shared/types/file/ipc.ts`, which still hand-mirror this union. Every
// branch's payload schema now carries its transport type (`AbsoluteFilePath`,
// `UrlString`, `Base64String`), so the two can finally be collapsed onto one
// source of truth; see the matching TODO there for what remains to check.
//
// Exported: the legacy single-create channel (`File_CreateInternalEntry`,
// registered in FileManager) parses with this same schema — one source of truth.
export const createInternalEntryInputSchema = z.discriminatedUnion('source', [
  createInternalEntryBaseSchema.extend({ source: z.literal('path'), path: AbsoluteFilePathSchema }),
  createInternalEntryBaseSchema.extend({ source: z.literal('url'), url: UrlStringSchema }),
  createInternalEntryBaseSchema.extend({
    source: z.literal('base64'),
    data: Base64StringSchema,
    name: SafeNameSchema.optional()
  }),
  createInternalEntryBaseSchema.extend({
    source: z.literal('bytes'),
    data: uint8ArraySchema,
    name: SafeNameSchema,
    ext: SafeExtSchema.nullable()
  })
])

export type CreateInternalEntryInput = z.infer<typeof createInternalEntryInputSchema>

const batchCreateInternalEntriesInputSchema = z.strictObject({
  items: z.array(createInternalEntryInputSchema).min(1).max(FILE_IPC_MAX_BATCH_CREATE_ITEMS)
})

const treeIdSchema = z.string().min(1)

/**
 * File IPC schemas — filesystem-backed FileManager operations.
 *
 * SQL-only FileEntry reads stay on DataApi (`/files/entries`). These routes cover
 * live FS metadata and mutations / system actions that must run in main.
 */
export const fileRequestSchemas = {
  'file.read': defineRoute({ input: binaryReadInputSchema, output: binaryReadResultSchema }),
  'file.write_if_unchanged': defineRoute({ input: writeIfUnchangedInputSchema, output: FileVersionSchema }),
  'file.batch_get_metadata': defineRoute({
    input: batchGetMetadataInputSchema,
    output: z.record(z.string(), PhysicalFileMetadataSchema.nullable())
  }),
  'file.get_metadata': defineRoute({ input: FileHandleSchema, output: PhysicalFileMetadataSchema.nullable() }),
  'file.batch_get_physical_paths': defineRoute({
    input: fileEntryIdsInputSchema,
    output: z.record(z.string(), AbsoluteFilePathSchema.nullable())
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
  // Create-only raw-path copy: an existing destination rejects with EEXIST,
  // never overwrites. Callers must generate fresh destination names.
  'file.copy': defineRoute({
    input: z.strictObject({ sourcePath: AbsoluteFilePathSchema, destPath: AbsoluteFilePathSchema }),
    output: z.void()
  }),
  'file.open': defineRoute({ input: FileHandleSchema, output: z.void() }),
  'file.show_in_folder': defineRoute({ input: FileHandleSchema, output: z.void() }),

  // DirectoryTreeBuilder primitive. `create` returns the snapshot with its revision;
  // `activate` releases the buffered mutations once the renderer mirror is listening.
  // See docs/references/file/directory-tree.md.
  'file.tree.create': defineRoute({
    input: z.strictObject({ rootPath: AbsoluteFilePathSchema, options: DirectoryTreeOptionsSchema.optional() }),
    // Output schemas are not parsed at runtime, and `SerializedTreeNode` is recursive —
    // mirror it as a type instead of hand-writing a `z.lazy` shape nobody validates.
    output: z.custom<CreateTreeIpcResult>()
  }),
  'file.tree.activate': defineRoute({
    input: z.strictObject({ treeId: treeIdSchema, revision: z.int().nonnegative() }),
    output: z.boolean()
  }),
  'file.tree.dispose': defineRoute({ input: z.strictObject({ treeId: treeIdSchema }), output: z.void() }),
  // Rename in place only. A destination *name* rather than a path is what the
  // primitive can actually honour: `TreeNode.path` repoints a basename inside the
  // node's existing parent and cannot re-attach it elsewhere, so a cross-parent
  // move would desync the child map from the path index. `SafeNameSchema` rejects
  // separators, making that input unexpressible instead of merely rejected.
  'file.tree.rename': defineRoute({
    input: z.strictObject({
      treeId: treeIdSchema,
      oldPath: AbsoluteFilePathSchema,
      newName: SafeNameSchema
    }),
    output: z.boolean()
  })
}

/**
 * Class-B topic stream: the manager `send`s each mutation straight to the owning
 * window's WebContents rather than broadcasting, so a tree only costs the windows
 * that asked for it. Consumers filter by `treeId` (the channel is shared).
 */
export type FileEventSchemas = {
  'file.tree.mutation': TreeMutationPushPayload
}
