/**
 * FileHandle — unified reference to any file accessible by Cherry.
 *
 * A handle is a **call-site choice of reference form**, not a statement about
 * the file's ownership or registration status:
 * - `FileEntryHandle` carries a `FileEntryId` — the call goes through the
 *   entry system (FileManager, versionCache, DanglingCache, …).
 * - `FilePathHandle` carries an absolute `FilePath` — the call bypasses the
 *   entry system and hits `@main/utils/file/*` directly.
 *
 * The same physical file can be referenced by either form. In particular, an
 * external file that has a FileEntry can also be reached via a `FilePathHandle`
 * (with different side-effect semantics: no DanglingCache update, no version
 * cache lookup, no identity-tracked ops). Picking a form is the caller's
 * decision, driven by which subsystem they want in the loop.
 *
 * Distinct from `FileRef` (the file_ref table, which links business entities
 * like chat_message to FileEntry).
 *
 * The runtime factories and type guards (`createFilePathHandle`,
 * `isFilePathHandle`, …) live in `@shared/utils/file` — this module owns only
 * the handle shapes and their IPC-boundary schemas.
 */

import { AbsolutePathSchema, type FileEntryId, FileEntryIdSchema } from '@shared/data/types/file'
import * as z from 'zod'

import type { FilePath } from './common'

export type FileEntryHandle = {
  readonly kind: 'entry'
  readonly entryId: FileEntryId
}

export type FilePathHandle = {
  readonly kind: 'path'
  readonly path: FilePath
}

export type FileHandle = FileEntryHandle | FilePathHandle

/**
 * Zod schemas for `FileHandle`, used to validate IPC payloads at the main-process
 * boundary. The runtime factories `createFileEntryHandle` / `createFilePathHandle`
 * (in `@shared/utils/file`) are for in-process construction; these schemas are
 * the gate for untrusted input crossing the IPC seam.
 */
export const FileEntryHandleSchema = z.strictObject({
  kind: z.literal('entry'),
  entryId: FileEntryIdSchema
})

export const FilePathHandleSchema = z.strictObject({
  kind: z.literal('path'),
  path: AbsolutePathSchema
})

export const FileHandleSchema = z.discriminatedUnion('kind', [FileEntryHandleSchema, FilePathHandleSchema])
